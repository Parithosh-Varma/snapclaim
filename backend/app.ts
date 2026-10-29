import { measureSession } from "../src/engine/measure.ts";
import { circularReference, observeMask } from "../src/vision/observe.ts";
import { decodeRle, type BinaryMask, type CocoRle } from "../src/vision/mask.ts";
import { agreementVerdict, maskAgreement } from "../src/vision/agreement.ts";
import type { MeasureSessionInput } from "../src/engine/types.ts";
import { validateFindings, type FindingDraft, type GateResult } from "../src/findings/evidence-gate.ts";
import type { FindingsProvider, FindingsRequest } from "../src/adapters/types.ts";
import type { MeasuredFinding } from "../src/engine/types.ts";
import type { Receipt } from "../src/receipts/types.ts";
import { renderAnnexureSvg } from "../src/render/svg.ts";
import { guardFor, spendStatus } from "./spend.ts";
import { BudgetExceededError } from "../src/config/spend-guard.ts";
import { configFromEnv, findingsProvider, requireLiveKeys, skepticProvider, visionProvider, HttpError, SAM_IMAGE_USD, type Env, type FetchFn } from "./providers.ts";
import {
  DEFAULT_KEYWORDS,
  DEFAULT_LANGUAGE_BIAS,
  estimateAudioUsd,
  transcribeWithMuse,
  type TranscribeResult,
} from "./transcribe.ts";
import { encodeRle as encodeMaskRle } from "../src/vision/mask.ts";
import { segmentWithSam, type SamPoint } from "../src/vision/sam.ts";
import { executeRemoteD1 } from "./d1-proxy.ts";
import {
  decodeBase64ToBytes,
  encodeBytesToBase64,
  getRemoteR2,
  putRemoteR2,
  r2BucketFromEnv,
  r2ProxyTarget,
  splitDataUrl,
  validateR2ContentType,
  validateR2DataBase64,
  validateR2Key,
} from "./r2-proxy.ts";

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
export function toMeasureInput(body: unknown): MeasureSessionInput {
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  const { component, masks, scaleReference, thresholds, minReferenceConfidence } = body;
  const input: MeasureSessionInput = {
    component: component as MeasureSessionInput["component"],
    masks: masks as MeasureSessionInput["masks"],
  };
  if (scaleReference !== undefined) input.scaleReference = scaleReference as MeasureSessionInput["scaleReference"];
  if (thresholds !== undefined) input.thresholds = thresholds as MeasureSessionInput["thresholds"];
  if (minReferenceConfidence !== undefined) input.minReferenceConfidence = minReferenceConfidence as number;
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

export function measureBody(body: unknown, requestId = newRequestId()): EnvelopedResult {
  const started = Date.now();
  const result = measureSession(toMeasureInput(body));
  quietLog("[measure]", { requestId, findings: result.findings.length });
  return envelope(requestId, started, result);
}

function parseRle(value: unknown, name: string): BinaryMask {
  if (!isRecord(value)) throw new HttpError(400, `${name}.rle must be {size:[h,w], counts}`);
  const { size, counts } = value;
  if (!Array.isArray(size) || size.length !== 2 || !size.every((n) => Number.isInteger(n) && n > 0)) {
    throw new HttpError(400, `${name}.rle.size must be [height, width] positive integers`);
  }
  if (!Array.isArray(counts) && typeof counts !== "string") {
    throw new HttpError(400, `${name}.rle.counts must be a number array or COCO string`);
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

  const observed = decoded.map(({ raw, mask }, i) => {
    const label = raw.label;
    if (typeof label !== "string") throw new HttpError(400, `masks[${i}].label must be a string`);
    return observeMask(mask, {
      id: requireId(raw.id, `masks[${i}].id`),
      label: label as never,
      confidence: requireNumber(raw.confidence, `masks[${i}].confidence`),
      ...(componentMask ? { component: componentMask } : {}),
    });
  });

  const result: Pick<MeasureSessionInput, "component" | "masks" | "scaleReference"> = {
    component: componentObs,
    masks: observed,
  };
  if (reference !== undefined) {
    if (!isRecord(reference)) throw new HttpError(400, "reference must be an object");
    const refMask = parseRle(reference.rle, "reference");
    sameSize(refMask, "reference");
    try {
      result.scaleReference = circularReference(refMask, {
        id: requireId(reference.id, "reference.id"),
        knownMm: requireNumber(reference.knownMm, "reference.knownMm"),
        confidence: requireNumber(reference.confidence, "reference.confidence"),
      }).reference;
    } catch (error) {
      throw new HttpError(422, `reference: ${error instanceof Error ? error.message : "cannot measure"}`);
    }
  }
  quietLog("[observe]", { requestId, masks: observed.length });
  return envelope(requestId, started, result);
}

/**
 * Model drafts fail the evidence gate often (extra findings, uncited numbers).
 * Retry with the gate failures fed back so the model repairs only what failed,
 * then fail closed. Explicit caller-supplied drafts never retry — they go
 * straight to the gate.
 */
export const MAX_DRAFT_ATTEMPTS = 3;

export async function draftWithGateRetry(
  provider: FindingsProvider,
  request: FindingsRequest,
  maxAttempts = MAX_DRAFT_ATTEMPTS,
): Promise<{ drafts: FindingDraft[]; gate: GateResult; attempts: number }> {
  let failures: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const drafts = await provider.draftFindings(
      failures.length ? { ...request, attemptErrors: failures } : request,
    );
    const gate = validateFindings(drafts, request.receipts);
    if (gate.ok) return { drafts, gate, attempts: attempt };
    failures = gate.failures;
  }
  const err = new HttpError(422, "Evidence gate failed");
  (err as HttpError & { details?: unknown }).details = failures;
  throw err;
}

export async function reportBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  const measurement = measureSession(toMeasureInput(body));
  const transcript = typeof body.transcript === "string" ? body.transcript : "";

  let drafts: FindingDraft[];
  let gate: GateResult;
  if (body.drafts !== undefined) {
    if (!Array.isArray(body.drafts)) throw new Error("drafts must be an array");
    drafts = body.drafts as FindingDraft[];
    gate = validateFindings(drafts, measurement.receipts);
    if (!gate.ok) {
      const err = new HttpError(422, "Evidence gate failed");
      (err as HttpError & { details?: unknown }).details = gate.failures;
      throw err;
    }
  } else {
    const provider = findingsProvider(env, configFromEnv(env), fetchFn, guardFor(env));
    ({ drafts, gate } = await draftWithGateRetry(
      provider,
      { transcript, findings: measurement.findings, receipts: measurement.receipts },
    ));
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
  if (!imageUrl.startsWith("data:image/") && !imageUrl.startsWith("https://")) {
    throw new HttpError(400, "live /v1/segment needs body.imageUrl (https:// or data:image/)");
  }
  const width = requireNumber(body.width, "width");
  const height = requireNumber(body.height, "height");
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
  const languageBias = Array.isArray(body.languageBias) ? body.languageBias.map(String) : DEFAULT_LANGUAGE_BIAS;
  const keywords = Array.isArray(body.keywords) ? body.keywords.map(String) : DEFAULT_KEYWORDS;
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

export async function findingsBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  const findings = body.findings as MeasuredFinding[];
  const receipts = body.receipts as Receipt[];
  if (!Array.isArray(findings) || !Array.isArray(receipts)) throw new Error("findings and receipts arrays are required");
  crossCheckMeasurement(body, findings, receipts);
  const provider = findingsProvider(env, configFromEnv(env), fetchFn, guardFor(env));
  const { drafts, gate } = await draftWithGateRetry(provider, {
    transcript: typeof body.transcript === "string" ? body.transcript : "",
    findings,
    receipts,
  });
  return envelope(requestId, started, { findings: drafts, gate });
}

export async function skepticBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  const findings = body.findings as MeasuredFinding[];
  const receipts = body.receipts as Receipt[];
  if (!Array.isArray(findings) || !Array.isArray(receipts)) throw new Error("findings and receipts arrays are required");
  crossCheckMeasurement(body, findings, receipts);
  const provider = skepticProvider(env, configFromEnv(env), fetchFn, guardFor(env));
  const { drafts, gate } = await draftWithGateRetry(provider, {
    transcript: typeof body.transcript === "string" ? body.transcript : "",
    findings,
    receipts,
  });
  return envelope(requestId, started, { findings: drafts, gate });
}

