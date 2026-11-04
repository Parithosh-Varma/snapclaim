// SnapClaim first-run onboarding: 5 screens + permission primer with real
// getUserMedia gating. One idea per screen, one primary action, Skip on 1-4.
// All copy comes from STRINGS (lib/onboarding) so nothing is baked into art.
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import {
  COACH_CAPTURE_KEY,
  COACH_MIC_KEY,
  STRINGS,
  cameraRecovery,
  cameraSupport,
  coachSeen,
  completeOnboarding,
  isInAppBrowser,
  loadOnboarding,
  logEvent,
  markCoachSeen,
  micRecovery,
  reducedMotionPreferred,
  setOnboardingStep,
  shouldShowOnboarding,
  startOnboarding,
  timeToCompleteMs,
  type OnboardingStep,
} from "../lib/onboarding";

// ---------------------------------------------------------------------------
// Reusable pieces (component list deliverable). Each is also used elsewhere:
// ProgressDots in step headers, PrimaryButton as the sticky action, DoDontCard
// in coin tips, PermissionCard on screen 5, CoachMark / chips as JIT prompts.
// ---------------------------------------------------------------------------

export function ProgressDots({ step }: { step: OnboardingStep }) {
  return (
    <ol className="ob-dots" role="img" aria-label={STRINGS.stepOf(step)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <li key={i} className={i <= step ? "on" : undefined} aria-hidden="true" />
      ))}
    </ol>
  );
}

