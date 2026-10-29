import { MeasurementError } from "../engine/math.ts";
import { assertMask, type BinaryMask } from "./mask.ts";

/**
 * Agreement between two masks of the same frame — the planned independent
 * check between the on-device SlimSAM preview and authoritative SAM 3.1.
 * Pure set math on pixels; no models, no thresholds hidden from the caller.
 */

export interface Agreement {
  intersection: number;
  union: number;
  iou: number;
  dice: number;
}

export function maskAgreement(a: BinaryMask, b: BinaryMask): Agreement {
  assertMask(a, "a");
  assertMask(b, "b");
  if (a.width !== b.width || a.height !== b.height) {
    throw new MeasurementError(`masks differ in size: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.data.length; i++) {
    const onA = a.data[i] !== 0;
    const onB = b.data[i] !== 0;
    if (onA && onB) intersection++;
    if (onA || onB) union++;
  }
  if (union === 0) return { intersection: 0, union: 0, iou: 1, dice: 1 };
  const iou = intersection / union;
  const dice = (2 * intersection) / (aOn(a) + aOn(b) || 1);
  return { intersection, union, iou: round3(iou), dice: round3(dice) };
}

function aOn(mask: BinaryMask): number {
  let n = 0;
  for (const v of mask.data) if (v !== 0) n++;
  return n;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Verdict for the skeptic cross-check: DISPUTED below threshold, else AGREED. */
export function agreementVerdict(agreement: Agreement, minIou = 0.5): "AGREED" | "DISPUTED" {
  if (!Number.isFinite(minIou) || minIou < 0 || minIou > 1) {
    throw new MeasurementError(`minIou must be between 0 and 1, got ${minIou}`);
  }
  return agreement.iou >= minIou ? "AGREED" : "DISPUTED";
}
