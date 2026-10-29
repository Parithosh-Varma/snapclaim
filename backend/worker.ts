import { corsHeaders, handleRequest } from "./app.ts";

export interface Env {
  [key: string]: string | undefined;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = { "content-type": "application/json", ...corsHeaders() };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
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
    const handled = await handleRequest({ method: request.method, path: url.pathname, body, env, fetchFn });
    return Response.json(handled.body as never, { status: handled.status, headers });
  },
};