export async function renderBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  const reported = await reportBody(body, env, requestId, fetchFn);
  const result = reported.result as {
    measurement: { findings: MeasuredFinding[]; receipts: Receipt[]; mode: "absolute" | "percent-only" };
    findings: FindingDraft[];
    gate: { ok: boolean };
  };
  const transcript = isRecord(body) && typeof body.transcript === "string" ? body.transcript : "";
  const svg = renderAnnexureSvg({
    findings: result.measurement.findings,
    receipts: result.measurement.receipts,
    mode: result.measurement.mode,
    statements: result.findings,
    transcript,
    version: VERSION,
    generatedAt: new Date().toISOString(),
  });
  return envelope(requestId, started, { svg, gate: result.gate, findings: result.findings });
}

export function errorBody(message: string, code: number, requestId: string, details?: unknown): VerboseError {
  return { ok: false, error: message, code, requestId, details };
}

function proxyTarget(env: Env): { apiToken: string; accountId: string; databaseId: string } | null {
  const apiToken = typeof env.D1_PROXY_TOKEN === "string" ? env.D1_PROXY_TOKEN : "";
  const accountId = typeof env.D1_PROXY_ACCOUNT_ID === "string" ? env.D1_PROXY_ACCOUNT_ID : "";
  const databaseId = typeof env.D1_PROXY_DATABASE_ID === "string" ? env.D1_PROXY_DATABASE_ID : "";
  if (!apiToken || !accountId || !databaseId) return null;
  return { apiToken, accountId, databaseId };
}

