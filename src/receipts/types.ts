export type ReceiptMethod =
  | "area_ratio"
  | "region_count"
  | "scale_calibration"
  | "scale_rejected"
  | "calibrated_length"
  | "severity_classification";

export type ReceiptUnit = "percent" | "ratio" | "count" | "mm" | "mm_per_px" | "band";

export interface Receipt {
  id: string;
  method: ReceiptMethod;
  inputs: Record<string, string | number | boolean | null>;
  output: { value: number | string; unit: ReceiptUnit };
  formula: string;
  confidence: number | null;
  notes: string[];
}

export type ReceiptDraft = Omit<Receipt, "id">;
