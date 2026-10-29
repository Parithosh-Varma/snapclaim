import type { ScaleReference } from "./types.ts";

export const DEFAULT_MIN_REFERENCE_CONFIDENCE = 0.6;

export class MeasurementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeasurementError";
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new MeasurementError(`${name} must be a finite number, got ${value}`);
  }
}

export function assertNonNegative(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) {
    throw new MeasurementError(`${name} must be non-negative, got ${value}`);
  }
}

export function round(value: number, decimalPlaces: number): number {
  assertFinite(value, "value");
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 10) {
    throw new MeasurementError(`decimalPlaces must be an integer between 0 and 10, got ${decimalPlaces}`);
  }
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}

/**
 * Damage area as a fraction of the component area.
 * Physically impossible inputs throw instead of silently producing a number.
 */
export function areaRatio(damageAreaPx: number, componentAreaPx: number): number {
  assertNonNegative(damageAreaPx, "damageAreaPx");
  assertNonNegative(componentAreaPx, "componentAreaPx");
  if (componentAreaPx === 0) {
    throw new MeasurementError("componentAreaPx must be greater than zero");
  }
  if (damageAreaPx > componentAreaPx) {
    throw new MeasurementError(
      `damage area (${damageAreaPx}px) exceeds component area (${componentAreaPx}px) — mask leak, refusing to publish a ratio`,
    );
  }
  return damageAreaPx / componentAreaPx;
}

export function ratioToPercent(ratio: number, decimalPlaces = 2): number {
  assertFinite(ratio, "ratio");
  if (ratio < 0 || ratio > 1) {
    throw new MeasurementError(`ratio must be between 0 and 1, got ${ratio}`);
  }
  return round(ratio * 100, decimalPlaces);
}

/**
 * Millimetres per pixel from a reference object.
 * Returns null when the reference confidence is below the threshold — the report
 * then stays in percent-only mode rather than inventing absolute units.
 */
export function mmPerPx(
  reference: ScaleReference,
  minConfidence = DEFAULT_MIN_REFERENCE_CONFIDENCE,
): number | null {
  assertNonNegative(reference.confidence, "reference.confidence");
  if (reference.confidence < minConfidence) {
    return null;
  }
  if (!Number.isFinite(reference.knownMm) || reference.knownMm <= 0) {
    throw new MeasurementError(`reference.knownMm must be greater than zero, got ${reference.knownMm}`);
  }
  if (!Number.isFinite(reference.lengthPx) || reference.lengthPx <= 0) {
    throw new MeasurementError(`reference.lengthPx must be greater than zero, got ${reference.lengthPx}`);
  }
  return reference.knownMm / reference.lengthPx;
}

export function calibratedLengthMm(
  skeletonPx: number,
  reference: ScaleReference,
  minConfidence = DEFAULT_MIN_REFERENCE_CONFIDENCE,
): number | null {
  assertNonNegative(skeletonPx, "skeletonPx");
  const scale = mmPerPx(reference, minConfidence);
  if (scale === null) {
    return null;
  }
  return round(skeletonPx * scale, 1);
}

/**
 * Calibrated damage area in cm². Requires a confident scale reference;
 * returns null in percent-only mode so the report never invents units.
 */
export function areaCm2(areaPx: number, scaleMmPerPx: number): number {
  assertNonNegative(areaPx, "areaPx");
  assertFinite(scaleMmPerPx, "scaleMmPerPx");
  if (scaleMmPerPx <= 0) {
    throw new MeasurementError(`scaleMmPerPx must be greater than zero, got ${scaleMmPerPx}`);
  }
  return round((areaPx * scaleMmPerPx * scaleMmPerPx) / 100, 2);
}

/**
 * Mean crack width in mm: area / centreline length × scale.
 * Returns null without a skeleton (non-crack labels) — never divides by zero.
 */
export function crackWidthMm(areaPx: number, skeletonPx: number, scaleMmPerPx: number): number | null {
  assertNonNegative(areaPx, "areaPx");
  assertNonNegative(skeletonPx, "skeletonPx");
  assertFinite(scaleMmPerPx, "scaleMmPerPx");
  if (scaleMmPerPx <= 0) {
    throw new MeasurementError(`scaleMmPerPx must be greater than zero, got ${scaleMmPerPx}`);
  }
  if (skeletonPx === 0) return null;
  return round((areaPx / skeletonPx) * scaleMmPerPx, 1);
}
