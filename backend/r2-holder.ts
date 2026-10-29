import { HttpError } from "./providers.ts";
import {
  decodeBase64ToBytes,
  encodeBytesToBase64,
  validateR2ContentType,
  validateR2DataBase64,
  validateR2Key,
  type R2BucketLike,
} from "./r2-proxy.ts";

/**
 * R2 HOLDER worker — deploy this in the account that owns the bucket.
 *
 * Why a second worker: Cloudflare R2 bindings are same-account only, so the
 * main snapclaim-backend worker (account A) cannot bind a bucket that lives
 * in account B. This tiny worker lives in account B with a native binding
 * and exposes two authenticated endpoints the main backend forwards to
 * (see backend/r2-proxy.ts). Same split as the D1 cross-account fallback.
 *
 * Deploy (in the R2 account):
 *   1. Create the bucket: `npx wrangler r2 bucket create snapclaim-images`
 *   2. `cp backend/r2-holder-wrangler.toml wrangler.toml` (or merge it in)
 *   3. `npx wrangler secret put R2_PROXY_KEY`  (shared secret, Bearer auth)
 *   4. `npx wrangler deploy`
 *   5. In the MAIN backend account set secrets:
 *      `npx wrangler secret put R2_PROXY_KEY` (same value)
 *      `npx wrangler secret put R2_PROXY_URL` (e.g. https://snapclaim-r2-holder.<sub>.workers.dev)
 *
 * Local dev: run `npm run r2:local` (backend/r2-holder-server.ts) — same
 * /put + /object protocol backed by ./.r2-data, then set
 * R2_PROXY_URL=http://localhost:8788 in the main backend env.
 */

export type R2HolderEnv = {
  [key: string]: string | R2BucketLike | undefined;
  R2_PROXY_KEY?: string;
  snapclaim_images?: R2BucketLike;
};

function requireKey(env: R2HolderEnv, auth: string | null): void {
  const expected = env.R2_PROXY_KEY ?? "";
  if (!expected) throw new HttpError(503, "R2 holder not configured: set the R2_PROXY_KEY secret");
  if (auth !== `Bearer ${expected}`) throw new HttpError(403, "bad proxy key");
}

function requireBucket(env: R2HolderEnv): R2BucketLike {
  const bucket = env.snapclaim_images;
  if (!bucket || typeof bucket !== "object") {
    throw new HttpError(503, "R2 holder has no bucket: bind snapclaim_images in wrangler.toml");
  }
  return bucket as R2BucketLike;
}

export interface HolderPutBody {
  key: string;
  contentType: string;
  dataBase64: string;
  size: number;
}

export async function holderPut(body: unknown, env: R2HolderEnv): Promise<HolderPutBody> {
  if (typeof body !== "object" || body === null) throw new HttpError(400, "body must be a JSON object");
  const { key: rawKey, contentType: rawType, dataBase64: rawData } = body as Record<string, unknown>;
  const key = validateR2Key(rawKey);
  const contentType = validateR2ContentType(rawType);
  const dataBase64 = validateR2DataBase64(rawData);
  const bytes = decodeBase64ToBytes(dataBase64);
  await requireBucket(env).put(key, bytes, { httpMetadata: { contentType } });
  return { key, contentType, dataBase64, size: bytes.length };
}

export interface HolderGetResult {
  key: string;
  contentType: string;
  dataBase64: string;
  size: number;
}

export async function holderGet(keyRaw: unknown, env: R2HolderEnv): Promise<HolderGetResult> {
  const key = validateR2Key(keyRaw);
  const obj = await requireBucket(env).get(key);
  if (!obj) throw new HttpError(404, "object not found");
  const buf = new Uint8Array(await obj.arrayBuffer());
  return {
    key,
    contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
    dataBase64: encodeBytesToBase64(buf),
    size: obj.size,
  };
}

/** Pure router shared by the Worker entrypoint and the local file server. */
export async function handleHolderRequest(input: {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  auth: string | null;
  env: R2HolderEnv;
}): Promise<{ status: number; body: unknown }> {
  try {
    requireKey(input.env, input.auth);
    if (input.method === "POST" && input.path === "/put") {
      const stored = await holderPut(input.body, input.env);
      return { status: 200, body: { ok: true, result: { key: stored.key, size: stored.size } } };
    }
    if (input.method === "GET" && input.path === "/object") {
      const got = await holderGet(input.query?.["key"], input.env);
      return { status: 200, body: { ok: true, result: got } };
    }
    return { status: 404, body: { ok: false, error: "not found", code: 404 } };
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return { status, body: { ok: false, error: error instanceof Error ? error.message : "invalid request", code: status } };
  }
}

export default {
  async fetch(request: Request, env: R2HolderEnv): Promise<Response> {
    const url = new URL(request.url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, name) => {
      query[name] = value;
    });
    let body: unknown;
    if (request.method === "POST") {
      body = await request.json().catch(() => ({ __parseError: true }));
      if ((body as { __parseError?: boolean })?.__parseError) {
        return Response.json({ ok: false, error: "invalid JSON", code: 400 }, { status: 400 });
      }
    }
    const handled = await handleHolderRequest({
      method: request.method,
      path: url.pathname,
      query,
      body,
      auth: request.headers.get("authorization"),
      env,
    });
    return Response.json(handled.body, { status: handled.status });
  },
};
