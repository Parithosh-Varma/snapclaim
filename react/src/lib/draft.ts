// In-progress claim draft: autosaved so a reload, crash or dead battery does
// not waste the user's progress. One JSON blob in localStorage, restored on
// Home with an explicit Resume - never auto-applied.
//
// What survives: the still (already downscaled JPEG data URL), taps, outlines
// (as compact COCO RLE, re-inflated on resume), coin state, transcript,
// measurement and payload. Canvases and blob URLs do not survive: the
// marking photo is rebuilt from its still and the mask is re-applied if its
// dimensions still match the rebuilt canvas.
//
// Quota discipline mirrors the case store: tiered stripping (location photo,
// then payload overlays) so a save retries smaller rather than losing
// everything. Masks are the expensive API result - they are stripped last
// and only as a last resort.
import { decodeRle, encodeRle, type Rle } from "./rle.ts";
import type { DmgState, GateCoin, Measurement, Payload, Session } from "./session.ts";
import type { StorageLike } from "./store.ts";

export const DRAFT_KEY = "snapclaim.draft.v1";

/** Screens a draft can resume to. Capture cannot resume (the camera stream
    is gone), so it folds to review when a still exists. */
export type ResumeScreen = "sReview" | "sMark" | "sSay" | "sNum" | "sCheck" | "sReport";

const RESUMABLE: ResumeScreen[] = ["sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"];

export function mapScreen(screen: string, s: Session): ResumeScreen | null {
  if ((RESUMABLE as string[]).includes(screen)) return screen as ResumeScreen;
  if (screen === "capture") return s.stillDataUrl ? "sReview" : null;
  return null;
}

/** The marking state without the canvas: the still rebuilds it. */
export interface DraftSlot {
  photoFor: string;
  /** Canvas dimensions the RLE was encoded at; resume drops masks on mismatch. */
  w: number;
  h: number;
  points: [number, number][];
  maskRle: Rle | null;
  iou: number;
  source: "api" | "device" | null;
  coinManualPt: [number, number] | null;
  coinMaskRle: Rle | null;
  coinIou: number;
  gateCoin: GateCoin | null;
  taped: boolean;
  hist: ("crack" | "coin")[];
}

export interface DraftV1 {
  v: 1;
  savedAt: string;
  screen: ResumeScreen;
  stillDataUrl: string;
  locationPhoto: string | null;
  coinLabel: string;
  coinKindMm: number;
  coinTaped: boolean;
  noScaleMode: boolean;
  dmgLabel: string;
  transcript: string;
  extendedTranscript: string | null;
  reportStatement: string | null;
  reportFail: string | null;
  raw: string;
  currentCaseId: string | null;
  working: DraftSlot;
  measurement: Measurement | null;
  payload: Payload | null;
}

/** Legacy two-angle draft shape (pre-single-photo). Extra fields are ignored
    on load; see applyDraft for the angle-1 fallback. */
export interface LegacyDraftV1 extends DraftV1 {
  activeAngle?: 1 | 2;
  stillA?: string;
  still2DataUrl?: string;
  capturingAngle?: 1 | 2;
  bundleA?: DraftSlot | null;
  bundleB?: DraftSlot | null;
  measurementA?: Measurement | null;
  measurementB?: Measurement | null;
  payloadA?: Payload | null;
  payloadB?: Payload | null;
  winnerAngle?: 1 | 2 | null;
}

function isPt(p: unknown): p is [number, number] {
  return Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number";
}

