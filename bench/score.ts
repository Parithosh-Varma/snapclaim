/** What the skeptic says about one measured finding after re-measuring it. */
export type SkepticVerdict = "CONFIRMED" | "DISPUTED";

/** Hand label for one finding: should an honest skeptic dispute it? */
export interface DisputeLabel {
  caseId: string;
  maskId: string;
  expected: SkepticVerdict;
  /** Why, e.g. "scale marker occluded". Printed in the report next to misses. */
  reason?: string;
}

/** Spark Open's verdict for the same finding, read from the run's receipts. */
export interface DisputePrediction {
  caseId: string;
  maskId: string;
  verdict: SkepticVerdict;
}

export interface DisputeScore {
  /** DISPUTED is the positive class: a wrongly confirmed finding is the costly miss. */
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  /** null when there is nothing to divide by, instead of a misleading 0 or 1. */
  precision: number | null;
  recall: number | null;
  /** Labeled findings the run never produced a verdict for. Counted, not skipped. */
  missing: string[];
}

/**
 * Scores the skeptic's DISPUTED calls against hand labels, matched on caseId + maskId.
 * Draft: signature only, the counting lands with the first held-out cases.
 */
export function scoreDisputes(_labels: DisputeLabel[], _predictions: DisputePrediction[]): DisputeScore {
  throw new Error("scoreDisputes is not implemented yet");
}
