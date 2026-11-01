import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { checkRouteRateLimit, corsHeadersFor, handleRequest, securityHeaders } from "./app.ts";

const PORT = Number(process.env.PORT ?? 8787);

function clientIp(req: import("node:http").IncomingMessage): string {
  // Never trust X-Forwarded-For from the open internet: anyone can send
  // `X-Forwarded-For: <random>` per request and get a fresh rate-limit
  // bucket each time. The direct socket address is the only unspoofable key
  // (run behind a proxy that overwrites XFF if you need the real client IP).
  return req.socket.remoteAddress ?? "unknown";
}

function sendJson(res: import("node:http").ServerResponse, status: number, value: unknown, origin: string | null, retryAfterSec?: number): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
    ...securityHeaders(),
    ...(retryAfterSec !== undefined ? { "retry-after": String(retryAfterSec) } : {}),
    ...corsHeadersFor(origin, process.env),
  });
  res.end(JSON.stringify(value));
}

function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("body too large (1MB cap)"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export const server = createServer(async (req, res) => {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : null;
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeadersFor(origin, process.env));
    res.end();
    return;
  }
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  // Tiered per-IP per-route limit before touching the body: anonymous
  // billable routes drain spend/CPU at 1 MB POSTs, so they get 20/min while
  // cheap deterministic routes stay at 120/min.
  const limit = checkRouteRateLimit(clientIp(req), req.method ?? "GET", path);
  if (!limit.ok) {
    sendJson(res, 429, { ok: false, error: `rate limited: retry in ${limit.retryAfterSec}s`, code: 429, requestId: "unknown" }, origin, limit.retryAfterSec);
    try { req.destroy(); } catch { /* noop */ }
    return;
  }
  let body: unknown;
  if (req.method === "POST") {
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "invalid JSON", code: 400, requestId: "unknown" }, origin);
      return;
    }
  }
  const fetchFn: typeof fetch = (url, init) => fetch(url, init);
  const header = (name: string): string | undefined => {
    const v = req.headers[name];
    return typeof v === "string" ? v : undefined;
  };
  const handled = await handleRequest({
    method: req.method ?? "GET",
    path,
    body,
    env: process.env,
    fetchFn,
    headers: {
      authorization: header("authorization"),
      "x-meta-key": header("x-meta-key"),
      "x-baseten-key": header("x-baseten-key"),
    },
  });
  sendJson(res, handled.status, handled.body, origin);
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, () => console.log(`snapclaim backend :${PORT}`));
}