function slotOf(
  dmg: DmgState,
  o: {
    photoFor: string; w: number; h: number;
    coinManualPt: [number, number] | null; coinMask: Uint8Array | null; coinIou: number;
    gateCoin: GateCoin | null; taped: boolean; hist: ("crack" | "coin")[];
  },
): DraftSlot {
  const hasDims = o.w > 0 && o.h > 0;
  return {
    photoFor: o.photoFor,
    w: hasDims ? o.w : 0,
    h: hasDims ? o.h : 0,
    points: dmg.points.filter(isPt).map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]),
    maskRle: hasDims && dmg.mask && dmg.mask.length === o.w * o.h ? encodeRle(dmg.mask, o.w, o.h) : null,
    iou: typeof dmg.iou === "number" ? dmg.iou : 0,
    source: dmg.source,
    coinManualPt: isPt(o.coinManualPt) ? [Math.round(o.coinManualPt[0]), Math.round(o.coinManualPt[1])] : null,
    coinMaskRle:
      hasDims && o.coinMask && o.coinMask.length === o.w * o.h ? encodeRle(o.coinMask, o.w, o.h) : null,
    coinIou: typeof o.coinIou === "number" ? o.coinIou : 0,
    gateCoin: o.gateCoin,
    taped: !!o.taped,
    hist: Array.isArray(o.hist) ? o.hist.filter((x) => x === "crack" || x === "coin") : [],
  };
}

/** Snapshot the session into a serializable draft. Null when there is
    nothing worth resuming (no photo and no transcript). */
export function collectDraft(session: Session, screen: string, now: () => string = () => new Date().toISOString()): DraftV1 | null {
  const target = mapScreen(screen, session);
  if (!target) return null;
  const hasPhoto = !!session.stillDataUrl;
  if (!hasPhoto && !session.transcript.trim()) return null;
  const w = session.photo?.width ?? 0;
  const h = session.photo?.height ?? 0;
  const working = slotOf(session.dmg, {
    photoFor: session.photoFor, w, h,
    coinManualPt: session.coinManualPt, coinMask: session.coinMask, coinIou: session.coinIou,
    gateCoin: session.gateCoin, taped: session.coinTaped, hist: session.workingHist,
  });
  return {
    v: 1,
    savedAt: now(),
    screen: target,
    stillDataUrl: session.stillDataUrl,
    locationPhoto: session.locationPhoto,
    coinLabel: session.coinLabel,
    coinKindMm: session.coinKindMm,
    coinTaped: session.coinTaped,
    noScaleMode: session.noScaleMode,
    dmgLabel: session.dmgLabel,
    transcript: session.transcript,
    extendedTranscript: session.extendedTranscript,
    reportStatement: session.reportStatement,
    reportFail: session.reportFail,
    raw: session.raw,
    currentCaseId: session.currentCaseId,
    working,
    measurement: session.measurement,
    payload: session.payload,
  };
}

function inflateMask(rle: Rle | null, w: number, h: number): Uint8Array | null {
  if (!rle || !w || !h) return null;
  try {
    const mask = decodeRle(rle);
    return mask.length === w * h ? mask : null;
  } catch {
    return null;
  }
}

/** Hydrate a fresh session from a draft. Canvases stay null: Mark rebuilds
    the photo from its still and re-applies the slot when dimensions match.
    Legacy two-angle drafts load without crashing: the extra bundle/still
    fields are ignored, and a draft whose working slot was angle 2 falls back
    to angle 1's still, taps and results. */
