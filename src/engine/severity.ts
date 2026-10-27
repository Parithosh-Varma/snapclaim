import type { SeverityBand, SeverityThresholds } from "./types.ts";
import { MeasurementError, assertNonNegative } from "./math.ts";

export const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = Object.freeze({
  cosmeticMaxRatio: 0.01,
  moderateMaxRatio: 0.05,
  significantCrackMm: 150,
  significantRegionCount: 3,
});

export function validateThresholds(thresholds: SeverityThresholds): void {
  const entries: Array<[string, number]> = [
    ["cosmeticMaxRatio", thresholds.cosmeticMaxRatio],
    ["moderateMaxRatio", thresholds.moderateMaxRatio],
    ["significantCrackMm", thresholds.significantCrackMm],
    ["significantRegionCount", thresholds.significantRegionCount],
  ];
  for (const [name, value] of entries) {
    assertNonNegative(value, `thresholds.${name}`);
  }
  if (thresholds.cosmeticMaxRatio >= thresholds.moderateMaxRatio) {
    throw new MeasurementError("cosmeticMaxRatio must be lower than moderateMaxRatio");
  }
  if (!Number.isInteger(thresholds.significantRegionCount) || thresholds.significantRegionCount < 1) {
    throw new MeasurementError("significantRegionCount must be an integer of at least 1");
  }
}

export interface SeverityInput {
  ratio: number;
  crackLengthMm: number | null;
  regionCount: number;
}

/**
 * Thresholds are defaults, printed in every report and versioned in config.
 * They are not regulatory standards, and the report says so.
 */
export function classifySeverity(
  input: SeverityInput,
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): SeverityBand {
  assertNonNegative(input.ratio, "ratio");
  if (input.ratio > 1) {
    throw new MeasurementError(`ratio must be between 0 and 1, got ${input.ratio}`);
  }
  if (!Number.isInteger(input.regionCount) || input.regionCount < 0) {
    throw new MeasurementError(`regionCount must be a non-negative integer, got ${input.regionCount}`);
  }
  validateThresholds(thresholds);

  const belowLengthEscalation =
    input.crackLengthMm === null || input.crackLengthMm < thresholds.significantCrackMm;

  if (input.ratio < thresholds.cosmeticMaxRatio && belowLengthEscalation && input.regionCount <= 1) {
    return "cosmetic";
  }

  if (input.ratio <= thresholds.moderateMaxRatio && belowLengthEscalation && input.regionCount < thresholds.significantRegionCount) {
    return "moderate";
  }

  return "significant";
}