export function PrimaryButton({
  id,
  children,
  onClick,
  disabled,
}: {
  id?: string;
  children: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button id={id} type="button" className="ob-primary" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function IconTick() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

function IconCross() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function IconCamera() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
      <path d="M6 11.5a6 6 0 0 0 12 0" />
      <path d="M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

export function DoDontCard({
  kind,
  title,
  items,
  artAlt,
  children,
}: {
  kind: "do" | "dont";
  title: string;
  items: readonly string[];
  artAlt: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ob-mini">
      <figure role="img" aria-label={artAlt}>{children}</figure>
      <p className={`ob-verdict ${kind}`}>
        {kind === "do" ? <IconTick /> : <IconCross />}
        {title}
      </p>
      <ul>
        {items.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export function PermissionCard({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="ob-perm">
      <span className="ob-perm-icon" aria-hidden="true">{icon}</span>
      <div className="ob-perm-body">
        <b>{title}</b>
        <p>{body}</p>
        {action}
      </div>
    </div>
  );
}

/** Status chip with icon AND text (never colour alone). */
export function CoinStatusChip({ detected }: { detected: boolean }) {
  return (
    <span className={`ob-chip ${detected ? "ok" : "wait"}`} role="status">
      {detected ? <IconTick /> : <IconCross />}
      {detected ? STRINGS.coinSeen : STRINGS.coinUnseen}
    </span>
  );
}

/** Coach-mark over the viewfinder, shown once, dismissible. */
export function CaptureCoach({ onGotIt }: { onGotIt(): void }) {
  return (
    <div className="ob-coach" role="dialog" aria-label={STRINGS.coachCapture}>
      <p>{STRINGS.coachCapture}</p>
      <PrimaryButton onClick={onGotIt}>{STRINGS.coachCaptureGotIt}</PrimaryButton>
    </div>
  );
}

/** Tooltip pointing at the mic on the describe screen, shown once. */
export function MicTip({ onGotIt }: { onGotIt(): void }) {
  return (
    <div className="ob-mic-tip" role="note">
      <span style={{ flex: 1 }}>{STRINGS.micTooltip}</span>
      <button type="button" onClick={onGotIt}>{STRINGS.micTooltipGotIt}</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline illustrations (no network wait, offline-safe).
// ---------------------------------------------------------------------------

function WelcomeArt({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <svg className="ob-art" viewBox="0 0 320 190" role="img" aria-label={STRINGS.welcomeArtAlt}>
      <rect x="0" y="0" width="320" height="190" fill="#FFFFFF" />
      <rect x="112" y="14" width="96" height="162" rx="14" fill="#0A1E48" />
      <rect x="120" y="26" width="80" height="138" rx="8" fill="#DCE3EE" />
      <path d="M132 40 L146 78 L138 108 L150 150" fill="none" stroke="#C81E2B" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M132 40 L146 78 L138 108 L150 150" fill="none" stroke="#fff" strokeWidth="1" strokeDasharray="3 4" opacity="0.7" />
      <g className={reduceMotion ? undefined : "ob-wobble"}>
        <circle cx="172" cy="128" r="17" fill="#E9B93C" stroke="#0E8A4B" strokeWidth="4" />
        <circle cx="172" cy="128" r="10" fill="none" stroke="#0A1E48" strokeWidth="1.6" strokeDasharray="3 2.5" />
      </g>
      <rect x="150" y="18" width="20" height="4" rx="2" fill="#3D4A68" />
    </svg>
  );
}

function CoinDoArt() {
  return (
    <svg viewBox="0 0 140 90" role="presentation" aria-hidden="true">
      <rect x="0" y="0" width="140" height="90" rx="8" fill="#EDE9DE" />
      <path d="M20 12 L30 44 L24 78" stroke="#0A1E48" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.35" />
      <ellipse cx="92" cy="72" rx="26" ry="7" fill="rgba(10,30,72,.18)" />
      <circle cx="92" cy="62" r="22" fill="#E9B93C" />
      <circle cx="92" cy="62" r="15" fill="none" stroke="#0A1E48" strokeWidth="1.6" strokeDasharray="4 3" />
    </svg>
  );
}

function CoinDontArt() {
  return (
    <svg viewBox="0 0 140 90" role="presentation" aria-hidden="true">
      <rect x="0" y="0" width="140" height="90" rx="8" fill="#3A3A34" />
      <path d="M20 12 L30 44 L24 78" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.5" />
      <ellipse cx="96" cy="70" rx="26" ry="7" fill="rgba(0,0,0,.5)" />
      <ellipse cx="96" cy="52" rx="22" ry="12" fill="#8f7a3a" />
      <rect x="60" y="20" width="70" height="50" fill="rgba(0,0,0,.35)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Permission request helpers (only ever called from a tap, never on load).
// ---------------------------------------------------------------------------

type PermState = "idle" | "requesting" | "granted" | "denied" | "blocked" | "unavailable";

async function requestVideo(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false,
  });
  try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
}

async function requestAudio(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
}

function mapCameraError(name: string, hasApi: boolean): PermState {
  if (!hasApi) return "unavailable";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "unavailable";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  return "denied";
}

function readPhotoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        URL.revokeObjectURL(url);
        const side = Math.max(img.width, img.height) > 1024 ? 1024 / Math.max(img.width, img.height) : 1;
        const cap = document.createElement("canvas");
        cap.width = Math.max(1, Math.round(img.width * side));
        cap.height = Math.max(1, Math.round(img.height * side));
        cap.getContext("2d")?.drawImage(img, 0, 0, cap.width, cap.height);
        resolve(cap.toDataURL("image/jpeg", 0.85));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("photo would not decode"));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Main flow.
// ---------------------------------------------------------------------------

export function useOnboardingGate(): { active: boolean; initialStep: OnboardingStep; resumed: boolean } {
  const [gate] = useState(() => {
    try {
      const saved = loadOnboarding();
      if (shouldShowOnboarding()) {
        return {
          active: true,
          initialStep: saved && !saved.done ? saved.step : 1,
          resumed: !!saved && !saved.done && saved.step > 1,
        };
      }
      return { active: false, initialStep: 1 as OnboardingStep, resumed: false };
    } catch {
      return { active: true, initialStep: 1 as OnboardingStep, resumed: false };
    }
  });
  return gate;
}

export default function Onboarding({
  initialStep = 1,
  resumed = false,
  onDone,
  onExit,
}: {
  initialStep?: OnboardingStep;
  resumed?: boolean;
  onDone(): void;
  onExit(): void;
}) {
  const { startCapture, startWithPhoto, toast } = useApp();
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [camState, setCamState] = useState<PermState>("idle");
  const [micState, setMicState] = useState<PermState>("idle");
  const [uploadChosen, setUploadChosen] = useState(false);
  const [busyFile, setBusyFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const reduceMotion = reducedMotionPreferred();

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const hasApi = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const support = cameraSupport({ hasApi, ua });
  const inApp = isInAppBrowser(ua);
  const desktopNoCam = support === "no-api" && !inApp;
  const startedRef = useRef(false);

  // Fresh entry logs started + first view; step changes persist + log views.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const existing = loadOnboarding();
      if (!existing || existing.done) startOnboarding();
      logEvent("onboarding_started");
      logEvent("step_viewed", { step });
    } catch { /* onboarding still renders */ }
    // Pre-check the OS permission state so a previously-blocked user skips
    // the request button and goes straight to recovery instructions.
    try {
      const perms = navigator.permissions as Permissions | undefined;
      perms?.query?.({ name: "camera" as PermissionName }).then((r) => {
        if (r.state === "denied") setCamState("blocked");
      }).catch(() => {});
      perms?.query?.({ name: "microphone" as PermissionName }).then((r) => {
        if (r.state === "denied") setMicState("blocked");
      }).catch(() => {});
    } catch { /* Permissions API absent: request buttons stay */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goto = useCallback((n: OnboardingStep) => {
    setStep(n);
    try {
      setOnboardingStep(n);
      logEvent("step_viewed", { step: n });
    } catch { /* ignore */ }
  }, []);

  const skipToPerms = useCallback(() => {
    try { logEvent("step_skipped", { step }); } catch { /* ignore */ }
    goto(5);
  }, [goto, step]);

  const finish = useCallback(() => {
    try {
      const done = completeOnboarding();
      logEvent("onboarding_completed");
      logEvent("time_to_complete", { ms: timeToCompleteMs(done) });
    } catch { /* ignore */ }
    onDone();
    startCapture();
  }, [onDone, startCapture]);

  const askCamera = useCallback(async () => {
    if (!hasApi) {
      setCamState("unavailable");
      return;
    }
    setCamState("requesting");
    try { logEvent("permission_requested", { kind: "camera", step }); } catch { /* ignore */ }
    try {
      await requestVideo();
      setCamState("granted");
      try { logEvent("permission_granted", { kind: "camera", step }); } catch { /* ignore */ }
    } catch (e) {
      const name = (e as { name?: string })?.name ?? "unknown";
      setCamState(mapCameraError(name, hasApi));
      try { logEvent("permission_denied", { kind: "camera", step }); } catch { /* ignore */ }
    }
  }, [hasApi, step]);

  const askMic = useCallback(async () => {
    if (!hasApi || !navigator.mediaDevices?.getUserMedia) {
      setMicState("unavailable");
      return;
    }
    setMicState("requesting");
    try { logEvent("permission_requested", { kind: "mic", step }); } catch { /* ignore */ }
    try {
      await requestAudio();
      setMicState("granted");
      try { logEvent("permission_granted", { kind: "mic", step }); } catch { /* ignore */ }
    } catch {
      setMicState("denied");
      try { logEvent("permission_denied", { kind: "mic", step }); } catch { /* ignore */ }
    }
  }, [hasApi, step]);

  const onUploadFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setBusyFile(true);
    try {
      const dataUrl = await readPhotoDataUrl(file);
      try {
        const done = completeOnboarding();
        logEvent("permission_granted", { kind: "camera", step });
        logEvent("onboarding_completed");
        logEvent("time_to_complete", { ms: timeToCompleteMs(done) });
      } catch { /* ignore */ }
      toast(STRINGS.photoReady);
      onDone();
      startWithPhoto(dataUrl);
    } catch {
      toast(STRINGS.photoUnreadable);
    } finally {
      setBusyFile(false);
    }
  }, [onDone, startWithPhoto, step, toast]);

  const startEnabled = camState === "granted" || uploadChosen;
  const camRecovery = cameraRecovery(ua);
  const micRec = micRecovery(ua);

  return (
    <div className="ob-root">
      <div className="ob-col">
        <header className="ob-top">
          <button
            type="button"
            className="ob-back"
            aria-label={step === 1 ? "Back to home" : `Back to step ${step - 1}`}
            onClick={() => {
              if (step === 1) onExit();
              else goto((step - 1) as OnboardingStep);
            }}
          >
            <span aria-hidden="true">‹&nbsp;</span>Back
          </button>
          <ProgressDots step={step} />
          {step < 5 ? (
            <button type="button" className="ob-skip" onClick={skipToPerms}>
              {STRINGS.skip}
            </button>
          ) : (
            <span style={{ minWidth: 64 }} aria-hidden="true" />
          )}
        </header>

        <main className="ob-body" key={step}>
          {step === 1 && (
            <>
              <h1 className="ob-title">{STRINGS.welcomeTitle}</h1>
              <p className="ob-sub">{STRINGS.welcomeSub}</p>
              <WelcomeArt reduceMotion={reduceMotion} />
              {resumed && (
                <p className="ob-resumed" role="status">
                  {STRINGS.resumedBanner}
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <span className="ob-kicker">{STRINGS.howTimeChip}</span>
              <h1 className="ob-title">{STRINGS.howTitle}</h1>
              <p className="ob-sub">{STRINGS.howSub}</p>
              <div className="ob-card">
                <ol className="ob-steps">
                  <li className="ob-step">
                    <span className="ob-num" aria-hidden="true">1</span>
                    <div>
                      <b>{STRINGS.howStep1Title}</b>
                      <p>{STRINGS.howStep1Body}</p>
                    </div>
                  </li>
                  <li className="ob-step">
                    <span className="ob-num" aria-hidden="true">2</span>
                    <div>
                      <b>{STRINGS.howStep2Title}</b>
                      <p>{STRINGS.howStep2Body}</p>
                    </div>
                  </li>
                  <li className="ob-step">
                    <span className="ob-num" aria-hidden="true">3</span>
                    <div>
                      <b>{STRINGS.howStep3Title}</b>
                      <p>{STRINGS.howStep3Body}</p>
                    </div>
                  </li>
                </ol>
              </div>
              <p className="ob-note">{STRINGS.unverifiedNote}</p>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="ob-title">{STRINGS.coinTitle}</h1>
              <p className="ob-sub">{STRINGS.coinSub}</p>
              <div className="ob-pair">
                <DoDontCard kind="do" title={STRINGS.coinDoTitle} items={STRINGS.coinDo} artAlt={STRINGS.coinDoAlt}>
                  <CoinDoArt />
                </DoDontCard>
                <DoDontCard kind="dont" title={STRINGS.coinDontTitle} items={STRINGS.coinDont} artAlt={STRINGS.coinDontAlt}>
                  <CoinDontArt />
                </DoDontCard>
              </div>
              <p className="ob-note" style={{ marginTop: 12 }}>
                {STRINGS.coinReassurance}
                <small>{STRINGS.coinNote}</small>
              </p>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="ob-title">{STRINGS.privacyTitle}</h1>
              <p className="ob-sub">{STRINGS.privacySub}</p>
              <div className="ob-card">
                <ol className="ob-steps">
                  <li className="ob-step">
                    <span className="ob-num" aria-hidden="true">✓</span>
                    <div>
                      <b>{STRINGS.privacyRow1Title}</b>
                      <p>{STRINGS.privacyRow1Body}</p>
                    </div>
                  </li>
                  <li className="ob-step">
                    <span className="ob-num" aria-hidden="true">✓</span>
                    <div>
                      <b>{STRINGS.privacyRow2Title}</b>
                      <p>{STRINGS.privacyRow2Body}</p>
                    </div>
                  </li>
                  <li className="ob-step">
                    <span className="ob-num" aria-hidden="true">✓</span>
                    <div>
                      <b>{STRINGS.privacyRow3Title}</b>
                      <p>{STRINGS.privacyRow3Body}</p>
                    </div>
                  </li>
                </ol>
              </div>
              <p className="ob-note">
                {STRINGS.privacyPlaceholder}
              </p>
              <button type="button" className="ob-linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setSheetOpen(true)}>
                {STRINGS.privacyLink}
              </button>
            </>
          )}

          {step === 5 && (
            <>
              <h1 className="ob-title">{STRINGS.permTitle}</h1>
              <p className="ob-sub">{STRINGS.permSub}</p>

              {inApp && (
                <p className="ob-note" role="alert">
                  <b style={{ display: "block", marginBottom: 4 }}>{STRINGS.permInAppTitle}</b>
                  {STRINGS.permInAppBody}
                </p>
              )}

              {desktopNoCam ? (
                <div className="ob-card">
                  <b style={{ display: "block", fontSize: 16 }}>{STRINGS.permDesktopTitle}</b>
                  <p className="ob-sub" style={{ margin: "4px 0 12px" }}>{STRINGS.permDesktopBody}</p>
                  <PrimaryButton onClick={() => fileRef.current?.click()} disabled={busyFile}>
                    {busyFile ? STRINGS.readingPhoto : STRINGS.permDesktopPrimary}
                  </PrimaryButton>
                  {uploadChosen && <p role="status" style={{ fontSize: 14, marginTop: 8 }}>{STRINGS.permUploadChosen}</p>}
                </div>
              ) : (
                <PermissionCard
                  icon={<IconCamera />}
                  title={STRINGS.permCameraTitle}
                  body={STRINGS.permCameraBody}
                  action={
                    <>
                      {camState === "granted" ? (
                        <p role="status" className="ob-ok">
                          <IconTick /> {STRINGS.permCameraGranted}
                        </p>
                      ) : camState === "blocked" || camState === "denied" ? (
                        <>
                          <button type="button" className="ob-perm-btn" onClick={askCamera}>
                            {STRINGS.permCameraAllow}
                          </button>
                          <div className="ob-recover" role="alert">
                            <b>{camRecovery.title}</b>
                            <ol>
                              {camRecovery.steps.map((s) => (
                                <li key={s}>{s}</li>
                              ))}
                            </ol>
                            <span>{camRecovery.fallback}</span>
                          </div>
                          <button
                            type="button"
                            className="ob-linkbtn"
                            onClick={() => {
                              setUploadChosen(true);
                              try { logEvent("step_skipped", { step }); } catch { /* ignore */ }
                            }}
                          >
                            {STRINGS.permUploadInstead}
                          </button>
                        </>
                      ) : camState === "unavailable" ? (
                        <>
                          <div className="ob-recover" role="alert">
                            <b>{camRecovery.title}</b>
                            <ol>
                              {camRecovery.steps.map((s) => (
                                <li key={s}>{s}</li>
                              ))}
                            </ol>
                            <span>{camRecovery.fallback}</span>
                          </div>
                          <button
                            type="button"
                            className="ob-linkbtn"
                            onClick={() => setUploadChosen(true)}
                          >
                            {STRINGS.permUploadInstead}
                          </button>
                        </>
                      ) : (
                        <button type="button" className="ob-perm-btn" onClick={askCamera} disabled={camState === "requesting"}>
                          {camState === "requesting" ? STRINGS.asking : STRINGS.permCameraAllow}
                        </button>
                      )}
                      {uploadChosen && camState !== "granted" && (
                        <p role="status" style={{ fontSize: 14, marginTop: 8 }}>{STRINGS.permUploadChosen}</p>
                      )}
                    </>
                  }
                />
              )}

              {!desktopNoCam && (
                <PermissionCard
                  icon={<IconMic />}
                  title={STRINGS.permMicTitle}
                  body={STRINGS.permMicBody}
                  action={
                    <>
                      {micState === "granted" ? (
                        <p role="status" className="ob-ok">{STRINGS.permMicOn}</p>
                      ) : micState === "denied" || micState === "blocked" || micState === "unavailable" ? (
                        <>
                          <div className="ob-recover" role="alert">
                            <b>{micRec.title}</b>
                            <ol>
                              {micRec.steps.map((s) => (
                                <li key={s}>{s}</li>
                              ))}
                            </ol>
                            <span>{micRec.fallback}</span>
                          </div>
                          <button
                            type="button"
                            className="ob-linkbtn"
                            onClick={() => {
                              setMicState("idle");
                              try { logEvent("step_skipped", { step }); } catch { /* ignore */ }
                            }}
                          >
                            {STRINGS.permMicNotNow}
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="ob-perm-btn" onClick={askMic} disabled={micState === "requesting"}>
                            {micState === "requesting" ? STRINGS.asking : STRINGS.permMicAllow}
                          </button>{" "}
                          <button
                            type="button"
                            className="ob-linkbtn"
                            onClick={() => {
                              try { logEvent("step_skipped", { step }); } catch { /* ignore */ }
                              setMicState("idle");
                            }}
                          >
                            {STRINGS.permMicNotNow}
                          </button>
                        </>
                      )}
                      {micState === "idle" && (
                        <span className="sr-only" role="status">{STRINGS.permMicSkipped}</span>
                      )}
                    </>
                  }
                />
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onUploadFile(f);
                }}
              />
            </>
          )}
        </main>

        <footer className="ob-cta">
          {step === 1 && (
            <>
              <PrimaryButton onClick={() => goto(2)}>{STRINGS.welcomePrimary}</PrimaryButton>
              <button type="button" className="ob-secondary" onClick={() => { try { logEvent("step_skipped", { step }); } catch { /* ignore */ } finish(); }}>
                {STRINGS.welcomeSecondary}
              </button>
            </>
          )}
          {step === 2 && <PrimaryButton onClick={() => goto(3)}>{STRINGS.howPrimary}</PrimaryButton>}
          {step === 3 && <PrimaryButton onClick={() => goto(4)}>{STRINGS.coinPrimary}</PrimaryButton>}
          {step === 4 && <PrimaryButton onClick={() => goto(5)}>{STRINGS.privacyPrimary}</PrimaryButton>}
          {step === 5 && (
            desktopNoCam ? (
              <PrimaryButton onClick={() => fileRef.current?.click()} disabled={busyFile}>
                {busyFile ? STRINGS.readingPhoto : STRINGS.permDesktopPrimary}
              </PrimaryButton>
            ) : (
              <PrimaryButton id="obStart" onClick={finish} disabled={!startEnabled}>
                {STRINGS.permStart}
              </PrimaryButton>
            )
          )}
        </footer>
      </div>

      {sheetOpen && (
        <div className="ob-sheet-scrim" onClick={() => setSheetOpen(false)}>
          <div
            className="ob-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="obSheetTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="obSheetTitle">{STRINGS.privacySheetTitle}</h2>
            <p>{STRINGS.privacySheetBody}</p>
            <PrimaryButton onClick={() => setSheetOpen(false)}>{STRINGS.privacySheetClose}</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JIT wiring helpers: call from the claim flow. Shown once, dismissible.
// ---------------------------------------------------------------------------

export function shouldShowCaptureCoach(): boolean {
  try {
    if (reducedMotionPreferred()) return !coachSeen(COACH_CAPTURE_KEY);
    return !coachSeen(COACH_CAPTURE_KEY);
  } catch {
    return true;
  }
}

export function dismissCaptureCoach(): void {
  markCoachSeen(COACH_CAPTURE_KEY);
}

export function shouldShowMicTip(): boolean {
  try {
    return !coachSeen(COACH_MIC_KEY);
  } catch {
    return true;
  }
}

export function dismissMicTip(): void {
  markCoachSeen(COACH_MIC_KEY);
}
