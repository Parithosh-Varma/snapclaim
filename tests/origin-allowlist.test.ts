import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  corsHeadersFor,
  getAllowedOrigins,
  handleRequest,
  isOriginAllowed,
  normalizeAllowedOrigin,
} from "../backend/app.ts";
import worker from "../backend/worker.ts";

const live = { MOCK_MODE: "0" } as never;

test("normalises entries and ignores paths/wildcards", () => {
  assert.equal(normalizeAllowedOrigin("https://snapclaim.pages.dev/"), "https://snapclaim.pages.dev");
  assert.equal(normalizeAllowedOrigin("HTTPS://SNAPCLAIM.PAGES.DEV"), "https://snapclaim.pages.dev");
  assert.equal(normalizeAllowedOrigin("  http://localhost:8787  "), "http://localhost:8787");
  assert.equal(normalizeAllowedOrigin("https://example.com/path"), null);
  assert.equal(normalizeAllowedOrigin("https://*.example.com"), null);
  assert.equal(normalizeAllowedOrigin("https://example.com?x=1"), null);
  assert.equal(normalizeAllowedOrigin("not a url"), null);
  const env = {
    ALLOWED_ORIGINS: "https://snapclaim.pages.dev/, https://example.com/path, https://*.evil.com, not-a-url",
  } as never;
  assert.deepEqual(getAllowedOrigins(env), ["https://snapclaim.pages.dev"]);
});

test("default list applies when unset in live mode", () => {
  assert.deepEqual(getAllowedOrigins(live), [
    "https://snapclaim.pages.dev",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  assert.equal(isOriginAllowed("https://snapclaim.pages.dev", live), true);
  assert.equal(isOriginAllowed("http://localhost:8787", live), true);
  assert.equal(isOriginAllowed("https://anything.test", live), false);
});

test("exact match passes, look-alikes fail", () => {
  const env = { ALLOWED_ORIGINS: "https://snapclaim.pages.dev" } as never;
  assert.equal(isOriginAllowed("https://snapclaim.pages.dev", env), true);
  assert.equal(corsHeadersFor("https://snapclaim.pages.dev", env)["access-control-allow-origin"], "https://snapclaim.pages.dev");
  for (const evil of [
    "https://snapclaim.pages.dev.evil.com",
    "https://evil-snapclaim.pages.dev",
    "http://snapclaim.pages.dev",
    "https://snapclaim.pages.dev:8443",
  ]) {
    assert.equal(isOriginAllowed(evil, env), false, evil);
    assert.equal(corsHeadersFor(evil, env)["access-control-allow-origin"], undefined, evil);
  }
  // Trailing slash and case are normalised, not treated as different origins.
  assert.equal(isOriginAllowed("https://snapclaim.pages.dev/", env), true);
  assert.equal(isOriginAllowed("HTTPS://SNAPCLAIM.PAGES.DEV", env), true);
  assert.equal(corsHeadersFor("https://snapclaim.pages.dev/", env)["access-control-allow-origin"], "https://snapclaim.pages.dev");
});

test("CORS echoes only the exact match and keeps Vary + BYOK headers", () => {
  const env = { ALLOWED_ORIGINS: "https://a.example, https://snapclaim.pages.dev" } as never;
  const h = corsHeadersFor("https://snapclaim.pages.dev", env);
  assert.equal(h["access-control-allow-origin"], "https://snapclaim.pages.dev");
  assert.equal(h.vary, "Origin, x-meta-key, x-baseten-key");
  assert.ok((h["access-control-allow-headers"] ?? "").includes("x-meta-key"));
  assert.ok((h["access-control-allow-headers"] ?? "").includes("x-baseten-key"));
  const miss = corsHeadersFor("https://evil.example", env);
  assert.equal(miss["access-control-allow-origin"], undefined);
  assert.equal(miss.vary, "Origin, x-meta-key, x-baseten-key");
});

test("disallowed origin gets 403 before any provider call (cheap, expensive, preflight)", async () => {
  let fetched = 0;
  const boom: typeof fetch = (async () => {
    fetched++;
    throw new Error("provider must not be called");
  }) as never;
  const env = { MOCK_MODE: "0", ALLOWED_ORIGINS: "https://snapclaim.pages.dev" } as never;
  const cheap = await handleRequest({
    method: "GET",
    path: "/v1/health",
    env,
    origin: "https://evil.example",
    fetchFn: boom,
  });
  assert.equal(cheap.status, 403);
  assert.equal((cheap.body as { code?: unknown }).code, "origin_not_allowed");
  const expensive = await handleRequest({
    method: "POST",
    path: "/v1/report",
    body: {},
    env,
    origin: "https://evil.example",
    fetchFn: boom,
  });
  assert.equal(expensive.status, 403);
  assert.equal((expensive.body as { code?: unknown }).code, "origin_not_allowed");
  assert.equal(fetched, 0, "no provider fetch on disallowed origins");
  const pre = await worker.fetch(
    new Request("https://x/v1/health", { method: "OPTIONS", headers: { origin: "https://evil.example" } }),
    { ALLOWED_ORIGINS: "https://snapclaim.pages.dev" },
  );
  assert.equal(pre.status, 403);
  assert.equal(pre.headers.get("access-control-allow-origin"), null);
});

test("no-Origin requests work; REQUIRE_ORIGIN_FOR_EXPENSIVE opts into blocking them", async () => {
  const env = { MOCK_MODE: "0", ALLOWED_ORIGINS: "https://snapclaim.pages.dev" } as unknown as Record<string, string>;
  const ok = await handleRequest({ method: "GET", path: "/v1/health", env: env as never, origin: null });
  assert.equal(ok.status, 200);
  const noOpt = await handleRequest({
    method: "POST",
    path: "/v1/report",
    body: {},
    env: env as never,
    origin: null,
    fetchFn: (async () => new Response(JSON.stringify({}), { status: 500 })) as never,
  });
  assert.notEqual(noOpt.status, 403, "no-Origin expensive allowed by default");
  const strict = { ...env, REQUIRE_ORIGIN_FOR_EXPENSIVE: "1" } as never;
  const blocked = await handleRequest({ method: "POST", path: "/v1/report", body: {}, env: strict, origin: null });
  assert.equal(blocked.status, 403);
  assert.equal((blocked.body as { code?: unknown }).code, "origin_not_allowed");
  const cheapStillOk = await handleRequest({ method: "GET", path: "/v1/health", env: strict, origin: null });
  assert.equal(cheapStillOk.status, 200);
});
