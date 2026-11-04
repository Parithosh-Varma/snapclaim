/**
 * POST /v1/claim - the one-call, headless pipeline.
 *
 * The app normally walks segment → observe → report → render in four UI steps.
 * This route runs the same, unchanged stages server-side and returns the whole
 * evidence package once, so a script, CLI or another service never has to
 * chain RLE masks by hand:
 *
 *   photo + damage taps (+ coin tap)   ──┐
 *   or pre-computed COCO RLE masks     ──┴─→ observe → report (gate) → SVG
 *
 * Two input paths, same fail-closed rules as the routes underneath:
 *   - `masks[]` (COCO RLE): deterministic, keyless, works in mock mode.
 *   - `imageUrl` + `damage[]` taps: live SAM 3.1, needs META_API_KEY, billed
 *     per image (damage call + optional coin call). Mock mode refuses - the
 *     backend invents no masks.
 *
 * Nothing here invents evidence: segmentation output is decoded by the
 * official parser, masks come from SAM pixels, numbers from the measurement
 * engine, sentences from the gated findings provider.
 */
import { assertDamageLabel } from "../src/engine/measure.ts";
import { MAX_MASK_DIMENSION, createMask, encodeRle, maskArea, type BinaryMask } from "../src/vision/mask.ts";
import { renderAnnexureSvg, type AnnexureOverlay } from "../src/render/svg.ts";
import type { DamageLabel, MeasureSessionResult } from "../src/engine/types.ts";
import type { FindingDraft, GateResult } from "../src/findings/evidence-gate.ts";
import type { SamFetchResult } from "../src/vision/sam.ts";
import { type AppConfig } from "../src/config/config.ts";
import { configFromEnv, HttpError, type Env, type FetchFn } from "./providers.ts";
import { VERSION, newRequestId, observeBody, parseOverlay, reportBody, samSegment, type EnvelopedResult } from "./app.ts";

/** SAM 3.1 accepts 16 prompted objects per call; one call carries every damage tap. */
export const MAX_CLAIM_TAPS = 16;

interface DamageTap {
  x: number;
  y: number;
  label: DamageLabel;
  confidence: number;
}

interface CoinTap {
  x: number;
  y: number;
  knownMm: number;
}

/** What the segmentation stage actually did, so a caller can debug a miss. */
export interface ClaimSegmentation {
  records: number;
  /** Records covering more than half the frame: SAM caught the wall, not the damage. */
  dropped: number;
  taps: number;
  frame: { width: number; height: number };
  archivedImageUrl: string | null;
}

export interface ClaimResult {
  claimId: string;
  measurement: MeasureSessionResult;
  findings: FindingDraft[];
  gate: GateResult;
  overlay?: AnnexureOverlay;
  referenceCheck?: unknown;
  segmentation?: ClaimSegmentation;
  /** Code-drawn annexure; omitted when `render: false`. */
  svg?: string;
  /** Inputs + measurement, in the exact shape `npm run replay -- request.json measurement.json` takes. */
  replay: { request: Record<string, unknown>; measurement: MeasureSessionResult };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(400, `${name} must be a finite number`);
  return value;
}

function requireRange(value: unknown, name: string, min: number, max: number): number {
  const n = requireFinite(value, name);
  if (n < min || n > max) throw new HttpError(400, `${name} must be in [${min}, ${max}]`);
  return n;
}

function requireSize(value: unknown, name: string): number {
  const n = requireFinite(value, name);
  if (n < 1 || n > MAX_MASK_DIMENSION) throw new HttpError(400, `${name} must be in [1, ${MAX_MASK_DIMENSION}]`);
  return Math.round(n);
}

function requireText(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") throw new HttpError(400, `${name} must be a string`);
  if (value.length > max) throw new HttpError(400, `${name} capped at ${max} chars`);
  return value;
}

