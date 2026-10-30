import { checkRateLimit, corsHeadersFor, handleRequest } from "./app.ts";
import { D1Store, type D1Database } from "./store.ts";

export interface Env {
  DB?: D1Database;
  [key: string]: string | D1Database | undefined;
}

/** 1 MB cap mirrors backend/server.ts streaming cap. */
const MAX_BODY_BYTES = 1_000_000;

export default {
  async fetch(request: Request, workerEnv: Env): Promise<Response> {
    const { DB, ...rest } = workerEnv;
    const env: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(rest)) if (typeof v === "string") env[k] = v;
    const headers = { "content-type": "application/json", ...corsHeadersFor(request.headers.get("origin"), env) };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    // Per-IP rate limit (per-isolate; see app.ts notes).
    const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const limit = checkRateLimit(`worker:${ip}`);
    if (!limit.ok) {
      return Response.json(
        { ok: false, error: `rate limited: retry in ${limit.retryAfterSec}s`, code: 429, requestId: "unknown" },
        { status: 429, headers: { ...headers, "retry-after": String(limit.retryAfterSec) } },
      );
    }
    const url = new URL(request.url);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return Response.json(
        { ok: false, error: "body too large (1MB cap)", code: 400, requestId: "unknown" },
        { status: 400, headers },
      );
    }
    let body: unknown;
    if (request.method === "POST") {
      // No __parseError sentinel: a legitimate body could contain that key.
      // Use an out-of-band flag instead, then enforce the post-parse size cap
      // (chunked / lied content-length would otherwise bypass the early check).
      let parseFailed = false;
      const text = await request.text().catch(() => {
        parseFailed = true;
        return "";
      });
      if (parseFailed) {
        return Response.json(
          { ok: false, error: "invalid JSON", code: 400, requestId: "unknown" },
          { status: 400, headers },
        );
      }
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
        return Response.json(
          { ok: false, error: "body too large (1MB cap)", code: 400, requestId: "unknown" },
          { status: 400, headers },
        );
      }
      try {
        body = text === "" ? {} : JSON.parse(text);
      } catch {
        return Response.json(
          { ok: false, error: "invalid JSON", code: 400, requestId: "unknown" },
          { status: 400, headers },
        );
      }
      if (new TextEncoder().encode(JSON.stringify(body)).length > MAX_BODY_BYTES) {
        return Response.json(
          { ok: false, error: "body too large (1MB cap)", code: 400, requestId: "unknown" },
          { status: 400, headers },
        );
      }
    }
    // Bound wrapper: a bare global fetch loses its `this` on Workers (illegal invocation).
    const fetchFn: typeof fetch = (url, init) => fetch(url, init);
    const handled = await handleRequest({ method: request.method, path: url.pathname, body, env, fetchFn, store: DB ? new D1Store(DB) : undefined });
    return Response.json(handled.body as never, { status: handled.status, headers });
  },
};