/**
 * POST /v1/collect — tester dataset donation (explicit opt-in only).
 * The PWA sends consent:true only after a separate unticked-by-default
 * donation toggle; the server still rejects consent!==true (400) and
 * fails closed without D1. Terms acceptance alone never sends here.
 *
 * Body: {consent: true, image: "data:image/jpeg;base64,...", label?, coinMm?, transcript?, masksJson?, receiptsJson?, userAgent?}
 * The canvas dataURL already strips EXIF. Images are capped so the 1MB JSON
 * body limit is never hit. Writes to the local snapclaim_data D1 binding when
 * present, else falls back to the cross-account proxy (D1_PROXY_* env) so one
 * Worker can serve a database that lives in another account.
 *
 * R2 spill: when a bucket is bound (same account) or R2_PROXY_* points at the
 * holder worker in the R2 account (other account), the image bytes go to R2
 * under donations/{requestId}.ext and D1 stores the pointer "r2:{key}".
 * Without R2 configured the data: URL is stored inline as before. Readers
 * must accept both forms.
 */
export async function collectBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new HttpError(400, "body must be a JSON object");
  if (body.consent !== true) throw new HttpError(400, "consent must be true — donation is opt-in only");
  const image = body.image;
  if (typeof image !== "string" || image.length === 0) throw new HttpError(400, "image must be a data: URL string");
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    throw new HttpError(400, "image must be a data:image/jpeg|png|webp base64 URL (canvas strips EXIF)");
  }
  if (image.length > 900_000) throw new HttpError(400, "image too large — donate a photo at 768px or smaller");
  const label = body.label === undefined ? null : String(body.label).slice(0, 32);
  const coinMm = body.coinMm === undefined || body.coinMm === null ? null : requireNumber(body.coinMm, "coinMm");
  const transcript = body.transcript === undefined || body.transcript === null ? null : String(body.transcript).slice(0, 500);
  const masksJson = body.masksJson === undefined || body.masksJson === null ? null : String(body.masksJson).slice(0, 100_000);
  const receiptsJson = body.receiptsJson === undefined || body.receiptsJson === null ? null : String(body.receiptsJson).slice(0, 100_000);
  const userAgent = body.userAgent === undefined || body.userAgent === null ? null : String(body.userAgent).slice(0, 200);
  const createdAt = new Date().toISOString();
  // D1 target must exist before any R2 write — otherwise a missing store
  // leaves an orphaned object in the bucket. Fail closed first.
  const db = (env as { snapclaim_data?: {
    prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
  } }).snapclaim_data;
  const d1proxy = db ? null : proxyTarget(env);
  if (!db && !d1proxy) {
    throw new HttpError(503, "dataset store not configured: bind snapclaim_data D1 or set D1_PROXY_* for the cross-account fallback");
  }
  // Prefer R2 for the bytes; fall back to inline storage when unconfigured.
  let storedImage = image;
  const bucket = r2BucketFromEnv(env as Record<string, unknown>);
  const r2proxy = r2ProxyTarget(env as Record<string, string | undefined>);
  if (bucket ?? r2proxy) {
    const { contentType, dataBase64, extension } = splitDataUrl(image);
    const r2Key = `donations/${requestId}.${extension}`;
    if (bucket) {
      await bucket.put(r2Key, decodeBase64ToBytes(dataBase64), { httpMetadata: { contentType } });
    } else if (r2proxy) {
      await putRemoteR2({ fetchFn, baseUrl: r2proxy.baseUrl, proxyKey: r2proxy.proxyKey, key: r2Key, contentType, dataBase64 });
    }
    storedImage = `r2:${r2Key}`;
  }
  const sql =
    "INSERT INTO donations (id, created_at, consent, image, label, coin_mm, transcript, masks_json, receipts_json, user_agent) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)";
  const args = [requestId, createdAt, storedImage, label, coinMm, transcript, masksJson, receiptsJson, userAgent];
  if (db) {
    await db.prepare(sql).bind(...args).run();
  } else if (d1proxy) {
    await executeRemoteD1({ fetchFn, ...d1proxy, sql, params: args });
  }
  quietLog("[collect]", { requestId, bytes: image.length });
  return envelope(requestId, started, { id: requestId, createdAt });
}

