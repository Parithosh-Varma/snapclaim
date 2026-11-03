// Mutable per-claim session: large/binary state that should not live in
// React state (canvases, masks, backend payloads). React state mirrors only
// what the screens render; this object is the single source of truth between
// steps, exactly like the module-level variables in the vanilla app.js.
import type { Rle } from "./rle.ts";

export interface GateCoin {
  cx: number; cy: number; rr: number; fw: number; fh: number;
  sw: number; sh: number; sx: number; sy: number;
}

export interface SamMask {
  mask: Uint8Array;
  iou: number;
  rle?: Rle;
}

export interface DmgState {
  points: [number, number][];
  pointMasks: (SamMask | null)[];
  mask: Uint8Array | null;
  iou: number;
  source: "api" | "device" | null;
}

/** Per-angle work: everything Mark mutates lives here so two angles can be
    marked independently, then the stronger measurement wins. */
export interface AngleSlot {
  photo: HTMLCanvasElement | null;
  photoFor: string;
  dmg: DmgState;
  coinManualPt: [number, number] | null;
  coinMask: Uint8Array | null;
  coinIou: number;
  gateCoin: GateCoin | null;
  taped: boolean;
  /** Undo order for the taps above; kept so a draft resume pops correctly. */
  hist: ("crack" | "coin")[];
}

export function freshAngleSlot(): AngleSlot {
  return {
    photo: null,
    photoFor: "",
    dmg: { points: [], pointMasks: [], mask: null, iou: 0, source: null },
    coinManualPt: null,
    coinMask: null,
    coinIou: 0,
    gateCoin: null,
    taped: false,
    hist: [],
  };
}

/** Best view wins: the angle covering more of the frame measured more of the
    damage, so its numbers stand for the report. Ties and missing angles fall
    back to angle 1. */
export function pickWinnerAngle(
  a: { percent: number } | null,
  b: { percent: number } | null,
): 1 | 2 {
  if (!a) return 2;
  if (!b) return 1;
  return b.percent > a.percent ? 2 : 1;
}

export interface Finding {
  label: string;
  percent: number;
  crackLengthMm: number | null;
  crackWidthMm?: number | null;
  areaCm2: number | null;
  regionCount?: number;
  severity: string;
  statement?: string;
  citations?: string[];
  [key: string]: unknown;
}

export interface Receipt {
  id: string;
  output?: { value?: unknown; unit?: string };
  [key: string]: unknown;
}

export interface Measurement {
  findings: Finding[];
  receipts: Receipt[];
  mode: string;
  [key: string]: unknown;
}

export interface OverlayMask {
  label: string;
  path: string;
}

export interface Payload {
  overlay?: { width: number; height: number; masks: OverlayMask[] };
  [key: string]: unknown;
}

/** Background measurement started from Mark, overlapping the Describe step.
 *  The promise itself is transient (never drafted); only completed
 *  payload/measurement persist. `seq` guards staleness: a new measure(),
 *  new taps/coin/photo, or a new case bumps `measureSeq` so a late landing
 *  is discarded. */
export interface MeasureJob {
  seq: number;
  state: "running" | "done" | "error";
  error?: string;
  promise: Promise<void>;
  /** Input snapshot: a late landing whose inputs no longer match is stale. */
  photoFor: string;
  points: [number, number][];
  coinKindMm: number;
  noScaleMode: boolean;
  coinPt: [number, number] | null;
  hasGateCoin: boolean;
  dmgLabel: string;
}

