import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleRequest } from "../backend/app.ts";
import { resetAdminForTests } from "../backend/admin.ts";
import { resetSpendForTests } from "../backend/spend.ts";
import { LIVE_ENV } from "./helpers.ts";

const ADMIN_ENV = { ...LIVE_ENV, ADMIN_TOKEN: "dev-secret" };

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

test("admin status is public, key-free, and reflects the env mode", async () => {
  resetAdminForTests();
  try {
    const res = await handleRequest({ method: "GET", path: "/v1/admin/status", env: {} });
    assert.equal(res.status, 200);
    const result = (res.body as { result: Record<string, unknown> }).result;
    assert.equal(result["mockMode"], true);
    assert.equal(result["mockSource"], "env");
    assert.equal(result["mode"], "mock");
    assert.equal(result["adminEnabled"], false);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("test"), "no keys leak into admin status");
    assert.ok(!serialized.includes("ADMIN_TOKEN"));

    const live = await handleRequest({ method: "GET", path: "/v1/admin/status", env: LIVE_ENV });
    const liveResult = (live.body as { result: Record<string, unknown> }).result;
    assert.equal(liveResult["mockMode"], false);
    assert.equal(liveResult["mode"], "live");
  } finally {
    resetAdminForTests();
  }
});

test("admin mode switch is disabled without ADMIN_TOKEN", async () => {
  resetAdminForTests();
  try {
    const res = await handleRequest({
      method: "POST",
      path: "/v1/admin/mode",
      body: { mockMode: true },
      env: {},
      headers: auth("anything"),
    });
    assert.equal(res.status, 403);
    assert.match((res.body as { error: string }).error, /disabled/);
  } finally {
    resetAdminForTests();
  }
});

test("admin mode switch requires a valid bearer token", async () => {
  resetAdminForTests();
  try {
    const missing = await handleRequest({
      method: "POST",
      path: "/v1/admin/mode",
      body: { mockMode: true },
      env: ADMIN_ENV,
    });
    assert.equal(missing.status, 401);

    const wrong = await handleRequest({
      method: "POST",
      path: "/v1/admin/mode",
      body: { mockMode: true },
      env: ADMIN_ENV,
      headers: auth("wrong"),
    });
    assert.equal(wrong.status, 403);
  } finally {
    resetAdminForTests();
  }
});

test("admin mode switch flips health mode at runtime and resets to env", async () => {
  resetAdminForTests();
  resetSpendForTests();
  try {
    // LIVE_ENV starts live; flip to mock without restarting.
    const flipped = await handleRequest({
      method: "POST",
      path: "/v1/admin/mode",
      body: { mode: "mock" },
      env: ADMIN_ENV,
      headers: auth("dev-secret"),
    });
    assert.equal(flipped.status, 200);
    const flippedResult = (flipped.body as { result: Record<string, unknown> }).result;
    assert.equal(flippedResult["mockMode"], true);
    assert.equal(flippedResult["mockSource"], "override");

    const health = await handleRequest({ method: "GET", path: "/v1/health", env: ADMIN_ENV });
    assert.equal((health.body as { mode: string }).mode, "mock");

    const status = await handleRequest({ method: "GET", path: "/v1/admin/status", env: ADMIN_ENV });
    assert.equal((status.body as { result: Record<string, unknown> }).result["mockSource"], "override");

    // Reset returns to the env default (live).
    const reset = await handleRequest({
      method: "POST",
      path: "/v1/admin/mode",
      body: { reset: true },
      env: ADMIN_ENV,
      headers: auth("dev-secret"),
    });
    assert.equal(reset.status, 200);
    assert.equal((reset.body as { result: Record<string, unknown> }).result["mockSource"], "env");
    const backToLive = await handleRequest({ method: "GET", path: "/v1/health", env: ADMIN_ENV });
    assert.equal((backToLive.body as { mode: string }).mode, "live");
  } finally {
    resetAdminForTests();
    resetSpendForTests();
  }
});

test("admin mode switch rejects malformed bodies", async () => {
  resetAdminForTests();
  try {
    for (const body of [{}, { mockMode: "yes" }, { mode: "staging" }, [], null]) {
      const res = await handleRequest({
        method: "POST",
        path: "/v1/admin/mode",
        body,
        env: ADMIN_ENV,
        headers: auth("dev-secret"),
      });
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    }
  } finally {
    resetAdminForTests();
  }
});
