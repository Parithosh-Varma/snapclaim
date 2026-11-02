import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { CoinGate } from "../lib/camera";
import { loadSamplePhoto } from "../lib/sample";
import { SamplePicker } from "./SamplePicker";
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
  const { session, go, screen } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const gateRef = useRef<CoinGate | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [hint, setHint] = useState("");
  const [ring, setRing] = useState<{ left: number; top: number; size: number } | null>(null);
  const [locked, setLocked] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [enableCam, setEnableCam] = useState(false);
  const [donate, setDonate] = useState(() => {
    try { return !!localStorage.getItem("snapclaim.donatePhoto"); } catch { return false; }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [live, setLive] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [tapMsg, setTapMsg] = useState<string | null>(null);
  const [noScale, setNoScale] = useState(false);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragY = useRef<number | null>(null);
  /* tips: closed by default; auto-open only on first visit */
  useEffect(() => {
    try {
      if (!localStorage.getItem("snapclaim.tipsSeen")) setTipsOpen(true);
    } catch { /* private mode: stay closed rather than crash */ }
  }, []);
  const closeTips = useCallback(() => {
    setTipsOpen(false);
    try { localStorage.setItem("snapclaim.tipsSeen", "1"); } catch { /* ignore */ }
  }, []);

  /* locked-tap hint clears after a few seconds */
  useEffect(() => () => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
  }, []);

  /* Esc closes the tips sheet */
  useEffect(() => {
    if (!tipsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeTips(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tipsOpen, closeTips]);

  const noCam = typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia;

  /* one status line, driven by state */
  const statusLine = enableCam
    ? "Enable camera"
    : !live
      ? "Starting camera…"
      : noScale
        ? "Percentages only — no millimetres"
        : tapMsg ?? (locked ? "Place a coin next to the damage" : "Coin found – fit damage + coin in frame");

  const shotBusy = useRef(false);
  const onShutterTap = () => {
    if (shotBusy.current) return;
    if (locked) {
      setTapMsg("Hold a coin in front of the camera");
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = setTimeout(() => setTapMsg(null), 4000);
      return;
    }
    shotBusy.current = true;
    captureStill();
    setTimeout(() => { shotBusy.current = false; }, 1000);
  };

  /* bottom-sheet drag to dismiss */
  const dragStart = (clientY: number) => {
    dragY.current = clientY;
  };
  const dragMove = (clientY: number) => {
    if (dragY.current === null || !sheetRef.current) return;
    const dy = Math.max(0, clientY - dragY.current);
    sheetRef.current.style.transform = `translateY(${dy}px)`;
  };
  const dragEnd = (clientY: number) => {
    if (dragY.current === null) return;
    const dy = clientY - dragY.current;
    dragY.current = null;
    if (sheetRef.current) sheetRef.current.style.transform = "";
    if (dy > 110) closeTips();
  };

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
        setLive(false);
        setAcquiring(false);
        setEnableCam(true);
        setBlocked(name === "NotAllowedError" || name === "SecurityError");
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
    if (screen === "capture") {
      setLive(false);
    }
  }, [screen]);

  const retake = () => {
    session.stillDataUrl = "";
    session.gateCoin = null;
    session.coinLabel = "";
    session.coinKindMm = 0;
    session.noScaleMode = false;
    resetDmg(session);
    setEnableCam(false);
    setBlocked(false);
    setNoScale(false);
    setTapMsg(null);
    setAcquiring(true);
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
    setHint("Reading photo…");
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
    setPickerOpen(true);
  };

  const pickSample = async (file: string) => {
    setPicking(file);
    try {
      await loadSamplePhoto(session, file);
      setPickerOpen(false);
      go("sMark");
    } catch (e) {
      setHint(`Sample photo failed (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      setPicking(null);
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
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          onPlaying={() => {
            setLive(true);
            setAcquiring(false);
            setEnableCam(false);
            setBlocked(false);
          }}
        />
      </div>
      {screen === "capture" && (
        <div className="cam-col">
          <div className="cam-top">
            <button
              type="button"
              className="cam-close"
              aria-label="Close camera, back to home"
              onClick={() => go("tHome")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <div id="camStep" className="step-tag">01 / 06 · Capture</div>
            {!enableCam && (
            <button id="tipsBtn" type="button" onClick={() => setTipsOpen(true)}>
              Coin tips
            </button>
          )}
          </div>
          <div id="coinHint" role="status">{statusLine}{hint ? ` \u00b7 ${hint}` : ""}</div>
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
          {enableCam ? (
            <div className="permitcard" role="alertdialog" aria-labelledby="permitTitle" aria-describedby="permitDesc">
              <span className="permit-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="3" /><circle cx="12" cy="13.5" r="3.4" /><circle cx="12" cy="13.5" r="0.6" fill="currentColor" /><path d="M8.5 7l1-2.2h5L15.5 7" /></svg>
              </span>
              <p id="permitTitle">{noCam ? "No camera on this device" : "Camera is off"}</p>
              <p id="permitDesc">{noCam ? "Upload a photo or pick a sample instead — measuring works the same." : "We use your camera to measure your object. Photos stay on this device."}</p>
              {!noCam && (
                <button
                  id="enableCam"
                  type="button"
                  className={`btn-primary${acquiring ? " busy" : ""}`}
                  disabled={acquiring}
                  aria-busy={acquiring}
                  onClick={() => {
                    setEnableCam(false);
                    setBlocked(false);
                    setAcquiring(true);
                    void gateRef.current?.acquire().finally(() => setAcquiring(false));
                  }}
                >
                  {acquiring ? "Starting…" : "Enable camera"}
                </button>
              )}
              {blocked && !noCam && (
                <p className="permit-hint">Blocked in your browser? Click the lock icon in the address bar → Allow camera, then tap Enable camera.</p>
              )}
              <div className="alt-row permit-alt">
                <button id="uploadBtn" className="alt-btn" type="button" onClick={() => fileRef.current?.click()}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></svg>
                  Upload photo
                </button>
                <button id="altEntry" className="alt-btn" type="button" onClick={onSample}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="3" /><circle cx="12" cy="13.5" r="3.4" /></svg>
                  Use a sample
                </button>
              </div>
            </div>
          ) : (
            <>
              {live && (
                <div className="guide" aria-hidden="true">
                  <span className="guide-frame">
                    <i className="g tl" /><i className="g tr" /><i className="g bl" /><i className="g br" />
                  </span>
                </div>
              )}
              <div className="shutter-block">
                <button
                  id="shutter"
                  type="button"
                  aria-label={locked || !live ? "Capture (waiting for camera)" : "Capture"}
                  className={locked ? "locked" : ""}
                  disabled={!live}
                  onClick={onShutterTap}
                >
                  {locked && (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="5" y="10" width="14" height="10" fill="currentColor" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2.4" fill="none" />
                      <circle cx="12" cy="15" r="1.6" fill="#8b93a3" />
                    </svg>
                  )}
                </button>
                <span className="shutter-label">{!live ? "Starting camera…" : locked ? "Place a coin to unlock" : "Tap to capture"}</span>
                <div className="alt-row">
                  <button id="uploadBtn" className="alt-btn" type="button" onClick={() => fileRef.current?.click()}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></svg>
                    Upload photo
                  </button>
                  <button id="altEntry" className="alt-btn" type="button" onClick={onSample}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="3" /><circle cx="12" cy="13.5" r="3.4" /></svg>
                    Use a sample
                  </button>
                </div>
                <button
                  id="noCoin"
                  type="button"
                  className="noscale"
                  onClick={() => {
                    session.noScaleMode = true;
                    session.gateCoin = null;
                    setNoScale(true);
                    gateRef.current?.unlockWithoutScale();
                  }}
                >
                  Continue without a coin
                </button>
                <p className="noscale-note">Results will be percentages only — no millimetres.</p>
              </div>
            </>
          )}
          {tipsOpen && !enableCam && (
            <>
              <button type="button" id="tipsScrim" aria-label="Close coin tips" onClick={closeTips} />
              <div
                id="tipsCard"
                role="dialog"
                aria-labelledby="tipsTitle"
                aria-modal="true"
                ref={sheetRef}
                onTouchStart={(e) => dragStart(e.touches[0]?.clientY ?? 0)}
                onTouchMove={(e) => dragMove(e.touches[0]?.clientY ?? 0)}
                onTouchEnd={(e) => dragEnd(e.changedTouches[0]?.clientY ?? 0)}
              >
                <span className="tips-grab" aria-hidden="true" />
                <button type="button" id="tipsClose" aria-label="Close coin tips" onClick={closeTips}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
                <p id="tipsTitle">Coin tips</p>
                <svg className="tips-diagram" viewBox="0 0 240 120" role="img" aria-label="Diagram: coin touching the damage, wall lit evenly">
                  <rect x="4" y="4" width="232" height="112" fill="#2b2820" />
                  <circle cx="204" cy="26" r="10" fill="none" stroke="#f5d76e" strokeWidth="3" />
                  <g stroke="#f5d76e" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M204 8v-4M204 44v4M186 26h-4M222 26h4M191 13l-3-3M217 13l3-3M191 39l-3 3M217 39l3 3" />
                  </g>
                  <path d="M70 8 L64 34 L74 58 L66 84 L72 112" stroke="#0e0c08" strokeWidth="7" fill="none" strokeLinecap="round" />
                  <path d="M70 8 L64 34 L74 58 L66 84 L72 112" stroke="#4a4438" strokeWidth="1.6" fill="none" />
                  <ellipse cx="98" cy="66" rx="30" ry="8" fill="rgba(0,0,0,.35)" />
                  <circle cx="98" cy="58" r="26" fill="#e8b93c" />
                  <circle cx="98" cy="58" r="18" fill="none" stroke="#0b1e46" strokeWidth="2" strokeDasharray="4 3" />
                  <circle cx="98" cy="58" r="3" fill="#0b1e46" />
                </svg>
                <ul>
                  <li>Coin flat, touching the damage</li>
                  <li>Both sharp, filling the frame</li>
                  <li>Even light, no flash glare</li>
                </ul>
                <button type="button" id="tipsGotIt" onClick={closeTips}>Got it</button>
              </div>
            </>
          )}
        </div>
      )}
      {count !== null && (
        <div id="count" className="pop" style={{ display: "block" }} aria-hidden="true">{count}</div>
      )}
      <div className={`flash${flash ? " go" : ""}`} />
      <SamplePicker open={pickerOpen} picking={picking} onClose={() => setPickerOpen(false)} onPick={(f) => void pickSample(f)} />

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