function parseDamageTaps(raw: unknown, width: number, height: number): DamageTap[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, "photo claims need damage[] taps: [{x, y, label}] - one tap in the middle of each damage area");
  }
  if (raw.length > MAX_CLAIM_TAPS) {
    throw new HttpError(400, `damage capped at ${MAX_CLAIM_TAPS} taps per claim; split the photo, or send masks[] instead`);
  }
  return raw.map((value, i) => {
    if (!isRecord(value)) throw new HttpError(400, `damage[${i}] must be an object {x, y, label}`);
    try {
      assertDamageLabel(value.label);
    } catch {
      throw new HttpError(400, `damage[${i}].label must be one of crack, stain, peel, dent`);
    }
    const label = value.label as DamageLabel;
    return {
      x: requireRange(value.x, `damage[${i}].x`, 0, width - 1),
      y: requireRange(value.y, `damage[${i}].y`, 0, height - 1),
      label,
      // Same default the app uses when a tap has no model confidence attached.
      confidence: value.confidence === undefined ? 0.8 : requireRange(value.confidence, `damage[${i}].confidence`, 0, 1),
    };
  });
}

function parseCoin(raw: unknown, width: number, height: number): CoinTap | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new HttpError(400, "coin must be an object {x, y, knownMm}");
  const knownMm = requireFinite(raw.knownMm, "coin.knownMm");
  if (knownMm <= 0 || knownMm > 1000) throw new HttpError(400, "coin.knownMm must be in (0, 1000]");
  return {
    x: requireRange(raw.x, "coin.x", 0, width - 1),
    y: requireRange(raw.y, "coin.y", 0, height - 1),
    knownMm,
  };
}

/** Round + clamp: a tap may sit exactly on the last pixel. */
function pixel(mask: BinaryMask, x: number, y: number): boolean {
  const px = Math.min(mask.width - 1, Math.max(0, Math.round(x)));
  const py = Math.min(mask.height - 1, Math.max(0, Math.round(y)));
  return mask.data[py * mask.width + px] !== 0;
}

/** 4πA/P² - 1 for a disc, far lower for a wall slab or a crack. */
function compactness(mask: BinaryMask): number {
  let area = 0;
  let edge = 0;
  const { width, height, data } = mask;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!data[i]) continue;
      area++;
      if (
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        !data[i - 1] || !data[i + 1] || !data[i - width] || !data[i + width]
      ) {
        edge++;
      }
    }
  }
  return edge === 0 ? 0 : (4 * Math.PI * area) / (edge * edge);
}

/**
 * Pick the coin among SAM's candidates for a tap: must contain the tap,
 * be coin-sized, and be the most disc-like of those. Mirrors the app's
 * `pickCoinRecord`; the real shape check still happens in /v1/observe
 * (circularReference refuses a non-coin outline, so a wrong pick degrades
 * to percent-only instead of inventing millimetres).
 */
function pickCoin(records: SamFetchResult["records"], tap: CoinTap, width: number, height: number): { mask: BinaryMask; confidence: number } | null {
  const framePx = width * height;
  let best: { mask: BinaryMask; confidence: number } | null = null;
  let bestScore = 0;
  for (const record of records) {
    const mask = record.frameMask;
    if (mask.width !== width || mask.height !== height) continue;
    const area = maskArea(mask);
    // Speckle is not a coin; a wall slab is not a coin.
    if (area < 20 || area > framePx * 0.25) continue;
    if (!pixel(mask, tap.x, tap.y)) continue;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < mask.data.length; i++) {
      if (!mask.data[i]) continue;
      sx += i % width;
      sy += Math.floor(i / width);
    }
    const dist = Math.hypot(sx / area - tap.x, sy / area - tap.y);
    const confidence = record.box.confidence ?? 0.5;
    const score = (compactness(mask) * confidence) / (1 + dist / Math.sqrt(area));
    if (score > bestScore) {
      bestScore = score;
      best = { mask, confidence };
    }
  }
  return bestScore > 0 ? best : null;
}

function unionMasks(masks: BinaryMask[], width: number, height: number): BinaryMask {
  const out = createMask(width, height);
  for (const mask of masks) {
    for (let i = 0; i < out.data.length; i++) {
      if (mask.data[i]) out.data[i] = 1;
    }
  }
  return out;
}

