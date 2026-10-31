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
  { value: 25, label: "India ₹5 · 25 mm", group: "India" },
  { value: 23, label: "India ₹2 · 23 mm", group: "India" },
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
