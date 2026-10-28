import { measureSession } from "../src/engine/measure.ts";
import { circularReference, observeMask } from "../src/vision/observe.ts";
import { decodeRle, type BinaryMask, type CocoRle } from "../src/vision/mask.ts";
import type { MeasureSessionInput } from "../src/engine/types.ts";
import { validateFindings, type FindingDraft } from "../src/findings/evidence-gate.ts";
import type { MeasuredFinding } from "../src/engine/types.ts";
import type { Receipt } from "../src/receipts/types.ts";
import { renderAnnexureSvg } from "../src/render/svg.ts";
import { guardFor, spendStatus } from "./spend.ts";
import { configFromEnv, findingsProvider, skepticProvider, visionProvider, HttpError, type Env, type FetchFn } from "./providers.ts";

export const VERSION = "0.2.0";
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

export async function segmentBody(body: unknown, env: Env, requestId = newRequestId()): Promise<EnvelopedResult> {
  const started = Date.now();
  if (!isRecord(body)) throw new Error("body must be a JSON object");
  const provider = visionProvider(env, configFromEnv(env), body.fixture as never);
  const result = await provider.segment({
    imageId: typeof body.imageId === "string" ? body.imageId : "unknown",
    labels: Array.isArray(body.labels) ? (body.labels as never) : [],
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
    if (input.method === "POST" && input.path === "/v1/report") return { status: 200, body: await reportBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/segment") return { status: 200, body: await segmentBody(input.body, env, requestId) };
    if (input.method === "POST" && input.path === "/v1/findings") return { status: 200, body: await findingsBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/skeptic") return { status: 200, body: await skepticBody(input.body, env, requestId, input.fetchFn) };
    if (input.method === "POST" && input.path === "/v1/render") return { status: 200, body: await renderBody(input.body, env, requestId, input.fetchFn) };
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