/**
 * Live segmentation: one billed SAM call carrying every damage tap, one more
 * for the coin when asked. Records are attributed to taps by which mask
 * contains the tapped pixel - never by order - and wall-sized records are
 * dropped the way the app drops them (a crack tap often returns the whole wall).
 */
async function segmentPhoto(
  body: Record<string, unknown>,
  env: Env,
  config: AppConfig,
  requestId: string,
  fetchFn?: FetchFn,
): Promise<{ observeInput: Record<string, unknown>; segmentation: ClaimSegmentation }> {
  if (config.mockMode) {
    throw new HttpError(
      422,
      "mock mode cannot segment a photo: the backend invents no masks - send masks[] (COCO RLE), or run live (MOCK_MODE=0 + META_API_KEY)",
    );
  }
  const imageUrl = requireText(body.imageUrl, "imageUrl", 1_400_000);
  if (imageUrl === "") throw new HttpError(400, "imageUrl must be a non-empty string (https:// or data:image/...)");
  const width = requireSize(body.width, "width");
  const height = requireSize(body.height, "height");
  const damage = parseDamageTaps(body.damage, width, height);
  const coin = parseCoin(body.coin, width, height);

  const sam = await samSegment(
    env,
    config,
    { imageUrl, size: { width, height }, points: damage.map(({ x, y }) => ({ x, y })) },
    requestId,
    fetchFn,
  );
  const framePx = width * height;
  const usable = sam.records.filter((record) => {
    const area = maskArea(record.frameMask);
    return area > 0 && area <= framePx * 0.5;
  });
  const dropped = sam.records.length - usable.length;

  // Every tap must be backed by at least one kept mask. A tap over nothing
  // (or only over the dropped wall record) is an error, never an empty report.
  damage.forEach((tap, i) => {
    if (!usable.some((record) => pixel(record.frameMask, tap.x, tap.y))) {
      throw new HttpError(
        422,
        `SAM found no ${tap.label} under damage[${i}] at (${tap.x}, ${tap.y})` +
          (dropped > 0 ? " - it may have caught the wall instead; fill the frame with the damage and tap its middle" : " - tap the middle of the damage"),
      );
    }
  });

  // Attribute each record to the first tap inside it, then union per label:
  // one crack tapped twice is one finding, not two.
  const byLabel = new Map<DamageLabel, { masks: BinaryMask[]; confidence: number }>();
  for (const record of usable) {
    const owner = damage.find((tap) => pixel(record.frameMask, tap.x, tap.y));
    if (owner === undefined) continue;
    const entry = byLabel.get(owner.label) ?? { masks: [], confidence: 1 };
    entry.masks.push(record.frameMask);
    entry.confidence = Math.min(entry.confidence, record.box.confidence ?? 0.8);
    byLabel.set(owner.label, entry);
  }

  const masks = [...byLabel.entries()].map(([label, entry], i) => ({
    id: `damage-${i + 1}`,
    label,
    rle: encodeRle(unionMasks(entry.masks, width, height)),
    confidence: entry.confidence,
  }));

  const observeInput: Record<string, unknown> = { masks };
  if (coin !== undefined) {
    const coinSam = await samSegment(
      env,
      config,
      { imageUrl, size: { width, height }, points: [{ x: coin.x, y: coin.y }] },
      requestId,
      fetchFn,
      false,
    );
    const picked = pickCoin(coinSam.records, coin, width, height);
    if (picked === null) {
      throw new HttpError(422, "no coin-shaped outline under the coin tap - tap the middle of the coin, or omit coin for a percent-only report");
    }
    observeInput.reference = {
      id: "coin-1",
      rle: encodeRle(picked.mask),
      knownMm: coin.knownMm,
      confidence: picked.confidence,
    };
  }

  return {
    observeInput,
    segmentation: { records: sam.records.length, dropped, taps: damage.length, frame: { width, height }, archivedImageUrl: sam.archivedImageUrl },
  };
}

/**
 * POST /v1/claim body:
 *
 *   { masks: [{id,label,rle,confidence}], component?, reference? }   // keyless
 *   { imageUrl, width, height, damage: [{x,y,label}], coin?: {x,y,knownMm} }
 *
 * common: transcript?, thresholds?, minReferenceConfidence?, photoHref?,
 *         render? (default true)
 */
