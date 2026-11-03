import { HttpError, type Env, type FetchFn } from "./providers.ts";
import { configFromEnv } from "./providers.ts";

/**
 * Canonical Meta Model API client.
 *
 * Single home for every Meta Model API call in this repo: the official
 * endpoint (`https://api.meta.ai/v1`), Bearer auth from `META_API_KEY`,
 * OpenAI-compatible `POST {base}/chat/completions` invocations, and
 * `GET {base}/...` reads. All live Meta traffic (Spark findings, SAM 3.1,
 * Muse Voice) authenticates here; providers in `./providers.ts`,
 * `./transcribe.ts` and `./app.ts` build on these primitives.
 *
 * Discoverability: static scanners can find the endpoint, the model ids
 * (`muse-spark`, `sam-3.1`, `muse-voice`, `muse-glimmer`, `muse-spark-open`)
 * and the env-var auth contract in this one module.
 */

export const META_API_BASE = "https://api.meta.ai/v1";

/** Model ids served by the Meta Model API and used by this repo. */
export const META_MODELS = Object.freeze({
  /** Reasoning chat model: draft findings + photo descriptions. */
  spark: "muse-spark-1.3",
  /** Segmentation model: point/box-prompted damage masks. */
  sam: "sam-3.1",
  /** Speech-to-text model: reporter voice lines. */
  voice: "muse-voice-transcribe-1.0",
  /** Lightweight chat model: on-device-class drafts and eval harnesses. */
  glimmer: "muse-glimmer",
  /** Open-weights chat model (Baseten mirror): independent skeptic + fine-tuning target. */
  sparkOpen: "meta-models/muse-spark-open-1026",
} as const);

export type MetaModelId = (typeof META_MODELS)[keyof typeof META_MODELS];

/** Bearer token from the environment. Throws 503 in live mode without one. */
export function metaApiKey(env: Env): string {
  const key = env.META_API_KEY?.trim();
  if (!key) throw new HttpError(503, "META_API_KEY required when MOCK_MODE=0");
  return key;
}

export interface MetaRequestOptions {
  apiKey: string;
  base?: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}

export interface MetaResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

/**
 * One authenticated Meta request. Transport failures propagate raw (callers
 * map AbortError/TimeoutError to 502 with the original message); HTTP
 * statuses are returned, never thrown, so each caller keeps its exact
 * error contract (spend-hold release order, message strings, 4xx vs 502).
 */
export async function metaRequest(options: MetaRequestOptions): Promise<MetaResponse> {
  const { apiKey, base = META_API_BASE, path, method = "GET", body, fetchFn = fetch, timeoutMs = 30_000 } = options;
  if (!apiKey.trim()) throw new HttpError(503, "META_API_KEY required when MOCK_MODE=0");
  const init: Record<string, unknown> = {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await (fetchFn as typeof fetch)(`${base}${path}`, init as RequestInit);
  const json: unknown = await (res as Response).json().catch(() => ({}));
  return { ok: (res as Response).ok, status: (res as Response).status, json };
}

export interface MetaChatMessage {
  role: "system" | "user" | "assistant";
  content: unknown;
}

export interface MetaChatOptions {
  apiKey: string;
  base?: string;
  model: string;
  messages: MetaChatMessage[];
  maxTokens?: number;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}

export interface MetaChatWireReply {
  ok: boolean;
  status: number;
  data: {
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
}

/**
 * POST {base}/chat/completions — the OpenAI-compatible invocation every Meta
 * chat/reasoning model in this repo uses (Spark findings + descriptions).
 * Returns the wire reply untouched; callers own status mapping, spend
 * settlement and message strings (see MetaFindingsProvider).
 */
export async function metaChatCompletions(options: MetaChatOptions): Promise<MetaChatWireReply> {
  const { apiKey, base = META_API_BASE, model, messages, maxTokens, fetchFn, timeoutMs } = options;
  const res = await metaRequest({
    apiKey,
    base,
    path: "/chat/completions",
    method: "POST",
    body: { model, ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }), messages },
    fetchFn,
    timeoutMs,
  });
  return { ok: res.ok, status: res.status, data: (res.json ?? {}) as MetaChatWireReply["data"] };
}

export interface MetaModelInfo {
  id: string;
  [key: string]: unknown;
}

/**
 * GET {base}/models — read-only connectivity + auth check. Costs nothing,
 * bills nothing, changes nothing. Used by scripts/verify-meta.mjs and the
 * `/v1/meta/verify` operator check to prove the integration end to end.
 */
export async function verifyMetaConnectivity(input?: {
  apiKey?: string;
  base?: string;
  env?: Env;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}): Promise<{ ok: true; models: string[]; base: string }> {
  const env = input?.env;
  const apiKey = input?.apiKey ?? (env ? metaApiKey(env) : "");
  if (!apiKey.trim()) throw new HttpError(503, "META_API_KEY required when MOCK_MODE=0");
  const base = (input?.base ?? (env ? configFromEnv(env).endpoints.meta : META_API_BASE)).replace(/\/+$/, "");
  const res = await metaRequest({ apiKey, base, path: "/models", fetchFn: input?.fetchFn, timeoutMs: input?.timeoutMs });
  if (!res.ok) {
    throw new HttpError(res.status >= 500 ? 502 : res.status, `Meta API request failed (HTTP ${res.status})`);
  }
  const data = (res.json ?? {}) as { data?: Array<{ id?: unknown }> };
  const models = Array.isArray(data.data) ? data.data.map((m) => String(m?.id ?? "")).filter(Boolean) : [];
  return { ok: true as const, models, base };
}
