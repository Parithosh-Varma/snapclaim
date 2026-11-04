// SnapClaim first-run onboarding: 4 screens that land straight in the
// capture flow (which owns camera/upload/mic itself). One idea per screen,
// one primary action, Skip on 1-3. All copy comes from STRINGS (lib/onboarding)
// so nothing is baked into art.
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import {
  COACH_CAPTURE_KEY,
  COACH_MIC_KEY,
  STRINGS,
  coachSeen,
  completeOnboarding,
  loadOnboarding,
  logEvent,
  markCoachSeen,
  reducedMotionPreferred,
  setOnboardingStep,
  shouldShowOnboarding,
  startOnboarding,
  timeToCompleteMs,
  type OnboardingStep,
} from "../lib/onboarding";

// ---------------------------------------------------------------------------
// Reusable pieces. Each is also used elsewhere: ProgressDots in step
// headers, PrimaryButton as the sticky action, DoDontCard in coin tips,
// CoachMark / chips as JIT prompts.
// ---------------------------------------------------------------------------

export function ProgressDots({ step }: { step: OnboardingStep }) {
  return (
    <ol className="ob-dots" role="img" aria-label={STRINGS.stepOf(step)}>
      {[1, 2, 3, 4].map((i) => (
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
  const { startCapture } = useApp();
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [sheetOpen, setSheetOpen] = useState(false);
  const reduceMotion = reducedMotionPreferred();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goto = useCallback((n: OnboardingStep) => {
    setStep(n);
    try {
      setOnboardingStep(n);
      logEvent("step_viewed", { step: n });
    } catch { /* ignore */ }
  }, []);

  const skipToEnd = useCallback(() => {
    try { logEvent("step_skipped", { step }); } catch { /* ignore */ }
    goto(4);
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
            <span aria-hidden="true">‹</span>Back
          </button>
          <ProgressDots step={step} />
          {step < 4 ? (
            <button type="button" className="ob-skip" onClick={skipToEnd}>
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
          {step === 4 && (
            <PrimaryButton id="obStart" onClick={finish}>{STRINGS.startReport}</PrimaryButton>
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