export async function claimBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new HttpError(400, "body must be a JSON object");

  const transcript = body.transcript === undefined ? "" : requireText(body.transcript, "transcript", 2000);
  const render = body.render === undefined ? true : body.render;
  if (typeof render !== "boolean") throw new HttpError(400, "render must be a boolean");
  const photoHref = body.photoHref === undefined ? undefined : requireText(body.photoHref, "photoHref", 200_000);

  let observeInput: Record<string, unknown>;
  let segmentation: ClaimSegmentation | undefined;

  if (Array.isArray(body.masks)) {
    // Deterministic path: the caller already has pixel masks (from /v1/segment
    // or a stored analysis). Same shape /v1/observe takes.
    observeInput = { masks: body.masks };
    if (body.component !== undefined) observeInput.component = body.component;
    if (body.reference !== undefined) observeInput.reference = body.reference;
  } else if (body.imageUrl !== undefined) {
    const photo = await segmentPhoto(body, env, configFromEnv(env), requestId, fetchFn);
    observeInput = photo.observeInput;
    segmentation = photo.segmentation;
  } else {
    throw new HttpError(400, "claim needs masks[] (COCO RLE) or imageUrl + damage[] taps");
  }

  // Deterministic pixel statistics, outlines and the coin ellipse fit.
  const observed = observeBody(observeInput, requestId).result as {
    component: unknown;
    masks: Array<Record<string, unknown>>;
    scaleReference?: unknown;
    overlay?: AnnexureOverlay;
    referenceCheck?: unknown;
  };
  // observe derives the statistics from pixels but does not echo the RLE. Re-attach
  // it (1:1 by mask order) so the measurement is pixel-verified: the engine re-checks
  // areaPx/skeletonPx against the pixels, and REQUIRE_PIXEL_PROVENANCE=1 claims pass.
  const sourceMasks = observeInput.masks as Array<{ rle?: unknown }>;
  observed.masks = observed.masks.map((mask, i) => {
    const rle = sourceMasks[i]?.rle;
    return rle === undefined ? mask : { ...mask, rle };
  });

  // Measurement + gated findings. /v1/report re-measures server-side, so a
  // caller can never hand this route pre-baked numbers.
  const reportInput: Record<string, unknown> = { ...observed, transcript };
  if (body.thresholds !== undefined) reportInput.thresholds = body.thresholds;
  if (body.minReferenceConfidence !== undefined) reportInput.minReferenceConfidence = body.minReferenceConfidence;
  const reported = (await reportBody(reportInput, env, requestId, fetchFn)).result as {
    measurement: MeasureSessionResult;
    findings: FindingDraft[];
    gate: GateResult;
  };
  const { measurement, findings, gate } = reported;

  // Render in-process: /v1/render would re-run /v1/report and bill a second
  // findings call for the same numbers.
  let overlay: AnnexureOverlay | undefined;
  if (observed.overlay !== undefined) {
    overlay = parseOverlay(photoHref === undefined ? observed.overlay : { ...observed.overlay, photoHref });
  }
  const svg = render
    ? renderAnnexureSvg({
      findings: measurement.findings,
      receipts: measurement.receipts,
      mode: measurement.mode,
      statements: findings,
      transcript,
      version: VERSION,
      generatedAt: new Date().toISOString(),
      ...(overlay === undefined ? {} : { overlay }),
    })
    : undefined;

  const replayRequest: Record<string, unknown> = { component: observed.component, masks: observed.masks };
  if (observed.scaleReference !== undefined) replayRequest.scaleReference = observed.scaleReference;

  const result: ClaimResult = {
    claimId: requestId,
    measurement,
    findings,
    gate,
    ...(overlay === undefined ? {} : { overlay }),
    ...(observed.referenceCheck === undefined ? {} : { referenceCheck: observed.referenceCheck }),
    ...(segmentation === undefined ? {} : { segmentation }),
    ...(svg === undefined ? {} : { svg }),
    replay: { request: replayRequest, measurement },
  };
  return { ok: true, requestId, durationMs: Date.now() - started, result };
}
