import type { Receipt } from "../receipts/types.ts";

export type DamageLabel = "crack" | "stain" | "peel" | "dent";

export interface MaskObservation {
  id: string;
  label: DamageLabel;
  areaPx: number;
  /** Skeleton length in pixels. Required for calibrated length on cracks. */
  skeletonPx?: number;
  /** Disconnected regions of damage; defaults to 1 when the segmenter does not report it. */
  regionCount?: number;
  /**
   * Crack regions that are thick rather than long and thin, usually a tap that
   * caught a stone block or a patch of wall. Their area is still counted; the
   * flag lets the user undo the tap before it inflates the report.
   */
  blockyRegionCount?: number;
  blockyAreaPx?: number;
  confidence: number;
}

export interface ComponentObservation {
  id: string;
  areaPx: number;
  confidence: number;
}

export interface ScaleReference {
  id: string;
  /** Physical size of the reference object, in millimetres. */
  knownMm: number;
  /** Length of that object in the image, in pixels, measured in the same plane as the damage. */
  lengthPx: number;
  confidence: number;
}

export type SeverityBand = "cosmetic" | "moderate" | "significant";

export interface SeverityThresholds {
  cosmeticMaxRatio: number;
  moderateMaxRatio: number;
  significantCrackMm: number;
  significantRegionCount: number;
}

export interface MeasuredFinding {
  maskId: string;
  label: DamageLabel;
  areaPx: number;
  regionCount: number;
  ratio: number;
  percent: number;
  crackLengthMm: number | null;
  severity: SeverityBand;
  receiptIds: {
    ratio: string;
    length: string | null;
    severity: string;
    regions: string;
  };
}

export interface MeasureSessionInput {
  component: ComponentObservation;
  masks: MaskObservation[];
  scaleReference?: ScaleReference;
  thresholds?: SeverityThresholds;
  minReferenceConfidence?: number;
}

export interface MeasureSessionResult {
  findings: MeasuredFinding[];
  receipts: Receipt[];
  mode: "absolute" | "percent-only";
}
