import type {
  ComponentObservation,
  MaskObservation,
  MeasuredFinding,
  MeasureSessionInput,
  MeasureSessionResult,
  ScaleReference,
} from "./types.ts";
import {
  DEFAULT_MIN_REFERENCE_CONFIDENCE,
  MeasurementError,
  areaCm2,
  areaRatio,
  calibratedLengthMm,
  crackWidthMm,
  mmPerPx,
  ratioToPercent,
  round,
} from "./math.ts";
import { DEFAULT_SEVERITY_THRESHOLDS, classifySeverity, validateThresholds } from "./severity.ts";
import type { DamageLabel } from "./types.ts";
import { ReceiptLedger } from "../receipts/ledger.ts";
import { decodeRle } from "../vision/mask.ts";

const DAMAGE_LABELS: ReadonlySet<string> = new Set(["crack", "stain", "peel", "dent"]);

/** Fail closed on taxonomy pollution: only the engine's labels measure. */
export function assertDamageLabel(label: unknown): asserts label is DamageLabel {
  if (typeof label !== "string" || !DAMAGE_LABELS.has(label)) {
    throw new MeasurementError(
      `mask label must be one of ${[...DAMAGE_LABELS].join(", ")}, got ${JSON.stringify(label)}`,
    );
  }
}

/**
 * Deterministic measurement session.
 *
 * No model touches the numbers: masks in, receipts out. Every published value
 * carries the formula, inputs and confidence needed to recompute it offline.
 */
export function measureSession(input: MeasureSessionInput): MeasureSessionResult {
  const { component, masks } = input;
  if (!Number.isFinite(component.areaPx) || component.areaPx <= 0) {
    throw new MeasurementError("component.areaPx must be a positive number");
  }
  if (typeof component.id !== "string" || component.id === "") {
    throw new MeasurementError("component.id must be a non-empty string");
  }
  if (!Number.isFinite(component.confidence)) {
    throw new MeasurementError(`component.confidence must be a finite number, got ${component.confidence}`);
  }
  for (const mask of masks) {
    assertDamageLabel(mask.label);
    if (!Number.isFinite(mask.confidence)) {
      throw new MeasurementError(`mask ${mask.id} confidence must be a finite number, got ${mask.confidence}`);
    }
  }
  // Pixel binding: when a mask carries RLE, the claimed areaPx/skeletonPx
  // must agree with the decoded pixels. Absent RLE = self-reported.
  let verified = masks.length > 0;
  for (const mask of masks) {
    if (mask.rle === undefined) {
      verified = false;
      continue;
    }
    let counted: number;
    try {
      const decoded = decodeRle(mask.rle as never);
      counted = 0;
      for (const v of decoded.data) if (v !== 0) counted++;
    } catch (error) {
      throw new MeasurementError(`mask ${mask.id} rle invalid: ${error instanceof Error ? error.message : "cannot decode"}`);
    }
    const tol = Math.max(2, Math.round(counted * 0.01));
    if (Math.abs(mask.areaPx - counted) > tol) {
      throw new MeasurementError(
        `mask ${mask.id} areaPx ${mask.areaPx} disagrees with decoded rle pixels ${counted} (tolerance ${tol}) - resubmit via /v1/observe`,
      );
    }
    if (mask.skeletonPx !== undefined && mask.skeletonPx > counted * 2) {
      throw new MeasurementError(
        `mask ${mask.id} skeletonPx ${mask.skeletonPx} exceeds 2x decoded pixels ${counted} - resubmit via /v1/observe`,
      );
    }
  }

  const thresholds = input.thresholds ?? DEFAULT_SEVERITY_THRESHOLDS;
  validateThresholds(thresholds);
  const minConfidence = input.minReferenceConfidence ?? DEFAULT_MIN_REFERENCE_CONFIDENCE;
  const ledger = new ReceiptLedger();

  let scale: { receiptId: string; mmPerPx: number; reference: ScaleReference } | null = null;

  if (input.scaleReference !== undefined) {
    const reference = input.scaleReference;
    const scaleValue = mmPerPx(reference, minConfidence);

    if (scaleValue === null) {
      ledger.add({
        method: "scale_rejected",
        inputs: {
          referenceId: reference.id,
          confidence: reference.confidence,
          minConfidence,
        },
        output: { value: "percent-only", unit: "band" },
        formula: "reference rejected when confidence < minConfidence",
        confidence: reference.confidence,
        notes: ["absolute lengths withheld; report stays in percent-only mode"],
      });
    } else {
      const receipt = ledger.add({
        method: "scale_calibration",
        inputs: {
          referenceId: reference.id,
          knownMm: reference.knownMm,
          lengthPx: reference.lengthPx,
          confidence: reference.confidence,
        },
        output: { value: round(scaleValue, 6), unit: "mm_per_px" },
        formula: "knownMm / referenceLengthPx",
        confidence: reference.confidence,
        notes: [],
      });
      scale = { receiptId: receipt.id, mmPerPx: scaleValue, reference };
    }
  }

  const findings: MeasuredFinding[] = masks.map((mask) => measureMask(mask, component, ledger, scale, thresholds, minConfidence));

  return {
    findings,
    receipts: ledger.all(),
    mode: scale === null ? "percent-only" : "absolute",
    provenance: verified ? "pixel-verified" : "self-reported",
  };
}

