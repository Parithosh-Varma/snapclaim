import type { DamageLabel, MaskObservation, ScaleReference } from "../engine/types.ts";
import { MeasurementError, round } from "../engine/math.ts";
import {
  type BinaryMask,
  assertMask,
  connectedRegions,
  cropRegion,
  intersectMasks,
  maskFromRegions,
  maxInscribedRadiusPx,
  skeletonLengthPx,
  skeletonize,
  straightestEdgeRmsPx,
} from "./mask.ts";

/** A crack region shorter than this many times its thickest point is blocky, not a crack. */
export const MIN_CRACK_ELONGATION = 4;
/** A crack region with an edge this close to a straight line (RMS, px) is likely built, not a crack. */
export const MAX_STRAIGHT_EDGE_RMS_PX = 1;
/** Regions smaller than this are too few pixels to judge their shape. */
const MIN_SHAPE_AREA_PX = 50;

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

    let blockyRegionCount = 0;
    let blockyAreaPx = 0;
    let straightRegionCount = 0;
    let straightAreaPx = 0;
    for (const region of regions) {
      if (region.areaPx < MIN_SHAPE_AREA_PX) continue;
      const piece = cropRegion(clipped.width, region);
      const thicknessPx = 2 * maxInscribedRadiusPx(piece);
      if (skeletonLengthPx(skeletonize(piece)) < MIN_CRACK_ELONGATION * thicknessPx) {
        blockyRegionCount++;
        blockyAreaPx += region.areaPx;
      }
      const edge = straightestEdgeRmsPx(clipped.width, region);
      if (edge !== null && edge <= MAX_STRAIGHT_EDGE_RMS_PX) {
        straightRegionCount++;
        straightAreaPx += region.areaPx;
      }
    }
    if (blockyRegionCount > 0) {
      observation.blockyRegionCount = blockyRegionCount;
      observation.blockyAreaPx = blockyAreaPx;
    }
    if (straightRegionCount > 0) {
      observation.straightRegionCount = straightRegionCount;
      observation.straightAreaPx = straightAreaPx;
    }
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
  /**
   * 90th percentile of how far the outline strays from the fitted ellipse, as a
   * share of the radius. Near 0 for a coin; a square or a lumpy outline scores high.
   */
  edgeError: number;
  /** Why the reference was refused. Its confidence is then 0, so the report stays percent-only. */
  rejected?: string;
}

/** Outline error allowed before a coin is refused, as a share of its radius. */
export const MAX_COIN_EDGE_ERROR = 0.08;

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
 * An outline that is not an ellipse at all (a square, a blob, two coins
 * merged) is refused outright with confidence 0 and a reason.
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

  // Outline pixels in the ellipse's own axes. Pixel centres sit half a pixel
  // inside the true edge, so the semi-axes are shrunk by 0.5 to match.
  const inside = new Uint8Array(mask.width * mask.height);
  for (const i of largest.pixels) inside[i] = 1;
  const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const a = Math.max(majorPx / 2 - 0.5, 0.5);
  const b = Math.max(minorPx / 2 - 0.5, 0.5);
  const errors: number[] = [];
  for (const i of largest.pixels) {
    const x = i % mask.width;
    const y = Math.floor(i / mask.width);
    const edge =
      x === 0 || y === 0 || x === mask.width - 1 || y === mask.height - 1 ||
      inside[i - 1] === 0 || inside[i + 1] === 0 || inside[i - mask.width] === 0 || inside[i + mask.width] === 0;
    if (!edge) continue;
    const u = (x - cx) * cos + (y - cy) * sin;
    const v = -(x - cx) * sin + (y - cy) * cos;
    errors.push(Math.abs(Math.hypot(u / a, v / b) - 1));
  }
  errors.sort((p, q) => p - q);
  const edgeError = errors[Math.floor(0.9 * (errors.length - 1))] ?? 1;
  // A small coin's outline is jagged from pixels alone: allow 1.5 px of that.
  const allowed = Math.max(MAX_COIN_EDGE_ERROR, 1.5 / b);
  const rejected =
    edgeError > allowed
      ? `outline is not round (strays ${round(edgeError * 100, 0)}% of the radius, limit ${round(allowed * 100, 0)}%)`
      : undefined;

  const confidence =
    rejected === undefined ? options.confidence * aspect * Math.min(fill, 1) * largestShare : 0;

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
      edgeError: round(edgeError, 3),
      ...(rejected === undefined ? {} : { rejected }),
    },
  };
}
