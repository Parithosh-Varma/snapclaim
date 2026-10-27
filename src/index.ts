export type {
  ComponentObservation,
  DamageLabel,
  MaskObservation,
  MeasuredFinding,
  MeasureSessionInput,
  MeasureSessionResult,
  ScaleReference,
  SeverityBand,
  SeverityThresholds,
} from "./engine/types.ts";
export { areaRatio, calibratedLengthMm, mmPerPx, ratioToPercent, round } from "./engine/math.ts";
export { DEFAULT_SEVERITY_THRESHOLDS, classifySeverity } from "./engine/severity.ts";
export { measureSession } from "./engine/measure.ts";
export { ReceiptLedger } from "./receipts/ledger.ts";
export type { Receipt, ReceiptDraft, ReceiptMethod, ReceiptUnit } from "./receipts/types.ts";
export { EvidenceError, gateFindings, validateFindings } from "./findings/evidence-gate.ts";
export type { FindingDraft, GateResult } from "./findings/evidence-gate.ts";
export { DEFAULT_CONFIG, loadConfig } from "./config/config.ts";
export type { AppConfig } from "./config/config.ts";
export { BudgetExceededError, SpendGuard, estimateCostUsd } from "./config/spend-guard.ts";
export { MockFindingsProvider, MockVisionProvider } from "./adapters/mock.ts";
export type { FindingsProvider, FindingsRequest, VisionProvider, VisionRequest, VisionResult } from "./adapters/types.ts";
