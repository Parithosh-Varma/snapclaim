import type { ComponentObservation, DamageLabel, MaskObservation, MeasuredFinding } from "../engine/types.ts";
import type { Receipt } from "../receipts/types.ts";
import type { FindingDraft } from "../findings/evidence-gate.ts";

export interface VisionRequest {
  imageId: string;
  labels: DamageLabel[];
}

export interface VisionResult {
  component: ComponentObservation;
  masks: MaskObservation[];
}

export interface VisionProvider {
  segment(request: VisionRequest): Promise<VisionResult>;
}

export interface FindingsRequest {
  transcript: string;
  findings: MeasuredFinding[];
  receipts: Receipt[];
  /**
   * Gate rejections from a previous draft on this same report. When set, the
   * model gets one repair retry with the exact reasons appended — the common
   * case is a draft citing scale/count numbers no citation can verify.
   */
  repairNote?: string;
}

export interface FindingsProvider {
  draftFindings(request: FindingsRequest): Promise<FindingDraft[]>;
}