export interface Session {
  stillDataUrl: string;
  photo: HTMLCanvasElement | null;
  /** stillDataUrl the marking photo was built from (back-nav keeps the mask). */
  photoFor: string;
  /** One-shot: Say auto-starts the mic only right after measure/sample. */
  autoListen: boolean;
  gateCoin: GateCoin | null;
  coinLabel: string;
  coinKindMm: number;
  /** Manual coin-center tap in marking-photo pixels (correction for a missed gate). Cleared on a new photo. */
  coinManualPt: [number, number] | null;
  /** SAM outline of the manual coin tap (same tap-to-outline as the crack). Cleared on a new photo. */
  coinMask: Uint8Array | null;
  coinIou: number;
  /** Coin has tape: the outline check allows a tape-halo margin. */
  coinTaped: boolean;
  noScaleMode: boolean;
  dmg: DmgState;
  dmgLabel: string;
  payload: Payload | null;
  measurement: Measurement | null;
  reportStatement: string | null;
  reportFail: string | null;
  raw: string;
  transcript: string;
  /** Optional wide shot showing where the damage is - context only, never measured. */
  locationPhoto: string | null;
  /** Which capture slot the camera is filling (1, then 2 for the second angle). */
  capturingAngle: 1 | 2;
  /** Permanent angle-A still (the working stillDataUrl gets swapped while marking B). */
  stillA: string;
  /** Second-angle still, empty until the second photo is taken. */
  still2DataUrl: string;
  /** Per-angle marking state; the working fields mirror the active angle. */
  bundleA: AngleSlot | null;
  bundleB: AngleSlot | null;
  /** Per-angle results; the winner drives Say/Numbers/Check/Report. */
  measurementA: Measurement | null;
  measurementB: Measurement | null;
  payloadA: Payload | null;
  payloadB: Payload | null;
  winnerAngle: 1 | 2 | null;
  /** AI extension of the manual line, written at report time - null until then. */
  extendedTranscript: string | null;
  currentCaseId: string | null;
  annexUrl: string | null;
  /** Which angle is showing in Mark; the draft snapshotter needs it. */
  activeAngle: 1 | 2;
  /** Undo order for the working taps; Mark mirrors histRef here on every draw. */
  workingHist: ("crack" | "coin")[];
  /** One-shot resume target for Mark's mount after a draft restore. */
  resumeAngle: 1 | 2 | null;
  /** Overlap plumbing: monotonic seq + the in-flight background job. */
  measureSeq: number;
  measureJob: MeasureJob | null;
}

export function createSession(): Session {
  return {
    stillDataUrl: "",
    photo: null,
    photoFor: "",
    autoListen: false,
    gateCoin: null,
    coinLabel: "",
    coinKindMm: 0,
    coinManualPt: null,
    coinMask: null,
    coinIou: 0,
    coinTaped: false,
    noScaleMode: false,
    dmg: { points: [], pointMasks: [], mask: null, iou: 0, source: null },
    dmgLabel: "crack",
    payload: null,
    measurement: null,
    reportStatement: null,
    reportFail: null,
    raw: "{}",
    transcript: "",
    locationPhoto: null,
    capturingAngle: 1,
    stillA: "",
    still2DataUrl: "",
    bundleA: null,
    bundleB: null,
    measurementA: null,
    measurementB: null,
    payloadA: null,
    payloadB: null,
    winnerAngle: null,
    extendedTranscript: null,
    currentCaseId: null,
    annexUrl: null,
    activeAngle: 1,
    workingHist: [],
    resumeAngle: null,
    measureSeq: 0,
    measureJob: null,
  };
}

export function resetDmg(s: Session): void {
  s.dmg = { points: [], pointMasks: [], mask: null, iou: 0, source: null };
}

export const MASK_COLORS: Record<string, string> = {
  crack: "#c0392b",
  stain: "#f39c12",
  peel: "#2980b9",
  dent: "#8e44ad",
  coin: "#0f7a36",
};

export interface CoinOption {
  value: number;
  label: string;
  group: string;
}

