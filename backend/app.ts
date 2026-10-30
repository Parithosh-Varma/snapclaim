import { measureSession } from "../src/engine/measure.ts";
import { type ReferenceDiagnostics, circularReference, observeMask, tiltStretch } from "../src/vision/observe.ts";
import { MAX_MASK_DIMENSION, MAX_MASK_PIXELS, MAX_RLE_RUNS, decodeRle, intersectMasks, type BinaryMask, type CocoRle } from "../src/vision/mask.ts";
import { agreementVerdict, maskAgreement } from "../src/vision/agreement.ts";
import type { MeasureSessionInput } from "../src/engine/types.ts";
import { MAX_CITATIONS_PER_FINDING, MAX_DRAFTS, MAX_STATEMENT_CHARS, validateFindings, type FindingDraft } from "../src/findings/evidence-gate.ts";
import type { MeasuredFinding } from "../src/engine/types.ts";
import type { Receipt } from "../src/receipts/types.ts";
import { MAX_PHOTO_HREF_CHARS, type AnnexureOverlay, renderAnnexureSvg } from "../src/render/svg.ts";
import { maskOutlinePath } from "../src/vision/contour.ts";
import { guardFor, spendStatus } from "./spend.ts";
import { BudgetExceededError } from "../src/config/spend-guard.ts";
import { configFromEnv, findingsProvider, requireLiveKeys, skepticProvider, visionProvider, HttpError, SAM_IMAGE_USD, type Env, type FetchFn } from "./providers.ts";
import {
  DEFAULT_KEYWORDS,
  DEFAULT_LANGUAGE_BIAS,
  estimateAudioUsd,
  sanitizeList,
  transcribeWithMuse,
  type TranscribeResult,
} from "./transcribe.ts";
import { encodeRle as encodeMaskRle } from "../src/vision/mask.ts";
import { MemoryStore, type SavedSession, type Store } from "./store.ts";
import { segmentWithSam, type SamPoint } from "../src/vision/sam.ts";
import { DEFAULT_CONFIG } from "../src/config/config.ts";

export const VERSION = "0.3.0";
export const MAX_MASKS = 50;

export interface EnvelopedResult {
  ok: true;
  requestId: string;
  durationMs: number;
  result: unknown;
}

export interface VerboseError {
  ok: false;
  error: string;
  code: number;
  requestId: string;
  details?: unknown;
}

function newRequestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quietLog(...args: unknown[]): void {
  if (typeof process !== "undefined" && process.env?.VERBOSE === "1") console.log(...args);
}

function envelope(requestId: string, started: number, result: unknown): EnvelopedResult {
  return { ok: true, requestId, durationMs: Date.now() - started, result };
}

/** Ignore extras: pick only known keys so PWA drift never breaks the backend. */
export function toMeasureInput(body: unknown, serverMinConfidence?: number): MeasureSessionInput {
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  const { component, masks, scaleReference, thresholds, minReferenceConfidence } = body;
  const input: MeasureSessionInput = {
    component: component as MeasureSessionInput["component"],
    masks: masks as MeasureSessionInput["masks"],
  };
  if (scaleReference !== undefined) input.scaleReference = scaleReference as MeasureSessionInput["scaleReference"];
  if (thresholds !== undefined) {
    // Threshold overrides are attacker-controlled severity dials
    // ({significantCrackMm: 0} marks everything significant). Validate shape
    // and bound the escalation surface; receipts already record the values.
    if (!isRecord(thresholds)) throw new Error("thresholds must be an object");
    const t = thresholds as Record<string, unknown>;
    const num = (name: string, min: number, max: number): number => {
      const v = t[name];
      if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
        throw new Error(`thresholds.${name} must be a number in [${min}, ${max}]`);
      }
      return v;
    };
    const validated = {
      cosmeticMaxRatio: num("cosmeticMaxRatio", 0.001, 1),
      moderateMaxRatio: num("moderateMaxRatio", 0.001, 1),
      significantCrackMm: num("significantCrackMm", 10, 10000),
      significantRegionCount: Number.isInteger(t["significantRegionCount"]) && (t["significantRegionCount"] as number) >= 1 && (t["significantRegionCount"] as number) <= 100
        ? (t["significantRegionCount"] as number)
        : (() => { throw new Error("thresholds.significantRegionCount must be an integer in [1, 100]"); })(),
    };
    if (validated.cosmeticMaxRatio >= validated.moderateMaxRatio) {
      throw new Error("thresholds.cosmeticMaxRatio must be lower than thresholds.moderateMaxRatio");
    }
    input.thresholds = validated as MeasureSessionInput["thresholds"];
  }
  if (minReferenceConfidence !== undefined) {
    if (typeof minReferenceConfidence !== "number" || !Number.isFinite(minReferenceConfidence) || minReferenceConfidence < 0 || minReferenceConfidence > 1) {
      throw new Error("minReferenceConfidence must be a number in [0, 1]");
    }
    // The caller may only raise the bar, never lower it below the server floor.
    // A crafted minReferenceConfidence: 0 would otherwise upgrade junk
    // low-confidence references to absolute millimetres.
    const floor = serverMinConfidence ?? DEFAULT_CONFIG.minReferenceConfidence;
    input.minReferenceConfidence = Math.max(minReferenceConfidence, floor);
  }
  if (!Array.isArray(input.masks)) throw new Error("masks must be an array");
  if (input.masks.length > MAX_MASKS) throw new Error(`masks capped at ${MAX_MASKS} per call; chunk the request`);
  return input;
}

