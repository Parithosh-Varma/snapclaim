import { HttpError, type FetchFn } from "./providers.ts";

/**
 * Cross-account R2 client (main backend -> holder worker in the R2 account).
 *
 * Cloudflare bindings are same-account only, so when the bucket lives in
 * another account the main Worker cannot bind it. Instead a tiny holder
 * Worker is deployed in the R2 account with a native R2 binding
 * (see backend/r2-holder.ts) and this module forwards puts/gets to it over
 * HTTPS with a shared Bearer secret. Same shape as backend/d1-proxy.ts.
 *
 * Secrets stay server-side: the PWA never sees R2_PROXY_KEY. The PWA calls
 * /v1/collect (unchanged) and the backend spills the image to R2 internally.
 * Operator routes POST /v1/r2/put|get are guarded by per-request `auth`
 * matching the same secret (like POST /v1/d1/query).
 */

export const MAX_R2_BASE64_CHARS = 900_000;
export const ALLOWED_R2_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/json"] as const;
export type R2ContentType = (typeof ALLOWED_R2_CONTENT_TYPES)[number];

/** Object keys: relative paths, no traversal, capped at 256 chars. */
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;

export function validateR2Key(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new HttpError(400, "key must be a non-empty string of at most 256 chars");
  }
  if (!KEY_RE.test(value) || value.includes("..") || value.startsWith("/") || value.endsWith("/")) {
    throw new HttpError(400, "key must be a relative path [A-Za-z0-9._/-], no traversal");
  }
  return value;
}

export function validateR2ContentType(value: unknown): R2ContentType {
  if (typeof value !== "string" || !(ALLOWED_R2_CONTENT_TYPES as readonly string[]).includes(value)) {
    throw new HttpError(400, `contentType must be one of ${ALLOWED_R2_CONTENT_TYPES.join(", ")}`);
  }
  return value as R2ContentType;
}

export function validateR2DataBase64(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "dataBase64 must be a non-empty base64 string");
  }
  if (value.length > MAX_R2_BASE64_CHARS) {
    throw new HttpError(400, "object too large — keep dataBase64 at 900KB or smaller");
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) throw new HttpError(400, "dataBase64 is not valid base64");
  return value;
}

/** https:// only, except http://localhost|127.0.0.1 for the local stand-in. */
export function normalizeR2BaseUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) throw new HttpError(503, "R2 proxy not configured: set R2_PROXY_URL");
  const base = raw.replace(/\/+$/, "");
  if (/^https:\/\/.+/.test(base)) return base;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.test(base)) return base;
  throw new HttpError(400, "R2_PROXY_URL must be https:// or http://localhost for dev");
}

export interface R2ProxyTarget {
  baseUrl: string;
  proxyKey: string;
}

export function r2ProxyTarget(env: Record<string, string | undefined>): R2ProxyTarget | null {
  const baseUrl = typeof env.R2_PROXY_URL === "string" ? env.R2_PROXY_URL.trim() : "";
  const proxyKey = typeof env.R2_PROXY_KEY === "string" ? env.R2_PROXY_KEY : "";
  if (!baseUrl || !proxyKey) return null;
  return { baseUrl: normalizeR2BaseUrl(baseUrl), proxyKey };
}

/** Minimal structural type for a native R2 bucket binding (no CF types dep). */
export interface R2BucketLike {
  put(key: string, data: Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
    size: number;
  } | null>;
}

export function r2BucketFromEnv(env: Record<string, unknown>): R2BucketLike | null {
  const bucket = (env as { snapclaim_images?: unknown }).snapclaim_images;
  if (bucket !== undefined && bucket !== null && typeof bucket === "object") return bucket as R2BucketLike;
  return null;
}

export function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Split a canvas data: URL into content-type + raw base64 + file extension. */
export function splitDataUrl(image: string): { contentType: R2ContentType; dataBase64: string; extension: string } {
  const match = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!match) throw new HttpError(400, "image must be a data:image/jpeg|png|webp base64 URL (canvas strips EXIF)");
  const contentType = validateR2ContentType(match[1]);
  const dataBase64 = validateR2DataBase64(match[3]);
  const extension = match[2] === "jpeg" ? "jpg" : (match[2] as string);
  return { contentType, dataBase64, extension };
}

export interface RemoteR2PutOptions {
  fetchFn?: FetchFn;
  baseUrl: string;
  proxyKey: string;
  key: string;
  contentType: string;
  dataBase64: string;
}

export async function putRemoteR2(options: RemoteR2PutOptions): Promise<{ key: string; size: number }> {
  const key = validateR2Key(options.key);
  const contentType = validateR2ContentType(options.contentType);
  const dataBase64 = validateR2DataBase64(options.dataBase64);
  if (!options.proxyKey) throw new HttpError(503, "R2 proxy key not configured");
  const base = normalizeR2BaseUrl(options.baseUrl);
  const fetchFn = options.fetchFn ?? fetch;
  const res = await fetchFn(`${base}/put`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${options.proxyKey}` },
    body: JSON.stringify({ key, contentType, dataBase64 }),
  });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: { key?: string; size?: number };
    error?: string;
  } | null;
  if (!res.ok || !data?.ok) {
    throw new HttpError(502, `remote R2 put failed: ${data?.error ?? `HTTP ${res.status}`}`);
  }
  return { key: data?.result?.key ?? key, size: data?.result?.size ?? 0 };
}

export interface RemoteR2GetOptions {
  fetchFn?: FetchFn;
  baseUrl: string;
  proxyKey: string;
  key: string;
}

export async function getRemoteR2(options: RemoteR2GetOptions): Promise<{
  key: string;
  contentType: string;
  dataBase64: string;
  size: number;
}> {
  const key = validateR2Key(options.key);
  if (!options.proxyKey) throw new HttpError(503, "R2 proxy key not configured");
  const base = normalizeR2BaseUrl(options.baseUrl);
  const fetchFn = options.fetchFn ?? fetch;
  const res = await fetchFn(`${base}/object?key=${encodeURIComponent(key)}`, {
    method: "GET",
    headers: { authorization: `Bearer ${options.proxyKey}` },
  });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: { key?: string; contentType?: string; dataBase64?: string; size?: number };
    error?: string;
  } | null;
  if (res.status === 404) throw new HttpError(404, "object not found");
  if (!res.ok || !data?.ok || typeof data?.result?.dataBase64 !== "string") {
    throw new HttpError(502, `remote R2 get failed: ${data?.error ?? `HTTP ${res.status}`}`);
  }
  return {
    key: data.result?.key ?? key,
    contentType: data.result?.contentType ?? "application/octet-stream",
    dataBase64: data.result.dataBase64 as string,
    size: data.result?.size ?? 0,
  };
}
