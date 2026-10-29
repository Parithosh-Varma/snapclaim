/**
 * Local R2 holder stand-in — same /put + /object protocol as
 * backend/r2-holder.ts, backed by the filesystem instead of R2.
 *
 * Run:  npm run r2:local [-- --port 8788 --dir .r2-data --key dev-secret]
 * Then: R2_PROXY_URL=http://localhost:8788 R2_PROXY_KEY=dev-secret npm run backend:start
 *
 * Fail-closed like the real holder: wrong/missing key -> 403, missing object
 * -> 404, bad keys/content-types -> 400. Files land in <dir>/<key> plus a
 * sibling <key>.meta.json holding the content type. Zero dependencies.
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { handleHolderRequest } from "./r2-holder.ts";
import { decodeBase64ToBytes, encodeBytesToBase64 } from "./r2-proxy.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

const PORT = Number(process.env.R2_LOCAL_PORT ?? arg("--port", "8788"));
const DIR = resolve(process.env.R2_LOCAL_DIR ?? arg("--dir", ".r2-data"));
const KEY = process.env.R2_PROXY_KEY ?? arg("--key", "dev-secret");

type StoredObject = {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
  size: number;
};

const fileBucket = {
  fileFor(key: string): string {
    if (key.includes("..")) throw new Error("traversal");
    return join(DIR, key);
  },
  async put(storeKey: string, data: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    const file = this.fileFor(storeKey);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
    writeFileSync(`${file}.meta.json`, JSON.stringify({ contentType: opts?.httpMetadata?.contentType ?? "application/octet-stream" }));
  },
  async get(storeKey: string): Promise<StoredObject | null> {
    const file = this.fileFor(storeKey);
    if (!existsSync(file)) return null;
    const bytes = new Uint8Array(readFileSync(file));
    let contentType = "application/octet-stream";
    try {
      const meta = JSON.parse(readFileSync(`${file}.meta.json`, "utf8")) as { contentType?: string };
      if (typeof meta.contentType === "string") contentType = meta.contentType;
    } catch { /* untracked file — keep default type */ }
    const copy = Uint8Array.from(bytes);
    return {
      httpMetadata: { contentType },
      size: copy.length,
      arrayBuffer: async () => copy.buffer as ArrayBuffer,
    };
  },
};

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
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export const r2LocalServer = createServer(async (req, res) => {
  const send = (status: number, value: unknown): void => {
    res.writeHead(status, { "content-type": "application/json", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify(value));
  };
  const url = new URL(req.url ?? "/", "http://localhost");
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, name) => {
    query[name] = value;
  });
  // Keep the holder honest about bytes: round-trip base64 through real
  // byte arrays via the shared helpers (imported so tree-shakers keep them).
  void decodeBase64ToBytes;
  void encodeBytesToBase64;
  let body: unknown;
  if (req.method === "POST") {
    try {
      body = await readJson(req);
    } catch (error) {
      send(400, { ok: false, error: error instanceof Error ? error.message : "invalid JSON", code: 400 });
      return;
    }
  }
  const handled = await handleHolderRequest({
    method: req.method ?? "GET",
    path: url.pathname,
    query,
    body,
    auth: typeof req.headers.authorization === "string" ? req.headers.authorization : null,
    env: { R2_PROXY_KEY: KEY, snapclaim_images: fileBucket },
  });
  send(handled.status, handled.body);
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(DIR, { recursive: true });
  r2LocalServer.listen(PORT, () => console.log(`r2 local holder :${PORT} dir=${DIR}`));
}