export function healthBody(env: Env = {}): { ok: true; version: string; time: string; mode: "mock" | "live" | "config-error" } {
  let mode: "mock" | "live" | "config-error" = "mock";
  try {
    const config = configFromEnv(env);
    if (!config.mockMode) mode = env.META_API_KEY?.trim() ? "live" : "config-error";
  } catch {
    mode = "config-error";
  }
  return { ok: true, version: VERSION, time: new Date().toISOString(), mode };
}

export function measureBody(body: unknown, requestId = newRequestId(), env: Env = {}): EnvelopedResult {
  const started = Date.now();
  const config = configFromEnv(env);
  const result = measureSession(toMeasureInput(body, config.minReferenceConfidence));
  quietLog("[measure]", { requestId, findings: result.findings.length });
  return envelope(requestId, started, result);
}

function parseRle(value: unknown, name: string): BinaryMask {
  if (!isRecord(value)) throw new HttpError(400, `${name}.rle must be {size:[h,w], counts}`);
  const { size, counts } = value;
  if (!Array.isArray(size) || size.length !== 2 || !size.every((n) => Number.isInteger(n) && n > 0)) {
    throw new HttpError(400, `${name}.rle.size must be [height, width] positive integers`);
  }
  const [h, w] = size as [number, number];
  if (w > MAX_MASK_DIMENSION || h > MAX_MASK_DIMENSION || w * h > MAX_MASK_PIXELS) {
    throw new HttpError(400, `${name}.rle.size ${h}x${w} exceeds the ${MAX_MASK_DIMENSION}px / ${MAX_MASK_PIXELS}-pixel cap`);
  }
  if (!Array.isArray(counts) && typeof counts !== "string") {
    throw new HttpError(400, `${name}.rle.counts must be a number array or COCO string`);
  }
  const runs = typeof counts === "string" ? counts.length : (counts as unknown[]).length;
  // A compressed string carries ~1 run per 2–4 chars; bound both forms.
  if (Array.isArray(counts) ? counts.length > MAX_RLE_RUNS : counts.length > MAX_RLE_RUNS * 4) {
    throw new HttpError(400, `${name}.rle has ${runs} runs/chars, capped at ${MAX_RLE_RUNS} runs`);
  }
  try {
    return decodeRle({ size: [size[0], size[1]], counts } as CocoRle);
  } catch (error) {
    throw new HttpError(422, `${name}.rle invalid: ${error instanceof Error ? error.message : "cannot decode"}`);
  }
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(400, `${name} must be a finite number`);
  return value;
}

function requirePositive(value: unknown, name: string, max = MAX_MASK_DIMENSION): number {
  const n = requireNumber(value, name);
  if (n <= 0 || n > max) throw new HttpError(400, `${name} must be in (0, ${max}]`);
  return n;
}

function requireId(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") throw new HttpError(400, `${name} must be a non-empty string`);
  return value;
}

/**
 * POST /v1/crosscheck — independent mask agreement.
 *
 * Takes two COCO RLE masks of the same frame (e.g. the on-device SlimSAM
 * preview and the authoritative SAM 3.1 record) and scores their overlap.
 * The verdict uses the caller's threshold (default 0.5). Pure set math,
 * no keys, no models — the planned SlimSAM-vs-SAM skeptic check.
 */
