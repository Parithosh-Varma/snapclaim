// SnapClaim onboarding: first-run state, copy source of truth, environment
// helpers and privacy-safe analytics. Pure logic only: no DOM, no React, so
// it stays unit-testable with `node --test`.
//
// Storage: localStorage (try/catch) with an in-memory fallback so private
// mode never crashes the flow. Analytics never carry photo or personal data.

export const ONBOARDING_KEY = "snapclaim.onboarding.v1";
export const ANALYTICS_KEY = "snapclaim.analytics.v1";
export const COACH_CAPTURE_KEY = "snapclaim.coach.captureSeen";
export const COACH_MIC_KEY = "snapclaim.coach.micSeen";
export const MAX_ANALYTICS_EVENTS = 200;

export type OnboardingStep = 1 | 2 | 3 | 4;

export interface OnboardingState {
  step: OnboardingStep;
  done: boolean;
  startedAt: string;
  updatedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memFallback(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

let fallback = memFallback();

function safeStorage(): StorageLike {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.getItem("__snapclaim_probe__");
      return localStorage as unknown as StorageLike;
    }
  } catch { /* private mode: fall through */ }
  return fallback;
}

export function resetOnboardingFallback(): void {
  fallback = memFallback();
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampStep(n: unknown): OnboardingStep {
  const v = typeof n === "number" ? Math.round(n) : 1;
  if (v <= 1) return 1;
  if (v === 2) return 2;
  if (v === 3) return 3;
  return 4;
}

export function loadOnboarding(storage?: StorageLike): OnboardingState | null {
  const store = storage ?? safeStorage();
  try {
    const raw = store.getItem(ONBOARDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      step: clampStep(parsed.step),
      done: parsed.done === true,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : nowIso(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
    };
  } catch {
    return null;
  }
}

export function saveOnboarding(
  state: OnboardingState,
  storage?: StorageLike,
): boolean {
  const store = storage ?? safeStorage();
  try {
    store.setItem(ONBOARDING_KEY, JSON.stringify(state));
    return true;
  } catch {
    try {
      fallback.setItem(ONBOARDING_KEY, JSON.stringify(state));
    } catch { /* memory full: onboarding simply restarts next launch */ }
    return false;
  }
}

export function startOnboarding(storage?: StorageLike): OnboardingState {
  const t = nowIso();
  const state: OnboardingState = { step: 1, done: false, startedAt: t, updatedAt: t };
  saveOnboarding(state, storage);
  return state;
}

export function setOnboardingStep(step: OnboardingStep, storage?: StorageLike): OnboardingState {
  const prev = loadOnboarding(storage);
  const t = nowIso();
  const next: OnboardingState = {
    step,
    done: false,
    startedAt: prev?.startedAt ?? t,
    updatedAt: t,
  };
  saveOnboarding(next, storage);
  return next;
}

export function completeOnboarding(storage?: StorageLike): OnboardingState {
  const prev = loadOnboarding(storage);
  const t = nowIso();
  const next: OnboardingState = {
    step: 4,
    done: true,
    startedAt: prev?.startedAt ?? t,
    updatedAt: t,
  };
  saveOnboarding(next, storage);
  return next;
}

export function clearOnboarding(storage?: StorageLike): void {
  const store = storage ?? safeStorage();
  try { store.removeItem(ONBOARDING_KEY); } catch { /* ignore */ }
  try { fallback.removeItem(ONBOARDING_KEY); } catch { /* ignore */ }
}

export function shouldShowOnboarding(storage?: StorageLike): boolean {
  const s = loadOnboarding(storage);
  return !s || s.done !== true;
}

export function timeToCompleteMs(state: OnboardingState): number {
  const a = Date.parse(state.startedAt);
  const b = Date.parse(state.updatedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, b - a);
}

// ---------------------------------------------------------------------------
// Environment detection (pure functions of caller-supplied inputs so tests
// can drive them without a browser).
// ---------------------------------------------------------------------------

/** True for Instagram / Facebook / Line / X in-app webviews that block camera. */
export function isInAppBrowser(ua: string): boolean {
  const v = String(ua ?? "").toLowerCase();
  return (
    v.includes("instagram") ||
    v.includes("fbav") ||
    v.includes("fban") ||
    v.includes("fb_iab") ||
    v.includes("line/") ||
    (v.includes("twitter") && v.includes("mobile"))
  );
}

export function platformKind(ua: string): "ios" | "android" | "desktop" {
  const v = String(ua ?? "").toLowerCase();
  if (/iphone|ipad|ipod/.test(v)) return "ios";
  if (/android/.test(v)) return "android";
  return "desktop";
}

export type CameraSupport = "ok" | "no-api" | "in-app-blocked";

/** Desktop with no camera API is a first-class path, not an error. */
export function cameraSupport(opts: { hasApi: boolean; ua: string }): CameraSupport {
  if (isInAppBrowser(opts.ua)) return "in-app-blocked";
  if (!opts.hasApi) return "no-api";
  return "ok";
}

export interface RecoverySteps {
  title: string;
  steps: string[];
  fallback: string;
}

export function cameraRecovery(ua: string): RecoverySteps {
  const p = platformKind(ua);
  if (p === "ios") {
    return {
      title: "Camera is blocked",
      steps: [
        "Open Settings on your iPhone.",
        "Scroll to your browser and tap it.",
        "Turn Camera on.",
        "Come back here and tap Allow camera again.",
      ],
      fallback: "You can still upload a photo instead. Nothing is stuck.",
    };
  }
  if (p === "android") {
    return {
      title: "Camera is blocked",
      steps: [
        "Tap the lock icon in the address bar.",
        "Choose Permissions, then allow Camera.",
        "Come back here and tap Allow camera again.",
      ],
      fallback: "You can still upload a photo instead. Nothing is stuck.",
    };
  }
  return {
    title: "No camera on this device",
    steps: [
      "Use the Upload a photo button below.",
      "Pick a clear photo with the coin beside the damage.",
    ],
    fallback: "Measuring works the same from an upload.",
  };
}

export function micRecovery(ua: string): RecoverySteps {
  const p = platformKind(ua);
  if (p === "ios") {
    return {
      title: "Mic is blocked",
      steps: [
        "Open Settings on your iPhone.",
        "Scroll to your browser and tap it.",
        "Turn Microphone on.",
        "Come back here and tap Allow microphone again.",
      ],
      fallback: "No problem. Type your description instead.",
    };
  }
  return {
    title: "Mic is blocked",
    steps: [
      "Tap the lock icon in the address bar.",
      "Choose Permissions, then allow Microphone.",
      "Come back here and tap Allow microphone again.",
    ],
    fallback: "No problem. Type your description instead.",
  };
}

export function reducedMotionPreferred(matchMediaFn?: (q: string) => { matches: boolean }): boolean {
  try {
    if (typeof matchMediaFn === "function") return matchMediaFn("(prefers-reduced-motion: reduce)").matches;
    if (typeof matchMedia !== "undefined") return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch { /* ignore */ }
  return false;
}

// ---------------------------------------------------------------------------
// Privacy-safe analytics. Event names only; never photo bytes, transcripts,
// coordinates, URLs or device ids.
// ---------------------------------------------------------------------------

export type AnalyticsEvent =
  | "onboarding_started"
  | "step_viewed"
  | "step_skipped"
  | "permission_requested"
  | "permission_granted"
  | "permission_denied"
  | "onboarding_completed"
  | "time_to_complete"
  | "first_capture_success";

export interface AnalyticsRecord {
  event: AnalyticsEvent;
  at: string;
  step?: number;
  kind?: "camera" | "mic";
  ms?: number;
}

export function readAnalytics(storage?: StorageLike): AnalyticsRecord[] {
  const store = storage ?? safeStorage();
  try {
    const raw = store.getItem(ANALYTICS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as AnalyticsRecord[];
    return Array.isArray(list) ? list.filter((r) => typeof r?.event === "string") : [];
  } catch {
    return [];
  }
}

/** Append an event; drops oldest past the cap. Returns the stored record. */
export function logEvent(
  event: AnalyticsEvent,
  opts: { step?: number; kind?: "camera" | "mic"; ms?: number } = {},
  storage?: StorageLike,
): AnalyticsRecord {
  const store = storage ?? safeStorage();
  const record: AnalyticsRecord = {
    event,
    at: nowIso(),
    ...(typeof opts.step === "number" ? { step: Math.round(opts.step) } : {}),
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(typeof opts.ms === "number" ? { ms: Math.max(0, Math.round(opts.ms)) } : {}),
  };
  try {
    const list = readAnalytics(store);
    list.push(record);
    store.setItem(ANALYTICS_KEY, JSON.stringify(list.slice(-MAX_ANALYTICS_EVENTS)));
  } catch { /* analytics never break onboarding */ }
  return record;
}

export function coachSeen(key: string, storage?: StorageLike): boolean {
  const store = storage ?? safeStorage();
  try {
    return store.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markCoachSeen(key: string, storage?: StorageLike): void {
  const store = storage ?? safeStorage();
  try {
    store.setItem(key, "1");
  } catch {
    try { fallback.setItem(key, "1"); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Copy sheet: every onboarding string in one dictionary. UI must read from
// here so nothing is baked into images and everything is translatable.
// Room for 30% longer copy: layouts must wrap, never clip.
// ---------------------------------------------------------------------------

export const STRINGS = {
  appName: "SnapClaim",
  skip: "Skip",
  back: "Back",
  stepOf: (n: number) => `Step ${n} of 4`,
  // Screen 1: welcome
  welcomeTitle: "Document damage in minutes.",
  welcomeSub: "Take a photo, describe what happened, and get a clear measured report you can send to your insurer.",
  welcomePrimary: "Get started",
  welcomeSecondary: "I have used SnapClaim before",
  resumedBanner: "Welcome back. You are resuming where you left off.",
  welcomeArtAlt: "Phone showing a cracked wall with a red outline tracing the crack and a green circle on a coin beside it.",
  // Screen 2: how it works
  howTitle: "How it works.",
  howSub: "Three steps, about two minutes.",
  howTimeChip: "Takes about 2 minutes",
  howStep1Title: "Place a coin",
  howStep1Body: "Put a coin next to the damage. It gives the app a known size to measure from.",
  howStep2Title: "Photo and a line",
  howStep2Body: "Take a photo and add a short description. Type it or use the mic.",
  howStep3Title: "Get your report",
  howStep3Body: "Measurements, outlines and evidence in one PDF.",
  howPrimary: "Next",
  // Screen 3: coin guide
  coinTitle: "Place a coin beside the damage.",
  coinSub: "This one photo decides how good the measurement is.",
  coinDoTitle: "Do this",
  coinDo: [
    "Coin flat on the same surface, right next to the damage.",
    "Full coin visible, nothing covering it.",
    "Photo straight-on, with even light.",
  ],
  coinDontTitle: "Avoid this",
  coinDont: [
    "Coin tilted, propped up, or partly hidden.",
    "Coin in shadow or far from the damage.",
    "Photo at a sharp angle.",
  ],
  coinReassurance: "Slight tilt is fine. The app corrects for it, but flat and straight-on gives the best result.",
  coinNote: "Use any coin and pick it from the list in the next step, or type its diameter (15–40 mm). A ruler or card works too.",
  coinPrimary: "Got it",
  coinDoAlt: "Correct placement: coin flat beside the crack, fully visible.",
  coinDontAlt: "Incorrect placement: coin tilted and partly hidden in shadow.",
  // Screen 4: privacy
  privacyTitle: "Your photos stay with you.",
  privacySub: "What happens to your pictures, in plain words.",
  privacyRow1Title: "Measured on your device",
  privacyRow1Body: "Photos are processed here, not sent away to be measured.",
  privacyRow2Title: "Your words stay yours",
  privacyRow2Body: "We keep your description as you wrote it.",
  privacyRow3Title: "Every number has a receipt",
  privacyRow3Body: "The report shows how each measurement was worked out.",
  privacyPlaceholder: "One exception: if you tap Cross-check, that photo is sent once to our backend for a second outline.",
  privacyLink: "How we handle your data",
  privacySheetTitle: "How we handle your data",
  privacySheetBody: "Cases stay on this device unless you share the report. Measuring runs on this device after a first online load. Optional cross-checks send the tapped photo to the backend you configure.",
  privacySheetClose: "Close",
  startReport: "Start my report",
  privacyPrimary: "Next",
  // Just-in-time prompts
  coachCapture: "Keep the coin flat next to the crack",
  coachCaptureGotIt: "Got it",
  coachCaptureSeen: "Framing guide: corner brackets show where to keep damage and coin.",
  coinSeen: "Coin detected",
  coinUnseen: "Cannot see the coin yet",
  coinSeenAlt: "Status: coin detected.",
  coinUnseenAlt: "Status: cannot see the coin yet. Move the coin into frame.",
  micTooltip: "Tap to dictate, or just type a line.",
  micTooltipGotIt: "Got it",
  // Honesty line
  unverifiedNote: "Some measurements may be marked Unverified. That is normal, and it is shown openly.",
} as const;

export type Strings = typeof STRINGS;