export const COIN_OPTIONS: CoinOption[] = [
  { value: 0, label: "Choose the reference size…", group: "" },
  { value: 24.26, label: "US quarter · 24.26 mm", group: "USA" },
  { value: 21.21, label: "US nickel · 21.21 mm", group: "USA" },
  { value: 19.05, label: "US penny · 19.05 mm", group: "USA" },
  { value: 17.91, label: "US dime · 17.91 mm", group: "USA" },
  { value: 23.88, label: "Canadian quarter · 23.88 mm", group: "Canada" },
  { value: 25.75, label: "€2 · 25.75 mm", group: "Eurozone" },
  { value: 24.25, label: "€ 50 cent · 24.25 mm", group: "Eurozone" },
  { value: 23.25, label: "1 euro · 23.25 mm", group: "Eurozone" },
  { value: 22.25, label: "€ 20 cent · 22.25 mm", group: "Eurozone" },
  { value: 21.25, label: "€ 5 cent · 21.25 mm", group: "Eurozone" },
  { value: 19.75, label: "€ 10 cent · 19.75 mm", group: "Eurozone" },
  { value: 18.75, label: "€ 2 cent · 18.75 mm", group: "Eurozone" },
  { value: 16.25, label: "€ 1 cent · 16.25 mm", group: "Eurozone" },
  { value: 28.4, label: "UK £2 · 28.4 mm", group: "UK" },
  { value: 27.3, label: "UK 50p · 27.3 mm", group: "UK" },
  { value: 25.9, label: "UK 2p · 25.9 mm", group: "UK" },
  { value: 24.5, label: "UK 10p · 24.5 mm", group: "UK" },
  { value: 23.03, label: "UK £1 · 23.03 mm", group: "UK" },
  { value: 21.4, label: "UK 20p · 21.4 mm", group: "UK" },
  { value: 20.3, label: "UK 1p · 20.3 mm", group: "UK" },
  { value: 18, label: "UK 5p · 18 mm", group: "UK" },
  { value: 27, label: "India ₹10 · 27 mm", group: "India" },
  { value: 27, label: "India ₹5 · 27 mm", group: "India" },
  { value: 25, label: "India ₹2 · 25 mm (nominal — verify yours)", group: "India" },
  { value: 22, label: "India ₹1 · 22 mm", group: "India" },
  { value: 26.5, label: "Japanese ¥500 · 26.5 mm", group: "Japan" },
  { value: 23.5, label: "Japanese ¥10 · 23.5 mm", group: "Japan" },
  { value: 22.6, label: "Japanese ¥100 · 22.6 mm", group: "Japan" },
  { value: 22, label: "Japanese ¥5 · 22 mm", group: "Japan" },
  { value: 21, label: "Japanese ¥50 · 21 mm", group: "Japan" },
  { value: 20, label: "Japanese ¥1 · 20 mm", group: "Japan" },
];

/** Grouped presets for the <optgroup> picker (stable region order, USA first). */
export const COIN_GROUPS: { name: string; options: CoinOption[] }[] = (() => {
  const order = ["USA", "Canada", "Eurozone", "UK", "India", "Japan"];
  return order
    .map((name) => ({ name, options: COIN_OPTIONS.filter((o) => o.group === name) }))
    .filter((g) => g.options.length);
})();

/* The coin size the user last confirmed. The on-device coin classifier is a
 * colour-only guess (silver coins all look alike without absolute scale), so
 * its guess never sets the scale: on 16 real photos of a 25 mm coin it named
 * six different coins, 20-27 mm, at 33-38% confidence. The user's own last
 * pick is the default instead, and the Mark screen still asks them to confirm. */
const LAST_COIN_KEY = "snapclaim.lastCoin";

export function loadLastCoin(): { mm: number; label: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_COIN_KEY) ?? "null") as { mm?: unknown; label?: unknown } | null;
    const mm = Number(v?.mm);
    if (!(mm > 0 && mm <= 200)) return null;
    return { mm, label: typeof v?.label === "string" ? v.label : "" };
  } catch {
    return null;
  }
}

export function saveLastCoin(mm: number, label: string): void {
  try {
    if (mm > 0 && mm <= 200) localStorage.setItem(LAST_COIN_KEY, JSON.stringify({ mm, label }));
    else localStorage.removeItem(LAST_COIN_KEY);
  } catch { /* storage may be unavailable; the claim flow must not break */ }
}

/** Put the user's last confirmed coin size (or none) on the session. */
export function applyLastCoin(s: Pick<Session, "coinKindMm" | "coinLabel">): void {
  const last = loadLastCoin();
  s.coinKindMm = last?.mm ?? 0;
  s.coinLabel = last?.label ?? "";
}