export function crosscheckBody(body: unknown, requestId = newRequestId()): EnvelopedResult {
  const started = Date.now();
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  if (!isRecord(body.a) || !isRecord(body.b)) throw new HttpError(400, "body needs {a, b} COCO RLE masks");
  const threshold = body.threshold === undefined ? 0.5 : requireNumber(body.threshold, "threshold");
  const a = parseRle(body.a, "a");
  const b = parseRle(body.b, "b");
  if (a.width !== b.width || a.height !== b.height) {
    throw new HttpError(422, `masks differ in size: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const agreement = maskAgreement(a, b);
  return envelope(requestId, started, { ...agreement, verdict: agreementVerdict(agreement, threshold), threshold });
}

/** Deterministic: pixel masks (COCO RLE) to the component/masks/scaleReference that /v1/report takes. No keys, no model. */
export function observeBody(body: unknown, requestId = newRequestId()): EnvelopedResult {
  const started = Date.now();
  if (!isRecord(body)) throw new HttpError(400, "body must be a JSON object");
  const { component, masks, reference } = body;
  if (!Array.isArray(masks) || masks.length === 0) throw new HttpError(400, "masks must be a non-empty array");
  if (masks.length > MAX_MASKS) throw new HttpError(400, `masks capped at ${MAX_MASKS} per call; chunk the request`);

  const decoded = masks.map((raw, i) => {
    if (!isRecord(raw)) throw new HttpError(400, `masks[${i}] must be an object`);
    return { raw, mask: parseRle(raw.rle, `masks[${i}]`) };
  });
  const first = decoded[0]!.mask;
  const sameSize = (m: BinaryMask, name: string) => {
    if (m.width !== first.width || m.height !== first.height) {
      throw new HttpError(400, `${name}.rle.size ${m.height}x${m.width} does not match masks[0] ${first.height}x${first.width}`);
    }
  };
  decoded.forEach((d, i) => sameSize(d.mask, `masks[${i}]`));

  let componentMask: BinaryMask | undefined;
  let componentObs: { id: string; areaPx: number; confidence: number };
  if (component === undefined) {
    componentObs = { id: "photo", areaPx: first.height * first.width, confidence: 1 };
  } else {
    if (!isRecord(component)) throw new HttpError(400, "component must be an object");
    componentMask = parseRle(component.rle, "component");
    sameSize(componentMask, "component");
    let areaPx = 0;
    for (const v of componentMask.data) if (v !== 0) areaPx++;
    componentObs = {
      id: requireId(component.id, "component.id"),
      areaPx,
      confidence: requireNumber(component.confidence, "component.confidence"),
    };
  }

  // The coin first: when it is tilted, its ellipse corrects the crack lengths below.
  let measuredReference: ReturnType<typeof circularReference> | undefined;
  let refMask: BinaryMask | undefined;
  if (reference !== undefined) {
    if (!isRecord(reference)) throw new HttpError(400, "reference must be an object");
    refMask = parseRle(reference.rle, "reference");
    sameSize(refMask, "reference");
    try {
      measuredReference = circularReference(refMask, {
        id: requireId(reference.id, "reference.id"),
        knownMm: requirePositive(reference.knownMm, "reference.knownMm", 1000),
        confidence: requireNumber(reference.confidence, "reference.confidence"),
      });
    } catch (error) {
      throw new HttpError(422, `reference: ${error instanceof Error ? error.message : "cannot measure"}`);
    }
  }
  const stretch = measuredReference && tiltStretch(measuredReference.diagnostics);

  const observed = decoded.map(({ raw, mask }, i) => {
    const label = raw.label;
    if (typeof label !== "string") throw new HttpError(400, `masks[${i}].label must be a string`);
    return observeMask(mask, {
      id: requireId(raw.id, `masks[${i}].id`),
      label: label as never,
      confidence: requireNumber(raw.confidence, `masks[${i}].confidence`),
      ...(componentMask ? { component: componentMask } : {}),
      ...(stretch ? { stretch } : {}),
    });
  });

  // referenceCheck and overlay are extra: /v1/measure ignores them. The PWA shows the
  // check and hands the overlay to /v1/render, outlining exactly the pixels measured.
  const outline = (mask: BinaryMask) =>
    maskOutlinePath(componentMask ? intersectMasks(mask, componentMask) : mask, { tolerance: OUTLINE_TOLERANCE_PX });
  const result: Pick<MeasureSessionInput, "component" | "masks" | "scaleReference"> & {
    referenceCheck?: ReferenceDiagnostics;
    overlay: AnnexureOverlay;
  } = {
    component: componentObs,
    masks: observed,
    overlay: {
      width: first.width,
      height: first.height,
      masks: decoded.map(({ mask }, i) => ({ id: observed[i]!.id, label: observed[i]!.label, path: outline(mask) })),
    },
  };
  if (measuredReference && refMask) {
    result.scaleReference = measuredReference.reference;
    result.referenceCheck = measuredReference.diagnostics;
    result.overlay.masks.push({ id: measuredReference.reference.id, label: "coin", path: maskOutlinePath(refMask, { tolerance: OUTLINE_TOLERANCE_PX }) });
  }
  quietLog("[observe]", { requestId, masks: observed.length });
  return envelope(requestId, started, result);
}

export async function reportBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  const config = configFromEnv(env);
  const measurement = measureSession(toMeasureInput(body, config.minReferenceConfidence));
  const transcript = typeof body.transcript === "string" ? body.transcript.slice(0, 2000) : "";

  let drafts: FindingDraft[];
  if (body.drafts !== undefined) {
    if (!Array.isArray(body.drafts)) throw new Error("drafts must be an array");
    if (body.drafts.length > MAX_DRAFTS) throw new HttpError(400, `drafts capped at ${MAX_DRAFTS}`);
    for (let i = 0; i < body.drafts.length; i++) {
      const d = body.drafts[i] as Partial<FindingDraft>;
      if (typeof d?.statement !== "string" || !Array.isArray(d?.citations)) {
        throw new HttpError(400, `drafts[${i}] must be {statement: string, citations: string[]}`);
      }
      if (d.statement.length > MAX_STATEMENT_CHARS) throw new HttpError(400, `drafts[${i}].statement capped at ${MAX_STATEMENT_CHARS} chars`);
      if (d.citations.length > MAX_CITATIONS_PER_FINDING) throw new HttpError(400, `drafts[${i}].citations capped at ${MAX_CITATIONS_PER_FINDING}`);
    }
    drafts = body.drafts as FindingDraft[];
  } else {
    const provider = findingsProvider(env, config, fetchFn, guardFor(env));
    drafts = await provider.draftFindings({ transcript, findings: measurement.findings, receipts: measurement.receipts });
  }

  const gate = validateFindings(drafts, measurement.receipts);
  if (!gate.ok) {
    const err = new HttpError(422, "Evidence gate failed");
    (err as HttpError & { details?: unknown }).details = gate.failures;
    throw err;
  }
  return envelope(requestId, started, { measurement, findings: drafts, gate });
}

export async function segmentBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  const config = configFromEnv(env);
  if (config.mockMode) {
    const provider = visionProvider(env, config, body.fixture as never);
    const result = await provider.segment({
      imageId: typeof body.imageId === "string" ? body.imageId : "unknown",
      labels: Array.isArray(body.labels) ? (body.labels as never) : [],
    });
    return envelope(requestId, started, result);
  }
  // Live: SAM 3.1 point prompts over the Responses API. The backend decodes
  // masks with the official parser — it never invents them.
  const { metaKey } = requireLiveKeys(env, config);
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";
  assertSafeImageUrl(imageUrl);
  const width = requirePositive(body.width, "width");
  const height = requirePositive(body.height, "height");
  if (width * height > MAX_MASK_PIXELS) {
    throw new HttpError(400, `width×height ${width}x${height} exceeds the ${MAX_MASK_PIXELS}-pixel cap`);
  }
  const rawPoints = Array.isArray(body.points) ? body.points : [];
  if (rawPoints.length === 0 || rawPoints.length > 16) throw new HttpError(400, "live /v1/segment needs 1–16 body.points [{x, y}]");
  const points: SamPoint[] = rawPoints.map((point, i) => {
    if (!isRecord(point)) throw new HttpError(400, `points[${i}] must be an object`);
    return { x: requireNumber(point.x, `points[${i}].x`), y: requireNumber(point.y, `points[${i}].y`) };
  });
  const spend = guardFor(env);
  if (spend.remainingUsd <= 0) throw new HttpError(429, `spend guard: $0 remaining of $${spend.limitUsd} limit`);
  const sam = await segmentWithSam({
    fetchFn,
    base: config.endpoints.meta,
    apiKey: metaKey,
    model: config.models.sam,
    request: { imageUrl, size: { width: Math.round(width), height: Math.round(height) }, points },
  });
  try {
    spend.charge(`sam segment ${sam.records.length} objects`, SAM_IMAGE_USD);
  } catch (error) {
    if (error instanceof BudgetExceededError) throw new HttpError(429, error.message);
    throw error;
  }
  return envelope(requestId, started, {
    records: sam.records.map((record) => ({
      objectId: record.objectId,
      box: record.box,
      confidence: record.box.confidence ?? null,
      rle: encodeMaskRle(record.frameMask),
    })),
  });
}

/** SSRF guard for live /v1/segment: only public https: URLs or small inline
 * raster data URLs. Blocks cloud-metadata / loopback / link-local literals,
 * non-default ports are rejected, and data: SVGs are refused. */
export function assertSafeImageUrl(imageUrl: string): void {
  if (typeof imageUrl !== "string" || imageUrl === "") {
    throw new HttpError(400, "live /v1/segment needs body.imageUrl (https:// or data:image/)");
  }
  if (imageUrl.startsWith("data:")) {
    const comma = imageUrl.indexOf(",");
    if (comma < 0 || comma > 64) throw new HttpError(400, "live /v1/segment data:image URL is malformed");
    const mime = imageUrl.slice(5, imageUrl.indexOf(";"));
    if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") {
      throw new HttpError(400, "live /v1/segment data: URL must be image/png, image/jpeg or image/webp");
    }
    // ~1 MB data URL ≈ 750 KB decoded; the operator pays per image token.
    if (imageUrl.length > 1_400_000) throw new HttpError(400, "live /v1/segment data:image URL over ~1 MB");
    return;
  }
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new HttpError(400, "live /v1/segment needs body.imageUrl (https:// or data:image/)");
  }
  if (url.protocol !== "https:") throw new HttpError(400, "live /v1/segment imageUrl must be https:// or data:image/");
  if (url.username !== "" || url.password !== "") throw new HttpError(400, "live /v1/segment imageUrl must not embed credentials");
  if (url.port !== "") throw new HttpError(400, "live /v1/segment imageUrl must use the default https port");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || host === "::1") {
    throw new HttpError(400, "live /v1/segment imageUrl must be a public host");
  }
  // Literal-IP block: loopback, private, link-local, multicast, reserved.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const isPrivate =
      Number(v4[1]) === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      a === 127 || (a === 169 && b === 254) || a >= 224;
    if (isPrivate || [a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) {
      throw new HttpError(400, "live /v1/segment imageUrl must be a public host");
    }
    return;
  }
  if (host.includes(":") || host === "0.0.0.0") {
    throw new HttpError(400, "live /v1/segment imageUrl must be a public host");
  }
}

function base64ToBytes(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, "body.audioBase64 must be a non-empty string");
  const clean = value.includes(",") ? (value.split(",").pop() as string) : value;
  try {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw new HttpError(400, "body.audioBase64 is not valid base64");
  }
}

/**
 * POST /v1/transcribe — spoken line to text via Muse Voice Transcribe.
 * Mock mode returns the supplied fixture transcript (the backend invents none).
 * Live mode proxies to {META_API_BASE}/v1/asr/transcribe as multipart.
 */
export async function transcribeBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  const config = configFromEnv(env);
  if (config.mockMode) {
    if (typeof body.fixtureTranscript !== "string") {
      throw new HttpError(400, "mock transcribe requires body.fixtureTranscript — backend invents no transcripts");
    }
    const result: TranscribeResult = { transcript: body.fixtureTranscript, audioDurationMs: 0, turns: [] };
    return envelope(requestId, started, result);
  }
  const { metaKey } = requireLiveKeys(env, config);
  const audio = base64ToBytes(body.audioBase64);
  if (audio.length > 4_000_000) throw new HttpError(400, "audio over 4 MB; send a clip of 10 seconds or less");
  const languageBias = sanitizeList(body.languageBias, DEFAULT_LANGUAGE_BIAS);
  const keywords = sanitizeList(body.keywords, DEFAULT_KEYWORDS);
  const spend = guardFor(env);
  if (spend.remainingUsd <= 0) throw new HttpError(429, `spend guard: $0 remaining of $${spend.limitUsd} limit`);
  const result = await transcribeWithMuse({
    fetchFn,
    base: config.endpoints.meta,
    apiKey: metaKey,
    model: config.models.transcribe,
    audio: { audio, languageBias, keywords },
    charge: (label, usd) => {
      try {
        spend.charge(label, usd);
      } catch (error) {
        if (error instanceof BudgetExceededError) throw new HttpError(429, error.message);
        throw error;
      }
    },
  });
  return envelope(requestId, started, result);
}

function assertFindingsShape(findings: unknown, receipts: unknown): asserts findings is MeasuredFinding[] {
  if (!Array.isArray(findings) || !Array.isArray(receipts)) throw new HttpError(400, "findings and receipts arrays are required");
  if (findings.length > MAX_MASKS || receipts.length > 512) {
    throw new HttpError(400, `findings capped at ${MAX_MASKS}, receipts at 512`);
  }
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i] as Record<string, unknown>;
    if (!isRecord(f) || typeof f.label !== "string" || typeof f.percent !== "number") {
      throw new HttpError(400, `findings[${i}] must include {label: string, percent: number}`);
    }
  }
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i] as Record<string, unknown>;
    if (!isRecord(r) || typeof r.id !== "string" || !isRecord(r.output)) {
      throw new HttpError(400, `receipts[${i}] must include {id: string, output: object}`);
    }
  }
}

export async function findingsBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  const findings = body.findings as MeasuredFinding[];
  const receipts = body.receipts as Receipt[];
  assertFindingsShape(findings, receipts);
  crossCheckMeasurement(body, findings, receipts, env);
  const provider = findingsProvider(env, configFromEnv(env), fetchFn, guardFor(env));
  const drafts = await provider.draftFindings({
    transcript: typeof body.transcript === "string" ? body.transcript.slice(0, 2000) : "",
    findings,
    receipts,
  });
  const gate = validateFindings(drafts, receipts);
  if (!gate.ok) {
    const err = new HttpError(422, "Evidence gate failed");
    (err as HttpError & { details?: unknown }).details = gate.failures;
    throw err;
  }
  return envelope(requestId, started, { findings: drafts, gate });
}

export async function skepticBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  const findings = body.findings as MeasuredFinding[];
  const receipts = body.receipts as Receipt[];
  assertFindingsShape(findings, receipts);
  crossCheckMeasurement(body, findings, receipts, env);
  const provider = skepticProvider(env, configFromEnv(env), fetchFn, guardFor(env));
  const drafts = await provider.draftFindings({
    transcript: typeof body.transcript === "string" ? body.transcript.slice(0, 2000) : "",
    findings,
    receipts,
  });
  const gate = validateFindings(drafts, receipts);
  if (!gate.ok) {
    const err = new HttpError(422, "Evidence gate failed");
    (err as HttpError & { details?: unknown }).details = gate.failures;
    throw err;
  }
  return envelope(requestId, started, { findings: drafts, gate });
}

/** Outline simplification, in source pixels: keeps the shape, drops staircase steps. */
const OUTLINE_TOLERANCE_PX = 1;
/** An SVG path from contoursToSvgPath: move, line and close commands with plain numbers. */
const SVG_PATH = /^[MLZ0-9 .-]*$/;

/** The photo panel from /v1/observe, plus the photo the PWA attaches. Shapes are checked here. */
export function parseOverlay(raw: unknown): AnnexureOverlay {
  if (!isRecord(raw)) throw new HttpError(400, "overlay must be an object");
  const width = requirePositive(raw.width, "overlay.width");
  const height = requirePositive(raw.height, "overlay.height");
  if (width * height > MAX_MASK_PIXELS) {
    throw new HttpError(400, `overlay ${width}x${height} exceeds the ${MAX_MASK_PIXELS}-pixel cap`);
  }
  if (!Array.isArray(raw.masks)) throw new HttpError(400, "overlay.masks must be an array");
  if (raw.masks.length > MAX_MASKS + 1) throw new HttpError(400, `overlay.masks capped at ${MAX_MASKS + 1}`);
  const masks = raw.masks.map((m, i) => {
    if (!isRecord(m) || typeof m.label !== "string" || typeof m.path !== "string" || !SVG_PATH.test(m.path)) {
      throw new HttpError(400, `overlay.masks[${i}] needs an id, a label and an SVG path`);
    }
    if ((m.path as string).length > 500_000) throw new HttpError(400, `overlay.masks[${i}].path too long`);
    if (typeof m.label !== "string" || (m.label as string).length > 64) throw new HttpError(400, `overlay.masks[${i}].label too long`);
    return { id: requireId(m.id, `overlay.masks[${i}].id`), label: m.label, path: m.path };
  });
  const overlay: AnnexureOverlay = { width, height, masks };
  if (typeof raw.photoHref === "string") {
    if (raw.photoHref.length > MAX_PHOTO_HREF_CHARS) throw new HttpError(400, "overlay.photoHref too long");
    // Defense in depth with svg.ts safeHref: reject non-https / non-raster here.
    if (
      !raw.photoHref.startsWith("https://") &&
      !raw.photoHref.startsWith("data:image/png") &&
      !raw.photoHref.startsWith("data:image/jpeg") &&
      !raw.photoHref.startsWith("data:image/webp")
    ) {
      throw new HttpError(400, "overlay.photoHref must be https:// or data:image/png,jpeg,webp");
    }
    overlay.photoHref = raw.photoHref;
  }
  return overlay;
}

export async function renderBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  const reported = await reportBody(body, env, requestId, fetchFn);
  const result = reported.result as {
    measurement: { findings: MeasuredFinding[]; receipts: Receipt[]; mode: "absolute" | "percent-only" };
    findings: FindingDraft[];
    gate: { ok: boolean };
  };
  const transcript = isRecord(body) && typeof body.transcript === "string" ? (body.transcript as string).slice(0, 2000) : "";
  const svg = renderAnnexureSvg({
    findings: result.measurement.findings,
    receipts: result.measurement.receipts,
    mode: result.measurement.mode,
    statements: result.findings,
    transcript,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    ...(isRecord(body) && body.overlay !== undefined ? { overlay: parseOverlay(body.overlay) } : {}),
  });
  return envelope(requestId, started, { svg, gate: result.gate, findings: result.findings });
}

export function errorBody(message: string, code: number, requestId: string, details?: unknown): VerboseError {
  // Cap verbose internals: full gate failures aid debugging but also aid RLE
  // and gate probing. Keep the summary, truncate the details payload.
  const capped = typeof details === "string" && details.length > 2000 ? `${details.slice(0, 2000)}…[truncated]` : details;
  const cappedArr = Array.isArray(details) && JSON.stringify(details).length > 4000
    ? (JSON.stringify(details).slice(0, 4000) as unknown)
    : details;
  return { ok: false, error: String(message).slice(0, 500), code, requestId, details: typeof details === "string" ? capped : cappedArr };
}

/**
 * Trust boundary: /v1/findings and /v1/skeptic require server-side
 * recomputation. Callers must send component + masks so the server can
 * re-measure and reject smuggled fake receipts — the gate alone only checks
 * internal consistency. No opt-out: use /v1/report for the full pipeline.
 */
export function crossCheckMeasurement(body: Record<string, unknown>, findings: unknown, receipts: unknown, env: Env = {}): void {
  if (body.component === undefined || body.masks === undefined) {
    throw new HttpError(422, "component and masks are required: send measurement inputs for server-side recomputation");
  }
  const config = configFromEnv(env);
  const recomputed = measureSession(toMeasureInput(body, config.minReferenceConfidence));
  if (JSON.stringify(findings) !== JSON.stringify(recomputed.findings) || JSON.stringify(receipts) !== JSON.stringify(recomputed.receipts)) {
    const err = new HttpError(422, "supplied findings/receipts do not match server recomputation from component + masks");
    (err as HttpError & { details?: unknown }).details = ["re-measured server-side; resubmit via /v1/report or send matching receipts"];
    throw err;
  }
}

const SESSION_MODES = ["absolute", "percent-only"];
const defaultStore: Store = new MemoryStore();

/** Validate a session body; picks only known keys. The server mints the id —
 * client-supplied ids allowed squatting/guessing via error-code probing. */
export function toSavedSession(body: unknown): SavedSession {
  if (!isRecord(body)) throw new HttpError(400, "body must be a JSON object");
  const { at, findings, mode } = body;
  if (typeof findings !== "number" || !Number.isInteger(findings) || findings < 0) throw new HttpError(400, "findings must be a non-negative integer");
  if (typeof mode !== "string" || !SESSION_MODES.includes(mode)) throw new HttpError(400, `mode must be one of ${SESSION_MODES.join(", ")}`);
  if (at !== undefined && typeof at !== "string") throw new HttpError(400, "at must be a string");
  if (typeof at === "string" && (Number.isNaN(Date.parse(at)) || !/^\d{4}-\d{2}-\d{2}T/.test(at))) throw new HttpError(400, "at must be an ISO date");
  return { id: crypto.randomUUID(), at: at ?? new Date().toISOString(), findings, mode };
}

const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_HEADERS = "content-type";

export function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": CORS_METHODS,
    "access-control-allow-headers": CORS_HEADERS,
  };
}

/**
 * Origin-restricted CORS for the public demo. Set ALLOWED_ORIGINS to a
 * comma-separated list (e.g. your Pages URL) and browsers outside it can no
 * longer spend your SPEND_GUARD_USD from a web page.
 * - No allowlist + mock mode: "*" (local dev, $0 spend).
 * - No allowlist + live mode: no ACAO header (deny by default; curl unaffected).
 * - Allowlist set: echo the caller only on exact match, otherwise omit ACAO
 *   (fail closed — never fall back to the first allowlisted origin).
 */
export function corsHeadersFor(origin: string | null, env: Env = {}): Record<string, string> {
  const raw = env.ALLOWED_ORIGINS ?? "";
  const allowed = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (allowed.length === 0) {
    const mockMode = (env.MOCK_MODE ?? "1") !== "0";
    if (mockMode) return corsHeaders();
    return {
      "access-control-allow-methods": CORS_METHODS,
      "access-control-allow-headers": CORS_HEADERS,
    };
  }
  if (origin !== null && allowed.includes(origin)) {
    return { ...corsHeaders(), "access-control-allow-origin": origin };
  }
  // Mismatch (or missing Origin): omit ACAO so the browser blocks the read.
  return {
    "access-control-allow-methods": CORS_METHODS,
    "access-control-allow-headers": CORS_HEADERS,
  };
}

export interface HandledResponse {
  status: number;
  body: unknown;
}

/** Minimal per-IP token bucket: 120 req/min per key. Both the Node server and
 * the Worker call it; each isolate keeps its own bucket (documented limit —
 * a global cap needs D1/Durable Objects, like the spend guard). */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const rateBuckets = new Map<string, { count: number; reset: number }>();

export function checkRateLimit(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  if (rateBuckets.size > 10_000) {
    for (const [k, v] of rateBuckets) if (now >= v.reset) rateBuckets.delete(k);
    if (rateBuckets.size > 10_000) rateBuckets.clear();
  }
  const entry = rateBuckets.get(key);
  if (!entry || now >= entry.reset) {
    rateBuckets.set(key, { count: 1, reset: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true, retryAfterSec: 0 };
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    return { ok: false, retryAfterSec: Math.ceil((entry.reset - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

export function isRateLimited(key: string, now = Date.now()): boolean {
  return !checkRateLimit(key, now).ok;
}

/** Test hook: clear buckets between tests. */
export function resetRateLimits(): void {
  rateBuckets.clear();
}

/** Single router used by both the Node server and the Cloudflare Worker. */
export async function handleRequest(input: {
  method: string;
  path: string;
  body?: unknown;
  env?: Env;
  fetchFn?: FetchFn;
  store?: Store;
}): Promise<HandledResponse> {
  const requestId = newRequestId();
  const store = input.store ?? defaultStore;
  const env = input.env ?? {};
  try {
    if (input.method === "GET" && input.path === "/v1/health") return { status: 200, body: healthBody(env) };
    if (input.method === "GET" && input.path === "/v1/spend") return { status: 200, body: spendStatus(env) };
    if (input.method === "POST" && input.path === "/v1/measure") return { status: 200, body: measureBody(input.body, requestId, env) };
    if (input.method === "POST" && input.path === "/v1/observe") return { status: 200, body: observeBody(input.body, requestId) };
    if (input.method === "POST" && input.path === "/v1/crosscheck") return { status: 200, body: crosscheckBody(input.body, requestId) };
    if (input.method === "POST" && input.path === "/v1/report") return { status: 200, body: await reportBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/segment") return { status: 200, body: await segmentBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/transcribe") return { status: 200, body: await transcribeBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/findings") return { status: 200, body: await findingsBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/skeptic") return { status: 200, body: await skepticBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/render") return { status: 200, body: await renderBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/sessions") {
      const started = Date.now();
      const session = toSavedSession(input.body);
      await store.save(session);
      return { status: 200, body: envelope(requestId, started, session) };
    }
    if (input.method === "GET" && input.path === "/v1/sessions") {
      const started = Date.now();
      return { status: 200, body: envelope(requestId, started, { sessions: await store.list() }) };
    }
    return { status: 404, body: errorBody("not found", 404, requestId, { method: input.method, path: input.path }) };
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    const message = error instanceof Error ? error.message : "invalid request";
    const details = (error as { details?: unknown })?.details;
    // EvidenceError from the gate carries its failures in the message; surface them structured too.
    const failures = (error as { failures?: unknown })?.failures;
    return { status, body: errorBody(message, status, requestId, details ?? failures) };
  }
}

export { newRequestId };
