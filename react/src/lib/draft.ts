// In-progress claim draft: autosaved so a reload, crash or dead battery does
// not waste the user's progress. One JSON blob in localStorage, restored on
// Home with an explicit Resume - never auto-applied.
//
// What survives: stills (already downscaled JPEG data URLs), taps, outlines
// (as compact COCO RLE, re-inflated on resume), coin state, transcript,
// measurements and payloads. Canvases and blob URLs do not survive: the
// marking photo is rebuilt from its still and the mask is re-applied if its
// dimensions still match the rebuilt canvas.
//
// Quota discipline mirrors the case store: tiered stripping (location photo,
// then the second angle, then payload overlays) so a save retries smaller
// rather than losing everything. Masks are the expensive API result - they
// are stripped last and only as a last resort.
import { decodeRle, encodeRle, type Rle } from "./rle.ts";
import type { AngleSlot, DmgState, GateCoin, Measurement, Payload, Session } from "./session.ts";
import type { StorageLike } from "./store.ts";

export const DRAFT_KEY = "snapclaim.draft.v1";

/** Screens a draft can resume to. Capture cannot resume (the camera stream
    is gone), so it folds to review when a still exists. */
export type ResumeScreen = "sReview" | "sMark" | "sSay" | "sNum" | "sCheck" | "sReport";

const RESUMABLE: ResumeScreen[] = ["sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"];

export function mapScreen(screen: string, s: Session): ResumeScreen | null {
  if ((RESUMABLE as string[]).includes(screen)) return screen as ResumeScreen;
  if (screen === "capture") return s.stillDataUrl || s.stillA || s.still2DataUrl ? "sReview" : null;
  return null;
}

/** One angle's marking state without the canvas: the still rebuilds it. */
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
  activeAngle: 1 | 2;
  stillDataUrl: string;
  stillA: string;
  still2DataUrl: string;
  locationPhoto: string | null;
  capturingAngle: 1 | 2;
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
  bundleA: DraftSlot | null;
  bundleB: DraftSlot | null;
  measurement: Measurement | null;
  payload: Payload | null;
  measurementA: Measurement | null;
  measurementB: Measurement | null;
  payloadA: Payload | null;
  payloadB: Payload | null;
  winnerAngle: 1 | 2 | null;
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

function angleToSlot(a: AngleSlot | null): DraftSlot | null {
  if (!a) return null;
  const w = a.photo?.width ?? 0;
  const h = a.photo?.height ?? 0;
  if (!a.photoFor && a.dmg.points.length === 0 && !a.dmg.mask && !a.coinManualPt) return null;
  return slotOf(a.dmg, {
    photoFor: a.photoFor, w, h,
    coinManualPt: a.coinManualPt, coinMask: a.coinMask, coinIou: a.coinIou,
    gateCoin: a.gateCoin, taped: a.taped, hist: a.hist,
  });
}

/** Snapshot the session into a serializable draft. Null when there is
    nothing worth resuming (no photo and no transcript). */
