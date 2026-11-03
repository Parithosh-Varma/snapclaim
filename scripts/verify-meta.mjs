#!/usr/bin/env node
// scripts/verify-meta.mjs — prove the Meta Model API integration end to end.
// Read-only: GET {META_API_BASE}/models with the Bearer key. No spend,
// no writes, no model calls. Exits 0 + JSON on success, non-zero + message
// on failure (missing key, unreachable host, bad key).
//
//   META_API_KEY=... node scripts/verify-meta.mjs [--live]
// Reads .env if present (same convention as `npm run backend:live`).
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env", ".env.local"]) {
  const p = resolve(root, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

const base = (process.env.META_API_BASE || "https://api.meta.ai/v1").replace(/\/+$/, "");
const apiKey = (process.env.META_API_KEY || "").trim();
if (!apiKey) {
  console.error("META_API_KEY is not set (checked env + .env). Refusing to call the API.");
  process.exit(2);
}

const live = process.argv.includes("--live");
const url = live ? `${base}/chat/completions` : `${base}/models`;
const init = live
  ? {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "muse-spark-1.3", max_tokens: 16, messages: [{ role: "user", content: "Reply with: ok" }] }),
    }
  : { method: "GET", headers: { authorization: `Bearer ${apiKey}` } };

let res;
try {
  res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
} catch (e) {
  console.error(`unreachable: ${e instanceof Error ? e.message : e}`);
  process.exit(3);
}
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(body && body.error && body.error.message) || "no detail"}`);
  process.exit(4);
}
console.log(JSON.stringify({ ok: true, mode: live ? "live-chat" : "models-list", base, models: Array.isArray(body.data) ? body.data.map((m) => m.id).slice(0, 20) : undefined, reply: body.choices?.[0]?.message?.content ?? undefined }));