export async function collectCountBody(env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  const db = (env as { snapclaim_data?: {
    prepare(query: string): { bind(...values: unknown[]): { first<T>(col?: string): Promise<T | null> } };
  } }).snapclaim_data;
  if (db) {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM donations").bind().first<{ n: number }>();
    return envelope(requestId, started, { count: row?.n ?? 0 });
  }
  const proxy = proxyTarget(env);
  if (!proxy) throw new HttpError(503, "dataset store not configured: bind snapclaim_data D1 or set D1_PROXY_* for the cross-account fallback");
  const rows = await executeRemoteD1({ fetchFn, ...proxy, sql: "SELECT COUNT(*) AS n FROM donations" });
  const n = (rows[0] as { n?: unknown } | undefined)?.n;
  return envelope(requestId, started, { count: typeof n === "number" ? n : 0 });
}

/**
 * POST /v1/d1/query — key-guarded generic relay to any D1 in any account.
 * Body: {key, apiToken, accountId, databaseId, sql, params?}. The key must
 * match the D1_PROXY_KEY worker secret or the call fails closed (403; 503
 * when the secret is not configured at all). Lets the operator query or
 * migrate databases without redeploying a bound Worker per account.
 */
export async function d1QueryBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new HttpError(400, "body must be a JSON object");
  const configured = typeof env.D1_PROXY_KEY === "string" && env.D1_PROXY_KEY.length > 0;
  if (!configured) throw new HttpError(503, "D1 proxy not configured: set the D1_PROXY_KEY worker secret");
  if (typeof body.key !== "string" || body.key !== env.D1_PROXY_KEY) {
    throw new HttpError(403, "bad proxy key");
  }
  if (typeof body.apiToken !== "string" || body.apiToken.length === 0) {
    throw new HttpError(400, "apiToken must be a non-empty Cloudflare API token");
  }
  if (typeof body.sql !== "string") throw new HttpError(400, "sql must be a string");
  if (typeof body.accountId !== "string" || typeof body.databaseId !== "string") {
    throw new HttpError(400, "accountId and databaseId are required");
  }
  const params = body.params === undefined ? [] : body.params;
  const rows = await executeRemoteD1({
    fetchFn,
    apiToken: body.apiToken,
    accountId: body.accountId,
    databaseId: body.databaseId,
    sql: body.sql,
    params: Array.isArray(params) ? (params as unknown[]) : [],
  });
  return envelope(requestId, started, { rows });
}