export function collectDraft(session: Session, screen: string, now: () => string = () => new Date().toISOString()): DraftV1 | null {
  const target = mapScreen(screen, session);
  if (!target) return null;
  const hasPhoto = !!(session.stillDataUrl || session.stillA || session.still2DataUrl);
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
    activeAngle: session.activeAngle,
    stillDataUrl: session.stillDataUrl,
    stillA: session.stillA,
    still2DataUrl: session.still2DataUrl,
    locationPhoto: session.locationPhoto,
    capturingAngle: session.capturingAngle,
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
    bundleA: angleToSlot(session.bundleA),
    bundleB: angleToSlot(session.bundleB),
    measurement: session.measurement,
    payload: session.payload,
    measurementA: session.measurementA,
    measurementB: session.measurementB,
    payloadA: session.payloadA,
    payloadB: session.payloadB,
    winnerAngle: session.winnerAngle,
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
    the photo from its still and re-applies the slot when dimensions match. */
export function applyDraft(session: Session, draft: DraftV1): void {
  session.stillDataUrl = draft.stillDataUrl;
  session.stillA = draft.stillA;
  session.still2DataUrl = draft.still2DataUrl;
  session.locationPhoto = draft.locationPhoto;
  session.capturingAngle = draft.capturingAngle;
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
  session.measurement = draft.measurement;
  session.payload = draft.payload;
  session.measurementA = draft.measurementA;
  session.measurementB = draft.measurementB;
  session.payloadA = draft.payloadA;
  session.payloadB = draft.payloadB;
  session.winnerAngle = draft.winnerAngle;

  const toSlot = (d: DraftSlot | null): AngleSlot | null => {
    if (!d) return null;
    return {
      photo: null,
      photoFor: d.photoFor,
      dmg: {
        points: d.points.filter(isPt),
        pointMasks: [],
        mask: inflateMask(d.maskRle, d.w, d.h),
        iou: d.iou,
        source: d.source,
      },
      coinManualPt: isPt(d.coinManualPt) ? d.coinManualPt : null,
      coinMask: inflateMask(d.coinMaskRle, d.w, d.h),
      coinIou: d.coinIou,
      gateCoin: d.gateCoin,
      taped: d.taped,
      hist: d.hist.filter((x) => x === "crack" || x === "coin"),
    };
  };
  // The working state rides in its angle's bundle; Mark loads it on mount.
  const workingSlot = toSlot(draft.working);
  if (draft.activeAngle === 2) {
    session.bundleB = workingSlot ?? toSlot(draft.bundleB);
    session.bundleA = toSlot(draft.bundleA);
  } else {
    session.bundleA = workingSlot ?? toSlot(draft.bundleA);
    session.bundleB = toSlot(draft.bundleB);
  }
  session.photo = null;
  session.photoFor = "";
  session.dmg = {
    points: draft.working.points.filter(isPt),
    pointMasks: [],
    mask: inflateMask(draft.working.maskRle, draft.working.w, draft.working.h),
    iou: draft.working.iou,
    source: draft.working.source,
  };
  session.coinManualPt = isPt(draft.working.coinManualPt) ? draft.working.coinManualPt : null;
  session.coinMask = inflateMask(draft.working.coinMaskRle, draft.working.w, draft.working.h);
  session.coinIou = draft.working.coinIou;
  session.gateCoin = draft.working.gateCoin;
  session.workingHist = draft.working.hist.filter((x) => x === "crack" || x === "coin");
  session.activeAngle = draft.activeAngle;
  session.resumeAngle = draft.activeAngle;
  session.annexUrl = null;
  session.autoListen = false;
  // Background jobs never survive a reload: only completed payloads persist.
  session.measureSeq = 0;
  session.measureJob = null;
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
  // Tier 2: the second angle (its still, bundle, results) goes.
  const t2: DraftV1 = {
    ...t1, still2DataUrl: "", bundleB: null,
    measurementB: null, payloadB: null,
    winnerAngle: t1.winnerAngle === 2 ? 1 : t1.winnerAngle,
  };
  if (write(t2)) return true;
  // Tier 3: payload overlays carry the longest strings (SVG paths); the
  // numbers survive in the measurements without them.
  const stripOverlay = (p: Payload | null): Payload | null => {
    if (!p || typeof p !== "object") return p;
    const { overlay: _dropped, ...rest } = p as Payload & { overlay?: unknown };
    void _dropped;
    return rest as Payload;
  };
  const t3: DraftV1 = {
    ...t2, payload: stripOverlay(t2.payload), payloadA: stripOverlay(t2.payloadA),
    raw: "", extendedTranscript: null,
  };
  if (write(t3)) return true;
  // Tier 4: stills, taps and transcript only - masks re-outline in one tap.
  const stripSlot = (s: DraftSlot | null): DraftSlot | null =>
    s ? { ...s, maskRle: null, coinMaskRle: null, iou: 0, coinIou: 0 } : null;
  const t4: DraftV1 = {
    ...t3, working: stripSlot(t3.working) as DraftSlot, bundleA: stripSlot(t3.bundleA),
  };
  return write(t4);
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
export function draftSummary(d: DraftV1): DraftSummary {
  return {
    step: STEP_LABEL[d.screen] ?? "In progress",
    taps: d.working.points.length,
    savedAt: d.savedAt,
    hasPhoto: !!(d.stillDataUrl || d.stillA || d.still2DataUrl),
  };
}
