import { strict as assert } from "node:assert";
import { test } from "node:test";
import { corsHeadersFor, handleRequest } from "../backend/app.ts";
import worker from "../backend/worker.ts";

test("CORS is open by default for local development", () => {
  assert.equal(corsHeadersFor(null, {} as never)["access-control-allow-origin"], "*");
  assert.equal(corsHeadersFor("https://anything.test", {} as never)["access-control-allow-origin"], "*");
});

test("ALLOWED_ORIGINS echoes the caller and blocks others", () => {
  const env = { ALLOWED_ORIGINS: "https://app.example, https://pages.example" } as never;
  assert.equal(corsHeadersFor("https://app.example", env)["access-control-allow-origin"], "https://app.example");
  assert.equal(corsHeadersFor("https://evil.test", env)["access-control-allow-origin"], "https://app.example");
  assert.equal(corsHeadersFor(null, env)["access-control-allow-origin"], "https://app.example");
});

test("worker preflight carries the allowlisted origin", async () => {
  const res = await worker.fetch(
    new Request("https://x/v1/health", { method: "OPTIONS", headers: { origin: "https://app.example" } }),
    { ALLOWED_ORIGINS: "https://app.example" },
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://app.example");
});

test("crosscheck refuses garbage RLE and bad thresholds", async () => {
  const garbage = await handleRequest({
    method: "POST",
    path: "/v1/crosscheck",
    body: { a: { size: [2, 2], counts: [1, 1] }, b: { size: [2, 2], counts: "nope" } },
    env: {},
  });
  assert.ok([400, 422].includes(garbage.status));
  const badThreshold = await handleRequest({
    method: "POST",
    path: "/v1/crosscheck",
    body: {
      a: { size: [1, 1], counts: [0, 1] },
      b: { size: [1, 1], counts: [0, 1] },
      threshold: 2,
    },
    env: {},
  });
  assert.equal(badThreshold.status, 400);
});
