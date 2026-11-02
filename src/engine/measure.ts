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

  // No masks at all (clean wall, empty tap): record a verdict receipt so the
  // pipeline can answer "no damage" with a citation instead of failing the
  // gate on an empty evidence set.
  if (masks.length === 0) {
    ledger.add({
      method: "damage_refuted",
      inputs: { masks: 0 },
      output: { value: "no-damage", unit: "band" },
      formula: "no masks supplied - nothing to measure",
      confidence: 1,
      notes: ["no input masks; report stays empty by verdict, not by error"],
    });
  }

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

  // Not-a-crack filter: a crack mask whose every region was flagged
  // blocky (thick, not long-and-thin) or straight-edged (ledge/frame) is
  // the segmenter catching non-damage. Refute it with a receipt instead of
  // measuring noise as damage. Anything with an unflagged region still
  // measures - missing real damage is worse than measuring a false tap.
  const refuted: import("./types.ts").RefutedMask[] = [];
  const measurable = masks.filter((mask) => {
    if ((mask.regionCount ?? 1) === 0) {
      refuted.push({
        maskId: mask.id,
        label: mask.label,
        reason: "empty",
        detail: "mask has no regions - the segmenter found nothing to measure",
      });
      ledger.add({
        method: "damage_refuted",
        inputs: { maskId: mask.id, label: mask.label, regionCount: 0 },
        output: { value: "no-damage", unit: "band" },
        formula: "empty mask - refuted as not-damage",
        confidence: mask.confidence,
        notes: ["empty segmenter output; excluded from findings by verdict, not by error"],
      });
      return false;
    }
    if (mask.label !== "crack") return true;
    const blocky = mask.blockyRegionCount ?? 0;
    const regions = mask.regionCount ?? 1;
    if (blocky < regions) return true;
    refuted.push({
      maskId: mask.id,
      label: mask.label,
      reason: "blocky",
      detail: `${regions} region(s), all blocky-flagged (thick, not long-and-thin) - not crack geometry`,
    });
    ledger.add({
      method: "damage_refuted",
      inputs: {
        maskId: mask.id,
        label: mask.label,
        regionCount: regions,
        blockyRegionCount: blocky,
      },
      output: { value: "no-damage", unit: "band" },
      formula: "all regions blocky - refuted as not-damage",
      confidence: mask.confidence,
      notes: ["tap caught non-damage geometry; excluded from findings by verdict, not by error"],
    });
    return false;
  });

  const findings: MeasuredFinding[] = measurable.map((mask) => measureMask(mask, component, ledger, scale, thresholds, minConfidence));

  return {
    findings,
    receipts: ledger.all(),
    mode: scale === null ? "percent-only" : "absolute",
    verdict: findings.length > 0 ? "damage" : "no-damage",
    refuted,
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

  if (scale !== null) {
    areaCm2Value = areaCm2(mask.areaPx, scale.mmPerPx);
    const areaReceipt = ledger.add({
      method: "calibrated_area",
      inputs: {
        maskId: mask.id,
        damageAreaPx: mask.areaPx,
        mmPerPx: round(scale.mmPerPx, 6),
        scaleReceiptId: scale.receiptId,
      },
      output: { value: areaCm2Value, unit: "cm2" },
      formula: "damageAreaPx * mmPerPx^2 / 100",
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
      crackWidthValue = crackWidthMm(mask.areaPx, mask.skeletonPx, scale.mmPerPx);
      if (crackWidthValue !== null) {
        const widthReceipt = ledger.add({
          method: "calibrated_width",
          inputs: {
            maskId: mask.id,
            damageAreaPx: mask.areaPx,
            skeletonPx: mask.skeletonPx,
            mmPerPx: round(scale.mmPerPx, 6),
            scaleReceiptId: scale.receiptId,
          },
          output: { value: crackWidthValue, unit: "mm" },
          formula: "damageAreaPx / skeletonPx * mmPerPx",
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
