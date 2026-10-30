// Mutable per-claim session: large/binary state that should not live in
// React state (canvases, masks, backend payloads). React state mirrors only
// what the screens render; this object is the single source of truth between
// steps, exactly like the module-level variables in the vanilla app.js.
import type { Rle } from "./rle";

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
  currentCaseId: string | null;
  annexUrl: string | null;
}

export function createSession(): Session {
  return {
    stillDataUrl: "",
    photo: null,
    photoFor: "",
    autoListen: false,
    gateCoin: null,
    coinLabel: "",
    coinKindMm: 27,
    coinManualPt: null,
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
    currentCaseId: null,
    annexUrl: null,
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

export const COIN_OPTIONS: { value: number; label: string }[] = [
  { value: 27, label: "India ₹10 · 27 mm" },
  { value: 25, label: "India ₹5 · 25 mm" },
  { value: 23, label: "India ₹2 · 23 mm" },
  { value: 22, label: "India ₹1 · 22 mm" },
  { value: 24.26, label: "US quarter · 24.26 mm" },
  { value: 23.88, label: "Canadian quarter · 23.88 mm" },
  { value: 24.5, label: "UK 10p · 24.5 mm" },
  { value: 23.25, label: "1 euro · 23.25 mm" },
];
