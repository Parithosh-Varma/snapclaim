import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { CoinGate } from "../lib/camera";
import { mountTiltMeter } from "../lib/tilt";
import { loadSample } from "../lib/sample";
import { resetDmg } from "../lib/session";

const CAM_ERRORS: Record<string, string> = {
  NotAllowedError: "Camera permission is off — tap Enable camera",
  SecurityError: "Camera permission is off — tap Enable camera",
  NotFoundError: "No back camera found — tap Enable camera to retry",
  OverconstrainedError: "No back camera found — tap Enable camera to retry",
  NotReadableError: "Camera busy in another app — close it, then tap Enable camera",
  stopped: "Camera stopped — tap Enable camera",
  unsupported: "No camera on this device — use a sample or upload a photo",
};

export default function Capture() {
  const ctx = useApp();
  const { session, go, screen } = ctx;
  const videoRef = useRef<HTMLVideoElement>(null);
  const gateRef = useRef<CoinGate | null>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [hint, setHint] = useState("Add a coin for scale");
  const [ring, setRing] = useState<{ left: number; top: number; size: number } | null>(null);
  const [locked, setLocked] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [enableCam, setEnableCam] = useState(false);
  const [shutterHide, setShutterHide] = useState(false);
  const [donate, setDonate] = useState(() => {
    try { return !!localStorage.getItem("snapclaim.donatePhoto"); } catch { return false; }
  });

  const captureStill = useCallback(() => {
    const gate = gateRef.current;
    const video = videoRef.current;
    if (!gate || !video || gate.videoEl.videoWidth === 0) return;
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cap = document.createElement("canvas");
      const side = Math.max(vw, vh) > 1024 ? 1024 / Math.max(vw, vh) : 1;
      cap.width = Math.round(vw * side);
      cap.height = Math.round(vh * side);
      cap.getContext("2d")?.drawImage(video, 0, 0, cap.width, cap.height);
      session.stillDataUrl = cap.toDataURL("image/jpeg", 0.85);
      const raw = gate.gateCoinRaw();
      if (raw) {
        session.gateCoin = {
          cx: raw.cx, cy: raw.cy, rr: raw.rr, fw: raw.fw, fh: raw.fh,
          sw: cap.width, sh: cap.height, sx: cap.width / vw, sy: cap.height / vh,
        };
      }
      session.coinLabel = gate.coinLabel;
      if (gate.coinMm > 0) session.coinKindMm = gate.coinMm;
    } catch { /* stills are best-effort */ }
    gate.stop();
    setFlash(true);
    setTimeout(() => {
      setFlash(false);
      go("sReview");
    }, 160);
  }, [go, session]);

  const captureRef = useRef(captureStill);
  captureRef.current = captureStill;

  /* gate lifecycle: created once per mount, acquires on the capture screen */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const gate = new CoinGate(video, {
      onHint: setHint,
      onRing: (r, isLocked) => {
        setRing(r);
        setLocked(isLocked);
      },
      onCount: setCount,
      onCoinIdentified: () => {},
      onAutoCapture: () => captureRef.current(),
      onCameraError: (name) => {
        setEnableCam(true);
        setHint(CAM_ERRORS[name] ?? `Camera unavailable (${name}) — tap Enable camera`);
      },
    });
    gateRef.current = gate;
    // Remote diagnosis hook, as in the vanilla app.
    (window as unknown as { __snapclaim?: unknown }).__snapclaim = () => ({
      ...gate.debug(),
      locked,
      hint,
    });
    if (screen === "capture") {
      gate.reset();
      void gate.acquire();
    }
    return () => {
      gate.stop();
      gateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tiltRef.current) return mountTiltMeter(tiltRef.current);
  }, []);

  const retake = () => {
    session.stillDataUrl = "";
    session.gateCoin = null;
    session.coinLabel = "";
    session.coinKindMm = 0;
    session.noScaleMode = false;
    resetDmg(session);
    go("capture");
    // The Capture tree stays mounted for sReview, so re-acquire explicitly.
    gateRef.current?.reset();
    void gateRef.current?.acquire();
  };

  const usePhoto = () => {
    try {
      if (donate) localStorage.setItem("snapclaim.donatePhoto", "1");
      else localStorage.removeItem("snapclaim.donatePhoto");
    } catch { /* storage may be unavailable; the photo flow must not break */ }
    go("sMark");
  };

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.max(img.width, img.height) > 1024 ? 1024 / Math.max(img.width, img.height) : 1;
      const cap = document.createElement("canvas");
      cap.width = Math.round(img.width * side);
      cap.height = Math.round(img.height * side);
      cap.getContext("2d")?.drawImage(img, 0, 0, cap.width, cap.height);
      session.stillDataUrl = cap.toDataURL("image/jpeg", 0.85); // canvas redraw strips EXIF
      session.gateCoin = null;
      session.noScaleMode = true;
      session.coinLabel = "";
      session.coinKindMm = 0;
      gateRef.current?.stop();
      go("sReview");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setHint("That photo could not be read — try another.");
    };
    img.src = url;
  };

  const onSample = async () => {
    try {
      await loadSample(ctx.base, session);
      go("sSay");
    } catch (e) {
      setHint(`Sample failed (${e instanceof Error ? e.message : String(e)}). Is the backend reachable?`);
    }
  };

  return (
    <>
      <div
        id="cam"
        role="img"
        aria-label="Live camera feed"
        onPointerDown={(e) => gateRef.current?.assistAt(e.clientX, e.clientY)}
      >
        <video ref={videoRef} playsInline muted autoPlay />
      </div>
      <span className="corner tl" aria-hidden="true" />
      <span className="corner tr" aria-hidden="true" />
      <span className="corner bl" aria-hidden="true" />
      <span className="corner br" aria-hidden="true" />
      <div
        className="coinring"
        aria-hidden="true"
        style={ring ? { display: "block", left: ring.left, top: ring.top, width: ring.size, height: ring.size } : { display: "none" }}
      />
      <div id="camStep" className="step-tag">01 / 06 · Capture</div>
      <div id="coinHint">{hint}</div>
      {enableCam && screen === "capture" && (
        <button
          id="enableCam"
          type="button"
          style={{ display: "block", position: "absolute", zIndex: 4, left: "50%", top: "55%", transform: "translateX(-50%)", border: "2px solid #fff", background: "rgba(5,10,25,.55)", backdropFilter: "blur(6px)", color: "#fff", font: "inherit", fontWeight: 800, fontSize: 17, padding: "14px 26px", borderRadius: 999, cursor: "pointer" }}
          onClick={() => {
            setEnableCam(false);
            void gateRef.current?.acquire();
          }}
        >
          Enable camera
        </button>
      )}
      <div ref={tiltRef} style={{ position: "absolute", zIndex: 4, left: "50%", top: "max(14px, env(safe-area-inset-top))", transform: "translateX(-50%)", width: "min(340px, calc(100% - 28px))" }} />
      {count !== null && (
        <div id="count" className="pop" style={{ display: "block" }} aria-hidden="true">{count}</div>
      )}
      {screen === "capture" && (
        <>
          <button
            type="button"
            className="cam-close"
            aria-label="Close camera, back to home"
            onClick={() => go("tHome")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <button
            id="shutter"
            type="button"
            aria-label="Capture"
            className={`${locked ? "locked" : ""}${shutterHide ? " hide" : ""}`}
            onPointerDown={() => setShutterHide(true)}
            onPointerUp={() => setShutterHide(false)}
            onPointerCancel={() => setShutterHide(false)}
            onPointerLeave={() => setShutterHide(false)}
            onClick={() => {
              if (locked) {
                setHint("Hold a coin in front of the camera");
                return;
              }
              captureStill();
            }}
          />
          <button id="uploadBtn" type="button" onClick={() => fileRef.current?.click()}>have a photo? upload it</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              onUpload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button id="altEntry" type="button" onClick={onSample}>no camera? use a sample</button>
          <button
            id="noCoin"
            type="button"
            onClick={() => {
              session.noScaleMode = true;
              session.gateCoin = null;
              gateRef.current?.unlockWithoutScale();
            }}
          >
            no coin? continue without scale
          </button>
        </>
      )}
      <div className={`flash${flash ? " go" : ""}`} />

      {screen === "sReview" && (
        <section className="screen on" aria-label="Review photo">
          <button
            type="button"
            className="cam-close"
            aria-label="Discard photo, back to home"
            onClick={() => go("tHome")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <img
            id="shotFull"
            alt="Captured photo"
            src={session.stillDataUrl}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
          />
          <label style={{ position: "absolute", left: 18, right: 18, bottom: "calc(96px + env(safe-area-inset-bottom))", display: "flex", gap: 10, alignItems: "center", color: "#fff", fontSize: 13, fontWeight: 600, background: "rgba(11,30,70,.88)", padding: "10px 14px", borderRadius: 14 }}>
            <input
              id="donateCheck"
              type="checkbox"
              style={{ width: 22, height: 22, flex: "none" }}
              checked={donate}
              onChange={(e) => setDonate(e.target.checked)}
            />
            Donate this photo to the dataset (consent saved on this device; nothing is uploaded now)
          </label>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", gap: 10, padding: "14px 18px calc(26px + env(safe-area-inset-bottom))", background: "linear-gradient(transparent, rgba(0,0,0,.65))" }}>
            <button id="retake" type="button" style={{ flex: 1, minHeight: 56, borderRadius: 16, border: "2px solid rgba(255,255,255,.85)", background: "transparent", color: "#fff", fontWeight: 800, fontSize: 17 }} onClick={retake}>Retake</button>
            <button id="usePhoto" type="button" style={{ flex: 1, minHeight: 56, borderRadius: 16, border: 0, background: "var(--coin)", color: "#fff", fontWeight: 800, fontSize: 17 }} onClick={usePhoto}>Use photo</button>
          </div>
        </section>
      )}
    </>
  );
}