function requireR2OperatorKey(body: Record<string, unknown>, env: Env): void {
  const configured = typeof env.R2_PROXY_KEY === "string" && env.R2_PROXY_KEY.length > 0;
  if (!configured) throw new HttpError(503, "R2 proxy not configured: set the R2_PROXY_KEY worker secret");
  if (typeof body.auth !== "string" || body.auth !== env.R2_PROXY_KEY) {
    throw new HttpError(403, "bad proxy key");
  }
}

/**
 * POST /v1/r2/put — operator object store via the bound bucket or the
 * cross-account holder (R2_PROXY_URL + R2_PROXY_KEY). Body:
 * {auth, key, contentType, dataBase64}. Auth must match R2_PROXY_KEY
 * (same guard as POST /v1/d1/query). Native binding wins; else forwards
 * to the holder; else 503. Fail-closed on every validation.
 */
export async function r2PutBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new HttpError(400, "body must be a JSON object");
  requireR2OperatorKey(body, env);
  const key = validateR2Key(body.key);
  const contentType = validateR2ContentType(body.contentType);
  const dataBase64 = validateR2DataBase64(body.dataBase64);
  const bucket = r2BucketFromEnv(env as Record<string, unknown>);
  if (bucket) {
    const bytes = decodeBase64ToBytes(dataBase64);
    await bucket.put(key, bytes, { httpMetadata: { contentType } });
    return envelope(requestId, started, { key, size: bytes.length });
  }
  const proxy = r2ProxyTarget(env as Record<string, string | undefined>);
  if (!proxy) throw new HttpError(503, "R2 store not configured: bind snapclaim_images or set R2_PROXY_URL for the cross-account holder");
  const stored = await putRemoteR2({ fetchFn, baseUrl: proxy.baseUrl, proxyKey: proxy.proxyKey, key, contentType, dataBase64 });
  return envelope(requestId, started, stored);
}

/**
 * POST /v1/r2/get — operator object fetch. Body: {auth, key} with the same
 * key guard as /v1/r2/put. Returns {key, contentType, dataBase64, size}.
 * Small objects only (holder caps at 900KB base64) so the 1MB JSON cap holds.
 */
export async function r2GetBody(body: unknown, env: Env, requestId = newRequestId(), fetchFn?: FetchFn): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new HttpError(400, "body must be a JSON object");
  requireR2OperatorKey(body, env);
  const key = validateR2Key(body.key);
  const bucket = r2BucketFromEnv(env as Record<string, unknown>);
  if (bucket) {
    const obj = await bucket.get(key);
    if (!obj) throw new HttpError(404, "object not found");
    const bytes = new Uint8Array(await obj.arrayBuffer());
    return envelope(requestId, started, {
      key,
      contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
      dataBase64: encodeBytesToBase64(bytes),
      size: obj.size,
    });
  }
  const proxy = r2ProxyTarget(env as Record<string, string | undefined>);
  if (!proxy) throw new HttpError(503, "R2 store not configured: bind snapclaim_images or set R2_PROXY_URL for the cross-account holder");
  const got = await getRemoteR2({ fetchFn, baseUrl: proxy.baseUrl, proxyKey: proxy.proxyKey, key });
  return envelope(requestId, started, got);
}

