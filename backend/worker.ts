import { corsHeadersFor, handleRequest } from "./app.ts";
import { D1Store, type D1Database } from "./store.ts";

export interface Env {
  DB?: D1Database;
  [key: string]: string | D1Database | undefined;
}

export default {
  async fetch(request: Request, workerEnv: Env): Promise<Response> {
    const { DB, ...rest } = workerEnv;
    const env: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(rest)) if (typeof v === "string") env[k] = v;
    const headers = { "content-type": "application/json", ...corsHeadersFor(request.headers.get("origin"), env) };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > 1_000_000) {
      return Response.json(
        { ok: false, error: "body too large (1MB cap)", code: 400, requestId: "unknown" },
        { status: 400, headers },
      );
    }
    let body: unknown;
    if (request.method === "POST") {
      body = await request.json().catch(() => {
        throw new Error("invalid JSON");
      }).catch((error: Error) => ({ __parseError: error.message }));
      if ((body as { __parseError?: string })?.__parseError) {
        return Response.json(
          { ok: false, error: "invalid JSON", code: 400, requestId: "unknown" },
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
