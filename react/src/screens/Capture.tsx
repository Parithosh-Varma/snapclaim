import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { loadSamplePhoto } from "../lib/sample";
import { SamplePicker } from "./SamplePicker";
import { freshAngleSlot, resetDmg } from "../lib/session";

const CAM_ERRORS: Record<string, string> = {
  NotAllowedError: "Camera permission is off - tap Enable camera",
  SecurityError: "Camera permission is off - tap Enable camera",
  NotFoundError: "No back camera found - tap Enable camera to retry",
  OverconstrainedError: "No back camera found - tap Enable camera to retry",
  NotReadableError: "Camera busy in another app - close it, then tap Enable camera",
  stopped: "Camera stopped - tap Enable camera",
  unsupported: "No camera on this device - use a sample or upload a photo",
};

export default function Capture() {
  const { session, go, screen } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [hint, setHint] = useState("Fit damage + coin in frame - you'll tap both next");
  const [flash, setFlash] = useState(false);
  const [enableCam, setEnableCam] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [live, setLive] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [noScale, setNoScale] = useState(false);
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
        ? "Percentages only - no millimetres"
        : "Fit damage + coin in frame - you'll tap both next";

  /* Double-tap guard: one shutter press, one still. No lock, no gate. */
  const shotBusy = useRef(false);
  const onShutterTap = () => {
    if (shotBusy.current) return;
    shotBusy.current = true;
    void captureStill();
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

  /* Direct camera handling: free shutter, no detection gate. The coin is
     tapped on the captured photo, exactly like the crack. */
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const onCameraError = useCallback((name: string) => {
    setLive(false);
    setAcquiring(false);
    setEnableCam(true);
    setBlocked(name === "NotAllowedError" || name === "SecurityError");
    setHint(CAM_ERRORS[name] ?? `Camera unavailable (${name}) - tap Enable camera`);
  }, []);

  const acquire = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      onCameraError("unsupported");
      return;
    }
    stopStream();
    const backCam: MediaStreamConstraints = { video: { facingMode: { exact: "environment" } }, audio: false };
    const anyCam: MediaStreamConstraints = { video: { facingMode: "environment" }, audio: false };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(backCam).catch(() =>
        navigator.mediaDevices.getUserMedia(anyCam));
      streamRef.current = stream;
      (stream as MediaStream & { oninactive: (() => void) | null }).oninactive = () => {
        setLive(false);
        setAcquiring(false);
        setEnableCam(true);
        setHint("Camera stopped - tap Enable camera");
      };
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      onCameraError((e as { name?: string })?.name ?? "unknown");
    }
  }, [onCameraError, stopStream]);

  const captureStill = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    // Some phones hand the video element transient black frames (warm-up,
    // exposure snap, throttled track) while reporting real dimensions, so a
    // blind drawImage can bank a black still. Grab up to 3 frames and keep
    // the brightest; refuse a still that is still black.
    if (video.readyState < 2) {
      setHint("Camera warming up - wait a second and try again.");
      return;
    }
    // A track the OS muted (another app holding the camera) or already ended
    // delivers black frames with real dimensions forever - retries can't fix
    // that, so say so and recover instead of banking another black still.
    const track = (video.srcObject as MediaStream | null)?.getVideoTracks?.()[0];
    if (!track || track.readyState === "ended") {
      setHint("Camera stopped - restarting…");
      setLive(false);
      setEnableCam(true);
      setAcquiring(true);
      await acquire().finally(() => setAcquiring(false));
      return;
    }
    if (track.muted) {
      setHint("Camera feed is blocked - close other camera apps, then retry.");
      return;
    }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const side = Math.max(vw, vh) > 1024 ? 1024 / Math.max(vw, vh) : 1;
    const cw = Math.round(vw * side);
    const ch = Math.round(vh * side);
    const snap = (): { cap: HTMLCanvasElement; mean: number } | null => {
      try {
        const cap = document.createElement("canvas");
        cap.width = cw;
        cap.height = ch;
        const g = cap.getContext("2d", { willReadFrequently: true });
        if (!g) return null;
        g.drawImage(video, 0, 0, cw, ch);
        const d = g.getImageData(0, 0, cw, ch).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 397 * 4) {
          sum += (d[i] as number) + (d[i + 1] as number) + (d[i + 2] as number);
          n += 3;
        }
        return { cap, mean: n === 0 ? 0 : sum / n / 255 };
      } catch {
        return null;
      }
    };
    let best: { cap: HTMLCanvasElement; mean: number } | null = snap();
    for (let i = 0; i < 2 && (!best || best.mean < 3 / 255); i++) {
      await new Promise((r) => setTimeout(r, 120));
      if (!videoRef.current || video.readyState < 2) break;
      const next = snap();
      if (next && (!best || next.mean > best.mean)) best = next;
    }
    if (!best || best.mean < 3 / 255) {
      // Camera stays live: the user can retry immediately, no black review.
      setHint("That frame came out black - hold steady and try again.");
      return;
    }
    try {
      const cap = best.cap;
      const still = cap.toDataURL("image/jpeg", 0.85);
      const angle = session.capturingAngle === 2 ? 2 : 1;
      // No detection gate: the coin is tapped on the photo in Mark, exactly
      // like the crack. Scale is confirmed there, never here.
      if (angle === 1) {
        session.stillDataUrl = still;
        session.stillA = still;
        session.bundleA = { ...freshAngleSlot() };
      } else {
        session.stillDataUrl = still;
        session.still2DataUrl = still;
        session.bundleB = { ...freshAngleSlot() };
      }
      session.gateCoin = null;
    } catch { /* stills are best-effort */ }
    stopStream();
    setFlash(true);
    setTimeout(() => {
      setFlash(false);
      go("sReview");
    }, 160);
  }, [acquire, go, session]);

  /* camera lifecycle: acquire on the capture screen, release on unmount */
  useEffect(() => {
    // Remote diagnosis hook, as in the vanilla app.
    (window as unknown as { __snapclaim?: unknown }).__snapclaim = () => ({ live });
    if (screen === "capture") {
      setAcquiring(true);
      void acquire().finally(() => setAcquiring(false));
    }
    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (screen === "capture") {
      setLive(false);
    }
  }, [screen]);

  const retake = () => {
    // Retake re-shoots the current angle only: clear its still and its
    // marking bundle so no stale outline survives the new photo.
    if (session.capturingAngle === 2) {
      session.still2DataUrl = "";
    } else {
      session.stillDataUrl = "";
      session.stillA = "";
    }
    session.stillDataUrl = "";
    session.gateCoin = null;
    session.coinLabel = "";
    session.coinKindMm = 0;
    session.noScaleMode = false;
    resetDmg(session);
    if (session.capturingAngle === 2) {
      session.bundleB = { ...freshAngleSlot() };
    } else {
      session.bundleA = { ...freshAngleSlot() };
    }
    setEnableCam(false);
    setBlocked(false);
    setNoScale(false);
    setAcquiring(true);
    go("capture");
    // The Capture tree stays mounted for sReview, so re-acquire explicitly.
    void acquire();
  };

  const usePhoto = () => {
    // Two angles: after the first photo goes back behind the camera for the
    // second; after the second, on to marking.
    if (session.capturingAngle !== 2) {
      session.capturingAngle = 2;
      setEnableCam(false);
      setBlocked(false);
      setNoScale(false);
      setAcquiring(true);
      go("capture");
      void acquire();
      return;
    }
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
      const still = cap.toDataURL("image/jpeg", 0.85); // canvas redraw strips EXIF
      session.stillDataUrl = still;
      if ((session.capturingAngle ?? 1) === 2) {
        session.still2DataUrl = still;
        session.bundleB = { ...freshAngleSlot() };
      } else {
        session.stillA = still;
        session.bundleA = { ...freshAngleSlot() };
      }
      session.gateCoin = null;
      session.noScaleMode = true;
      session.coinLabel = "";
      session.coinKindMm = 0;
      stopStream();
      go("sReview");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setHint("That photo could not be read - try another.");
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
            <button id="tipsBtn" type="button" onClick={() => setTipsOpen(true)}>
              Coin tips
            </button>
          </div>
          <div id="coinHint" role="status">{statusLine}</div>
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
                <img className="mark-light" src="./snapclaim-mark.png" alt="" width={40} height={38} />
                <img className="mark-dark" src="./snapclaim-mark-dark.png" alt="" width={40} height={38} />
              </span>
              <p id="permitTitle">{noCam ? "No camera on this device" : "Camera is off"}</p>
              <p id="permitDesc">{noCam ? "Upload a photo or pick a sample instead - measuring works the same." : "We use your camera to measure your object. Photos stay on this device."}</p>
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
                    void acquire().finally(() => setAcquiring(false));
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="0" /><circle cx="12" cy="13.5" r="3.4" /></svg>
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
                  aria-label="Capture"
                  disabled={!live}
                  onClick={onShutterTap}
                >
                </button>
                <span className="shutter-label">{!live ? "Starting camera…" : "Tap to capture"}</span>
                <div className="alt-row">
                  <button id="uploadBtn" className="alt-btn" type="button" onClick={() => fileRef.current?.click()}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></svg>
                    Upload photo
                  </button>
                  <button id="altEntry" className="alt-btn" type="button" onClick={onSample}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="0" /><circle cx="12" cy="13.5" r="3.4" /></svg>
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
                  }}
                >
                  Continue without a coin
                </button>
                <p className="noscale-note">Results will be percentages only - no millimetres.</p>
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
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", gap: 10, padding: "14px 18px calc(26px + env(safe-area-inset-bottom))", background: "linear-gradient(transparent, rgba(0,0,0,.65))" }}>
            <button id="retake" type="button" style={{ flex: 1, minHeight: 56, borderRadius: 0, border: "2px solid rgba(255,255,255,.85)", background: "transparent", color: "#fff", fontWeight: 800, fontSize: 17 }} onClick={retake}>Retake</button>
            <button id="usePhoto" type="button" style={{ flex: 1, minHeight: 56, borderRadius: 16, border: 0, background: "var(--coin)", color: "#fff", fontWeight: 800, fontSize: 17 }} onClick={usePhoto}>Use photo</button>
          </div>
        </section>
      )}
    </>
  );
}