/**
 * Trust boundary: /v1/findings and /v1/skeptic accept client-supplied
 * findings + receipts. When the body also carries the measurement inputs
 * (component + masks), recompute server-side and reject mismatches — a
 * client must not be able to smuggle fake receipts past the gate.
 * Bodies without measurement inputs keep the old behavior (trusted client,
 * e.g. replay tooling); the PWA must always send the inputs.
 */
export function crossCheckMeasurement(body: Record<string, unknown>, findings: unknown, receipts: unknown): void {
  if (body.component === undefined || body.masks === undefined) return;
  const recomputed = measureSession(toMeasureInput(body));
  if (JSON.stringify(findings) !== JSON.stringify(recomputed.findings) || JSON.stringify(receipts) !== JSON.stringify(recomputed.receipts)) {
    const err = new HttpError(422, "supplied findings/receipts do not match server recomputation from component + masks");
    (err as HttpError & { details?: unknown }).details = ["re-measured server-side; resubmit via /v1/report or send matching receipts"];
    throw err;
  }
}

export function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

/**
 * Origin-restricted CORS for the public demo. Set ALLOWED_ORIGINS to a
 * comma-separated list (e.g. your Pages URL) and browsers outside it can no
 * longer spend your SPEND_GUARD_USD from a web page. Unset means "*" (dev).
 * curl and other non-browser clients are unaffected by design — the spend
 * guard and per-call metering are the backstop there.
 */
export function corsHeadersFor(origin: string | null, env: Env = {}): Record<string, string> {
  const base = corsHeaders();
  const raw = env.ALLOWED_ORIGINS ?? "";
  const allowed = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (allowed.length === 0) return base;
  if (origin !== null && allowed.includes(origin)) {
    return { ...base, "access-control-allow-origin": origin };
  }
  return { ...base, "access-control-allow-origin": allowed[0] as string };
}

export interface HandledResponse {
  status: number;
  body: unknown;
}

/** Single router used by both the Node server and the Cloudflare Worker. */
export async function handleRequest(input: {
  method: string;
  path: string;
  body?: unknown;
  env?: Env;
  fetchFn?: FetchFn;
}): Promise<HandledResponse> {
  const requestId = newRequestId();
  const env = input.env ?? {};
  try {
    if (input.method === "GET" && input.path === "/v1/health") return { status: 200, body: healthBody(env) };
    if (input.method === "GET" && input.path === "/v1/spend") return { status: 200, body: spendStatus(env) };
    if (input.method === "POST" && input.path === "/v1/measure") return { status: 200, body: measureBody(input.body, requestId) };
    if (input.method === "POST" && input.path === "/v1/observe") return { status: 200, body: observeBody(input.body, requestId) };
    if (input.method === "POST" && input.path === "/v1/crosscheck") return { status: 200, body: crosscheckBody(input.body, requestId) };
    if (input.method === "POST" && input.path === "/v1/report") return { status: 200, body: await reportBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/segment") return { status: 200, body: await segmentBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/transcribe") return { status: 200, body: await transcribeBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/findings") return { status: 200, body: await findingsBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/skeptic") return { status: 200, body: await skepticBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/render") return { status: 200, body: await renderBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/collect") return { status: 200, body: await collectBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "GET" && input.path === "/v1/collect/count") return { status: 200, body: await collectCountBody(env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/d1/query") return { status: 200, body: await d1QueryBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/r2/put") return { status: 200, body: await r2PutBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/r2/get") return { status: 200, body: await r2GetBody(input.body, env, requestId, input.fetchFn) };
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
