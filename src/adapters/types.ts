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
}

export interface FindingsProvider {
  draftFindings(request: FindingsRequest): Promise<FindingDraft[]>;
}
