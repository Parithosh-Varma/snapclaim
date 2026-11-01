import { strict as assert } from "node:assert";
import { test } from "node:test";
import { byokHeaders } from "../react/src/lib/api.ts";

function storageWith(value: string | null): void {
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: () => value,
    setItem: () => {},
    removeItem: () => {},
  } satisfies Pick<Storage, "getItem" | "setItem" | "removeItem"> as unknown as Storage;
  (globalThis as Record<string, unknown>).window = undefined;
}

function clearStorage(): void {
  delete (globalThis as Record<string, unknown>).localStorage;
}

test("byok headers are empty without a browser or stored keys", () => {
  clearStorage();
  assert.deepEqual(byokHeaders(), {});
  storageWith(null);
  assert.deepEqual(byokHeaders(), {});
  storageWith("not json{{{");
  assert.deepEqual(byokHeaders(), {});
  storageWith(JSON.stringify({ theme: "dark" }));
  assert.deepEqual(byokHeaders(), {});
});

test("byok headers carry stored keys, trimmed and length-capped", () => {
  storageWith(JSON.stringify({ metaKey: "  test-meta-123  ", basetenKey: "test-base-456", theme: "dark" }));
  assert.deepEqual(byokHeaders(), { "x-meta-key": "test-meta-123", "x-baseten-key": "test-base-456" });
  storageWith(JSON.stringify({ metaKey: 42, basetenKey: null }));
  assert.deepEqual(byokHeaders(), {});
  storageWith(JSON.stringify({ metaKey: "x".repeat(600) }));
  const h = byokHeaders();
  assert.equal(h["x-meta-key"]?.length, 512);
  clearStorage();
});

test("apiPost merges byok headers without touching the body", async () => {
  storageWith(JSON.stringify({ metaKey: "k-meta" }));
  let seen: Record<string, string> = {};
  let seenBody = "";
  (globalThis as Record<string, unknown>).fetch = (async (_url: unknown, init: { headers?: unknown; body?: unknown }) => {
    seen = { ...(init.headers as Record<string, string>) };
    seenBody = String(init.body ?? "");
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
  const { apiPost } = await import("../react/src/lib/api.ts");
  const out = await apiPost("https://snapclaim-backend.parithosh.workers.dev", "/v1/health", { a: 1 });
  assert.equal(out.res.status, 200);
  assert.equal(seen["x-meta-key"], "k-meta");
  assert.equal(seen["content-type"], "application/json");
  assert.equal(seenBody, JSON.stringify({ a: 1 }));
  delete (globalThis as Record<string, unknown>).fetch;
  clearStorage();
});