function measureMask(
  mask: MaskObservation,
  component: ComponentObservation,
  ledger: ReceiptLedger,
  scale: { receiptId: string; mmPerPx: number; reference: ScaleReference } | null,
  thresholds: typeof DEFAULT_SEVERITY_THRESHOLDS,
  minConfidence: number,
): MeasuredFinding {
  const ratio = areaRatio(mask.areaPx, component.areaPx);
  const percent = ratioToPercent(ratio);
  const regionCount = mask.regionCount ?? 1;

  const ratioReceipt = ledger.add({
    method: "area_ratio",
    inputs: {
      maskId: mask.id,
      label: mask.label,
      componentId: component.id,
      componentConfidence: component.confidence,
      damageAreaPx: mask.areaPx,
      componentAreaPx: component.areaPx,
      ratioRaw: ratio,
    },
    output: { value: percent, unit: "percent" },
    formula: "damageAreaPx / componentAreaPx * 100",
    confidence: mask.confidence,
    notes: [],
  });

  const regionReceipt = ledger.add({
    method: "region_count",
    inputs: { maskId: mask.id },
    output: { value: regionCount, unit: "count" },
    formula: "count of disconnected mask components",
    confidence: mask.confidence,
    notes: [],
  });

  let crackLengthMm: number | null = null;
  let lengthReceiptId: string | null = null;
  let areaCm2Value: number | null = null;
  let areaReceiptId: string | null = null;
  let crackWidthValue: number | null = null;
  let widthReceiptId: string | null = null;

  // Area on the wall: photo pixels, or the tilt-corrected area when there is one.
  const plane: Record<string, number> = mask.planeAreaPx === undefined ? { damageAreaPx: mask.areaPx } : { planeAreaPx: mask.planeAreaPx };
  const planeName = mask.planeAreaPx === undefined ? "damageAreaPx" : "planeAreaPx";
  const planeAreaPx = mask.planeAreaPx ?? mask.areaPx;

  if (scale !== null) {
    areaCm2Value = areaCm2(planeAreaPx, scale.mmPerPx);
    const areaReceipt = ledger.add({
      method: "calibrated_area",
      inputs: {
        maskId: mask.id,
        ...plane,
        mmPerPx: round(scale.mmPerPx, 6),
        scaleReceiptId: scale.receiptId,
      },
      output: { value: areaCm2Value, unit: "cm2" },
      formula: `${planeName} * mmPerPx^2 / 100`,
      confidence: round(mask.confidence * scale.reference.confidence, 3),
      notes: [],
    });
    areaReceiptId = areaReceipt.id;
  }

  if (mask.label === "crack" && mask.skeletonPx !== undefined && scale !== null) {
    crackLengthMm = calibratedLengthMm(mask.skeletonPx, scale.reference, minConfidence);
    if (crackLengthMm !== null) {
      const lengthReceipt = ledger.add({
        method: "calibrated_length",
        inputs: {
          maskId: mask.id,
          skeletonPx: mask.skeletonPx,
          mmPerPx: round(scale.mmPerPx, 6),
          scaleReceiptId: scale.receiptId,
        },
        output: { value: crackLengthMm, unit: "mm" },
        formula: "skeletonPx * mmPerPx",
        confidence: round(mask.confidence * scale.reference.confidence, 3),
        notes: [],
      });
      lengthReceiptId = lengthReceipt.id;
    }
    if (mask.skeletonPx > 0) {
      crackWidthValue = crackWidthMm(planeAreaPx, mask.skeletonPx, scale.mmPerPx);
      if (crackWidthValue !== null) {
        const widthReceipt = ledger.add({
          method: "calibrated_width",
          inputs: {
            maskId: mask.id,
            ...plane,
            skeletonPx: mask.skeletonPx,
            mmPerPx: round(scale.mmPerPx, 6),
            scaleReceiptId: scale.receiptId,
          },
          output: { value: crackWidthValue, unit: "mm" },
          formula: `${planeName} / skeletonPx * mmPerPx`,
          confidence: round(mask.confidence * scale.reference.confidence, 3),
          notes: [],
        });
        widthReceiptId = widthReceipt.id;
      }
    }
  }

  const severity = classifySeverity({ ratio, crackLengthMm, regionCount }, thresholds);
  const severityReceipt = ledger.add({
    method: "severity_classification",
    inputs: {
      maskId: mask.id,
      percent,
      crackLengthMm,
      regionCount,
      cosmeticMaxRatio: thresholds.cosmeticMaxRatio,
      moderateMaxRatio: thresholds.moderateMaxRatio,
      significantCrackMm: thresholds.significantCrackMm,
      significantRegionCount: thresholds.significantRegionCount,
    },
    output: { value: severity, unit: "band" },
    formula: "area ratio + calibrated length + region count vs printed thresholds",
    confidence: null,
    notes:
      crackLengthMm === null
        ? ["no calibrated length; severity judged without absolute units"]
        : [],
  });

  return {
    maskId: mask.id,
    label: mask.label,
    areaPx: mask.areaPx,
    regionCount,
    ratio,
    percent,
    crackLengthMm,
    areaCm2: areaCm2Value,
    crackWidthMm: crackWidthValue,
    severity,
    receiptIds: {
      ratio: ratioReceipt.id,
      length: lengthReceiptId,
      area: areaReceiptId,
      width: widthReceiptId,
      severity: severityReceipt.id,
      regions: regionReceipt.id,
    },
  };
}