export function applyDraft(session: Session, draft: DraftV1 | LegacyDraftV1): void {
  const legacy = draft as LegacyDraftV1;
  const wasAngle2 = legacy.activeAngle === 2;
  // Angle-1 fallback for legacy drafts whose working slot was angle 2.
  const still = wasAngle2
    ? (legacy.stillA || draft.stillDataUrl || "")
    : (draft.stillDataUrl || legacy.stillA || "");
  const working: DraftSlot = wasAngle2 && legacy.bundleA ? legacy.bundleA : draft.working;
  const measurement: Measurement | null =
    draft.measurement ?? legacy.measurementA ?? legacy.measurementB ?? null;
  const payload: Payload | null =
    draft.payload ?? legacy.payloadA ?? legacy.payloadB ?? null;

  session.stillDataUrl = still;
  session.locationPhoto = draft.locationPhoto;
  session.coinLabel = draft.coinLabel;
  session.coinKindMm = draft.coinKindMm;
  session.coinTaped = draft.coinTaped;
  session.noScaleMode = draft.noScaleMode;
  session.dmgLabel = draft.dmgLabel;
  session.transcript = draft.transcript;
  session.extendedTranscript = draft.extendedTranscript;
  session.reportStatement = draft.reportStatement;
  session.reportFail = draft.reportFail;
  session.raw = draft.raw;
  session.currentCaseId = draft.currentCaseId;
  session.measurement = measurement;
  session.payload = payload;

  session.photo = null;
  session.photoFor = "";
  session.dmg = {
    points: working.points.filter(isPt),
    pointMasks: [],
    mask: inflateMask(working.maskRle, working.w, working.h),
    iou: working.iou,
    source: working.source,
  };
  session.coinManualPt = isPt(working.coinManualPt) ? working.coinManualPt : null;
  session.coinMask = inflateMask(working.coinMaskRle, working.w, working.h);
  session.coinIou = working.coinIou;
  session.gateCoin = working.gateCoin;
  session.workingHist = working.hist.filter((x) => x === "crack" || x === "coin");
  session.annexUrl = null;
  session.autoListen = false;
}

/** Quota-tiered write: full draft first, then progressively smaller rather
    than losing everything. Returns true when something durable was written. */
export function saveDraft(storage: StorageLike, draft: DraftV1): boolean {
  const write = (d: DraftV1): boolean => {
    try {
      storage.setItem(DRAFT_KEY, JSON.stringify(d));
      return true;
    } catch {
      return false;
    }
  };
  if (write(draft)) return true;
  // Tier 1: the location plate is context-only - first to go.
  const t1: DraftV1 = { ...draft, locationPhoto: null };
  if (write(t1)) return true;
  // Tier 2: payload overlays carry the longest strings (SVG paths); the
  // numbers survive in the measurements without them.
  const stripOverlay = (p: Payload | null): Payload | null => {
    if (!p || typeof p !== "object") return p;
    const { overlay: _dropped, ...rest } = p as Payload & { overlay?: unknown };
    void _dropped;
    return rest as Payload;
  };
  const t2: DraftV1 = {
    ...t1, payload: stripOverlay(t1.payload),
    raw: "", extendedTranscript: null,
  };
  if (write(t2)) return true;
  // Tier 3: stills, taps and transcript only - masks re-outline in one tap.
  const stripSlot = (s: DraftSlot): DraftSlot =>
    ({ ...s, maskRle: null, coinMaskRle: null, iou: 0, coinIou: 0 });
  const t3: DraftV1 = {
    ...t2, working: stripSlot(t2.working),
  };
  return write(t3);
}

export function loadDraft(storage: StorageLike): DraftV1 | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as DraftV1;
    if (!d || d.v !== 1 || !(RESUMABLE as string[]).includes(d.screen)) return null;
    if (!d.working || !Array.isArray(d.working.points)) return null;
    return d;
  } catch {
    return null;
  }
}

export function clearDraft(storage: StorageLike): void {
  try {
    storage.removeItem(DRAFT_KEY);
  } catch { /* ignore */ }
}

const STEP_LABEL: Record<ResumeScreen, string> = {
  sReview: "Reviewing photo",
  sMark: "Marking damage",
  sSay: "Voice note",
  sNum: "Measurements",
  sCheck: "Double-check",
  sReport: "Report",
};

export interface DraftSummary {
  step: string;
  taps: number;
  savedAt: string;
  hasPhoto: boolean;
}

/** One-liner for the Home resume banner. */
export function draftSummary(d: DraftV1 | LegacyDraftV1): DraftSummary {
  const legacy = d as LegacyDraftV1;
  return {
    step: STEP_LABEL[d.screen] ?? "In progress",
    taps: d.working.points.length,
    savedAt: d.savedAt,
    hasPhoto: !!(d.stillDataUrl || legacy.stillA || legacy.still2DataUrl),
  };
}
