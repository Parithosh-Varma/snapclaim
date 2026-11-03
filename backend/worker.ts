import { EXPENSIVE_ROUTE_PATHS, checkRouteRateLimit, corsHeadersFor, handleRequest, isOriginAllowed, securityHeaders } from "./app.ts";
import { D1Store, type D1Database } from "./store.ts";

export interface Env {
  DB?: D1Database;
  [key: string]: string | D1Database | undefined;
}

/** 1 MB cap mirrors backend/server.ts streaming cap. */
const MAX_BODY_BYTES = 1_000_000;

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export default {
  async fetch(request: Request, workerEnv: Env): Promise<Response> {
    const { DB, ...rest } = workerEnv;
    const env: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(rest)) if (typeof v === "string") env[k] = v;
    const origin = request.headers.get("origin");
    // Exact-match origin allowlist first: before rate limiting, spend holds,
    // body parsing or any provider call. No Origin (curl) is not blocked.
    const noAcao = {
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
      "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
      ...securityHeaders(),
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization, x-meta-key, x-baseten-key",
      vary: "Origin, x-meta-key, x-baseten-key",
    };
    if (origin !== null && origin !== "") {
      if (!isOriginAllowed(origin, env)) {
        return Response.json(
          { ok: false, error: "origin not allowed", code: "origin_not_allowed", requestId: "unknown" },
          { status: 403, headers: noAcao },
        );
      }
    } else if (env.REQUIRE_ORIGIN_FOR_EXPENSIVE === "1" && (EXPENSIVE_ROUTE_PATHS as readonly string[]).includes(new URL(request.url).pathname)) {
      return Response.json(
        { ok: false, error: "origin required", code: "origin_not_allowed", requestId: "unknown" },
        { status: 403, headers: noAcao },
      );
    }
    const headers = {
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
      "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
      ...securityHeaders(),
      ...corsHeadersFor(origin, env),
    };
    if (request.method === "OPTIONS") {
      if (origin !== null && origin !== "" && !isOriginAllowed(origin, env)) {
        return Response.json(
          { ok: false, error: "origin not allowed", code: "origin_not_allowed", requestId: "unknown" },
          { status: 403, headers: noAcao },
        );
      }
      return new Response(null, { status: 204, headers });
    }
    // cf-connecting-ip is set by Cloudflare's edge and cannot be spoofed by
    // the client; X-Forwarded-For can, so it is ignored for rate limiting.
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const url = new URL(request.url);
    const limit = checkRouteRateLimit(ip, request.method, url.pathname);
    if (!limit.ok) {
      return Response.json(
        { ok: false, error: `rate limited: retry in ${limit.retryAfterSec}s`, code: 429, requestId: "unknown" },
        { status: 429, headers: { ...headers, "retry-after": String(limit.retryAfterSec) } },
      );
    }
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return Response.json(
        { ok: false, error: "body too large (1MB cap)", code: 400, requestId: "unknown" },
        { status: 400, headers },
      );
    }
    let body: unknown;
    if (request.method === "POST") {
      // Stream the body through a reader and abort past the cap: request.text()
      // would buffer an arbitrarily large chunked / lied-content-length body
      // into memory before the length check below ever runs.
      let parseFailed = false;
      let tooLarge = false;
      const chunks: Uint8Array[] = [];
      let seen = 0;
      try {
        if (request.body !== null) {
          const reader = request.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            seen += value.byteLength;
            if (seen > MAX_BODY_BYTES) {
              tooLarge = true;
              await reader.cancel().catch(() => {});
              break;
            }
            chunks.push(value);
          }
        }
      } catch {
        parseFailed = true;
      }
      if (tooLarge) {
        return Response.json(
          { ok: false, error: "body too large (1MB cap)", code: 400, requestId: "unknown" },
          { status: 400, headers },
        );
      }
      if (parseFailed) {
        return Response.json(
          { ok: false, error: "invalid JSON", code: 400, requestId: "unknown" },
          { status: 400, headers },
        );
      }
      const text = chunks.length === 0 && seen === 0 && request.body === null
        ? ""
        : new TextDecoder().decode(concatBytes(chunks));
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
    const handled = await handleRequest({
      method: request.method,
      path: url.pathname,
      body,
      env,
      fetchFn,
      store: DB ? new D1Store(DB) : undefined,
      origin,
      headers: {
        authorization: request.headers.get("authorization") ?? undefined,
        "x-meta-key": request.headers.get("x-meta-key") ?? undefined,
        "x-baseten-key": request.headers.get("x-baseten-key") ?? undefined,
      },
    });
    return Response.json(handled.body as never, { status: handled.status, headers });
  },
};
