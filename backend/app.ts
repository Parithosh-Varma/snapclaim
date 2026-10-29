import { measureSession } from "../src/engine/measure.ts";
import { type ReferenceDiagnostics, circularReference, observeMask, tiltStretch } from "../src/vision/observe.ts";
import { decodeRle, intersectMasks, type BinaryMask, type CocoRle } from "../src/vision/mask.ts";
import { agreementVerdict, maskAgreement } from "../src/vision/agreement.ts";
import type { MeasureSessionInput } from "../src/engine/types.ts";
import { validateFindings, type FindingDraft } from "../src/findings/evidence-gate.ts";
import type { MeasuredFinding } from "../src/engine/types.ts";
import type { Receipt } from "../src/receipts/types.ts";
import { type AnnexureOverlay, renderAnnexureSvg } from "../src/render/svg.ts";
import { maskOutlinePath } from "../src/vision/contour.ts";
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
import { MemoryStore, type SavedSession, type Store } from "./store.ts";
import { segmentWithSam, type SamPoint } from "../src/vision/sam.ts";

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
        knownMm: requireNumber(reference.knownMm, "reference.knownMm"),
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
  const measurement = measureSession(toMeasureInput(body));
  const transcript = typeof body.transcript === "string" ? body.transcript : "";

  let drafts: FindingDraft[];
  if (body.drafts !== undefined) {
    if (!Array.isArray(body.drafts)) throw new Error("drafts must be an array");
    drafts = body.drafts as FindingDraft[];
  } else {
    const provider = findingsProvider(env, configFromEnv(env), fetchFn, guardFor(env));
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
  const drafts = await provider.draftFindings({
    transcript: typeof body.transcript === "string" ? body.transcript : "",
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
  if (!Array.isArray(findings) || !Array.isArray(receipts)) throw new Error("findings and receipts arrays are required");
  crossCheckMeasurement(body, findings, receipts);
  const provider = skepticProvider(env, configFromEnv(env), fetchFn, guardFor(env));
  const drafts = await provider.draftFindings({
    transcript: typeof body.transcript === "string" ? body.transcript : "",
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
  const width = requireNumber(raw.width, "overlay.width");
  const height = requireNumber(raw.height, "overlay.height");
  if (!Array.isArray(raw.masks)) throw new HttpError(400, "overlay.masks must be an array");
  if (raw.masks.length > MAX_MASKS + 1) throw new HttpError(400, `overlay.masks capped at ${MAX_MASKS + 1}`);
  const masks = raw.masks.map((m, i) => {
    if (!isRecord(m) || typeof m.label !== "string" || typeof m.path !== "string" || !SVG_PATH.test(m.path)) {
      throw new HttpError(400, `overlay.masks[${i}] needs an id, a label and an SVG path`);
    }
    return { id: requireId(m.id, `overlay.masks[${i}].id`), label: m.label, path: m.path };
  });
  const overlay: AnnexureOverlay = { width, height, masks };
  if (typeof raw.photoHref === "string") overlay.photoHref = raw.photoHref;
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
  const transcript = isRecord(body) && typeof body.transcript === "string" ? body.transcript : "";
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
  return { ok: false, error: message, code, requestId, details };
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

const SESSION_MODES = ["absolute", "percent-only"];
const defaultStore: Store = new MemoryStore();

/** Validate a session body; picks only known keys. */
export function toSavedSession(body: unknown): SavedSession {
  if (!isRecord(body)) throw new HttpError(400, "body must be a JSON object");
  const { id, at, findings, mode } = body;
  if (typeof findings !== "number" || !Number.isInteger(findings) || findings < 0) throw new HttpError(400, "findings must be a non-negative integer");
  if (typeof mode !== "string" || !SESSION_MODES.includes(mode)) throw new HttpError(400, `mode must be one of ${SESSION_MODES.join(", ")}`);
  if (id !== undefined && typeof id !== "string") throw new HttpError(400, "id must be a string");
  if (at !== undefined && typeof at !== "string") throw new HttpError(400, "at must be a string");
  if (typeof at === "string" && (Number.isNaN(Date.parse(at)) || !/^\d{4}-\d{2}-\d{2}T/.test(at))) throw new HttpError(400, "at must be an ISO date");
  return { id: id ?? crypto.randomUUID(), at: at ?? new Date().toISOString(), findings, mode };
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
  store?: Store;
}): Promise<HandledResponse> {
  const requestId = newRequestId();
  const store = input.store ?? defaultStore;
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
