import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { checkRateLimit, corsHeadersFor, handleRequest } from "./app.ts";

const PORT = Number(process.env.PORT ?? 8787);

function clientIp(req: import("node:http").IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : (forwarded ?? "").split(",")[0]?.trim();
  return first !== "" ? String(first) : (req.socket.remoteAddress ?? "unknown");
}

function sendJson(res: import("node:http").ServerResponse, status: number, value: unknown, origin: string | null, retryAfterSec?: number): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
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
  // Per-IP rate limit before touching the body: anonymous billable routes
  // would otherwise let one client loop 1 MB POSTs and drain quota / CPU.
  const limit = checkRateLimit(`node:${clientIp(req)}`);
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
  const auth = req.headers.authorization;
  const handled = await handleRequest({
    method: req.method ?? "GET",
    path,
    body,
    env: process.env,
    fetchFn,
    headers: typeof auth === "string" ? { authorization: auth } : {},
  });
  sendJson(res, handled.status, handled.body, origin);
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, () => console.log(`snapclaim backend :${PORT}`));
}
