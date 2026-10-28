import type { DamageLabel, MaskObservation, ScaleReference } from "../engine/types.ts";
import { MeasurementError, round } from "../engine/math.ts";
import {
  type BinaryMask,
  assertMask,
  connectedRegions,
  intersectMasks,
  maskFromRegions,
  skeletonLengthPx,
  skeletonize,
} from "./mask.ts";

export interface ObserveMaskOptions {
  id: string;
  label: DamageLabel;
  /** Segmenter confidence for this mask, passed through unchanged. */
  confidence: number;
  /** When given, damage outside the component is dropped before measuring. */
  component?: BinaryMask;
  /** Regions smaller than this are treated as segmentation speckle and ignored. */
  minRegionAreaPx?: number;
}

/**
 * Pixel mask → the statistics the measurement engine consumes.
 * Area and region count for every label; skeleton length for cracks.
 */
export function observeMask(mask: BinaryMask, options: ObserveMaskOptions): MaskObservation {
  assertMask(mask);
  const minRegionAreaPx = options.minRegionAreaPx ?? 0;
  if (!Number.isFinite(minRegionAreaPx) || minRegionAreaPx < 0) {
    throw new MeasurementError(`minRegionAreaPx must be non-negative, got ${minRegionAreaPx}`);
  }

  const clipped = options.component === undefined ? mask : intersectMasks(mask, options.component);
  const regions = connectedRegions(clipped).filter((region) => region.areaPx >= minRegionAreaPx);
  const areaPx = regions.reduce((sum, region) => sum + region.areaPx, 0);

  const observation: MaskObservation = {
    id: options.id,
    label: options.label,
    areaPx,
    regionCount: regions.length,
    confidence: options.confidence,
  };

  if (options.label === "crack" && regions.length > 0) {
    const kept = maskFromRegions(clipped.width, clipped.height, regions);
    observation.skeletonPx = round(skeletonLengthPx(skeletonize(kept)), 1);
  }

  return observation;
}

export interface ReferenceDiagnostics {
  /** Major axis of the best-fit ellipse, in pixels. Used as the reference length. */
  majorPx: number;
  minorPx: number;
  /** minor / major. 1 for a coin seen straight on; lower when tilted or occluded. */
  aspect: number;
  /** Mask area / ellipse area. Drops when part of the coin is hidden or bitten off. */
  fill: number;
  /** Share of the mask in its largest region. Below 1 means stray pixels were ignored. */
  largestShare: number;
}

export interface CircularReferenceOptions {
  id: string;
  /** Real diameter of the coin or disc, in millimetres. */
  knownMm: number;
  /** Segmenter confidence for the coin mask. */
  confidence: number;
}

/**
 * Coin mask → scale reference.
 *
 * The diameter is the major axis of the ellipse with the same second moments
 * as the mask (4·√λ₁), which survives rotation and stays the true diameter
 * when the coin is tilted. Confidence is the segmenter's, discounted by
 * aspect, fill and stray-pixel share, so a tilted or partly covered coin
 * falls below the engine's threshold and the report drops to percent-only.
 */
export function circularReference(
  mask: BinaryMask,
  options: CircularReferenceOptions,
): { reference: ScaleReference; diagnostics: ReferenceDiagnostics } {
  assertMask(mask);
  const regions = connectedRegions(mask);
  const largest = regions[0];
  if (largest === undefined || largest.areaPx < 5) {
    throw new MeasurementError("reference mask is empty or too small to measure");
  }
  const total = regions.reduce((sum, region) => sum + region.areaPx, 0);

  let sumX = 0;
  let sumY = 0;
  for (const i of largest.pixels) {
    sumX += i % mask.width;
    sumY += Math.floor(i / mask.width);
  }
  const n = largest.areaPx;
  const cx = sumX / n;
  const cy = sumY / n;

  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const i of largest.pixels) {
    const dx = (i % mask.width) - cx;
    const dy = Math.floor(i / mask.width) - cy;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  // Pixel-centre variance plus 1/12 per axis for each pixel's own extent.
  xx = xx / n + 1 / 12;
  yy = yy / n + 1 / 12;
  xy /= n;

  const mid = (xx + yy) / 2;
  const spread = Math.sqrt(((xx - yy) / 2) ** 2 + xy ** 2);
  const majorPx = 4 * Math.sqrt(mid + spread);
  const minorPx = 4 * Math.sqrt(Math.max(mid - spread, 0));

  const aspect = minorPx / majorPx;
  const fill = n / ((Math.PI / 4) * majorPx * minorPx);
  const largestShare = n / total;
  const confidence = options.confidence * aspect * Math.min(fill, 1) * largestShare;

  return {
    reference: {
      id: options.id,
      knownMm: options.knownMm,
      lengthPx: round(majorPx, 1),
      confidence: round(confidence, 3),
    },
    diagnostics: {
      majorPx: round(majorPx, 2),
      minorPx: round(minorPx, 2),
      aspect: round(aspect, 3),
      fill: round(fill, 3),
      largestShare: round(largestShare, 3),
    },
  };
}
