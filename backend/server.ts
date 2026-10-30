import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { corsHeadersFor, handleRequest } from "./app.ts";

const PORT = Number(process.env.PORT ?? 8787);

function sendJson(res: import("node:http").ServerResponse, status: number, value: unknown, origin: string | null): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
    ...corsHeadersFor(origin, process.env),
  });
  res.end(JSON.stringify(value));
}

function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Don't destroy the socket: keep draining so we can answer with a
      // proper 400 instead of hanging up (which the PWA reports only as
      // "backend unreachable"). Oversized bodies are rejected at the end.
      if (size > 1_000_000) oversized = true;
      if (!oversized) chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        if (oversized) {
          reject(new Error("body too large (1MB cap)"));
          return;
        }
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
  let body: unknown;
  if (req.method === "POST") {
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "invalid JSON", code: 400, requestId: "unknown" }, origin);
      return;
    }
  }
  const handled = await handleRequest({ method: req.method ?? "GET", path, body, env: process.env });
  sendJson(res, handled.status, handled.body, origin);
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, () => console.log(`snapclaim backend :${PORT}`));
}
