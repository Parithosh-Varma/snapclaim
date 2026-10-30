import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SpendGuard } from "../src/config/spend-guard.ts";
import { findingsProvider, skepticProvider, SPARK_OPEN_PRICE } from "../backend/providers.ts";
import { loadConfig } from "../src/config/config.ts";
import { handleRequest } from "../backend/app.ts";
import { resetSpendForTests, spendStatus } from "../backend/spend.ts";
import { measureSession } from "../src/engine/measure.ts";
import { citingDrafts, LIVE_ENV, loadWallFixture, modelFetch } from "./helpers.ts";

test("spend starts at zero", async () => {
  resetSpendForTests();
  const status = spendStatus({});
  assert.equal(status.spentUsd, 0);
  assert.ok(status.remainingUsd >= 0);

  const res = await handleRequest({ method: "GET", path: "/v1/spend", env: {} });
  assert.equal(res.status, 200);
  assert.equal((res.body as { spentUsd: number }).spentUsd, 0);
});

test("live findings record token usage at conservative Spark pricing", async () => {
  resetSpendForTests();
  const config = loadConfig({ MOCK_MODE: "0", SPEND_GUARD_USD: "10" });
  const guard = new SpendGuard(10);
  const stubFetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "[]" } }],
        usage: { prompt_tokens: 120, completion_tokens: 40 },
      }),
    }) as unknown as Response) as typeof fetch;

  const provider = findingsProvider({ META_API_KEY: "test" }, config, stubFetch, guard);
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  const drafts = await provider.draftFindings({ transcript: "t", findings: session.findings, receipts: session.receipts });
  assert.deepEqual(drafts, []);
  // 120 prompt + 40 completion at 1.25 / 4.25 per MTok = 0.00032 (was $0: spend-guard bypass).
  assert.equal(guard.spentUsd, 0.00032);
  assert.ok(guard.entries[0]?.label.includes("in=120 out=40"));
});

test("skeptic charges real Baseten pricing from usage", async () => {
  const config = loadConfig({ MOCK_MODE: "0", SPEND_GUARD_USD: "10", BASETEN_API_KEY: "test" });
  const guard = new SpendGuard(10);
  const stubFetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "[]" } }],
        usage: { prompt_tokens: 1000, output_tokens: 0, completion_tokens: 500 },
      }),
    }) as unknown as Response) as typeof fetch;

  const provider = skepticProvider({ BASETEN_API_KEY: "test" }, config, stubFetch, guard);
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  await provider.draftFindings({ transcript: "t", findings: session.findings, receipts: session.receipts });
  // 1000 prompt + 500 completion at 1.25 / 4.25 per MTok = 0.003375
  assert.equal(guard.spentUsd, 0.003375);
  assert.equal(SPARK_OPEN_PRICE.inputUsdPerMTok, 1.25);
});

test("skeptic without a key fails closed with 503", async () => {
  const config = loadConfig({ MOCK_MODE: "0", SPEND_GUARD_USD: "10" });
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  const res = await handleRequest({
    method: "POST",
    path: "/v1/skeptic",
    body: { component: fixture.component, masks: fixture.masks, scaleReference: fixture.scaleReference, transcript: "x", findings: session.findings, receipts: session.receipts },
    env: { MOCK_MODE: "0", META_API_KEY: "test" },
  });
  assert.equal(res.status, 503);
  void config;
});

test("skeptic without measurement inputs is rejected with 422", async () => {
  const res = await handleRequest({
    method: "POST",
    path: "/v1/skeptic",
    body: { transcript: "x", findings: [], receipts: [] },
    env: { MOCK_MODE: "0", META_API_KEY: "test", BASETEN_API_KEY: "test" },
  });
  assert.equal(res.status, 422);
});

test("skeptic returns gated drafts from the live provider", async () => {
  resetSpendForTests();
  const p = {
    component: loadWallFixture().component,
    masks: loadWallFixture().masks,
    scaleReference: loadWallFixture().scaleReference,
    transcript: "t",
  };
  const measured = await handleRequest({ method: "POST", path: "/v1/measure", body: p, env: {} });
  const result = (measured.body as { result: { findings: unknown[]; receipts: unknown[] } }).result;
  const res = await handleRequest({
    method: "POST",
    path: "/v1/skeptic",
    body: { ...p, transcript: "t", findings: result.findings, receipts: result.receipts },
    env: LIVE_ENV,
    fetchFn: modelFetch(citingDrafts(result.findings as Parameters<typeof citingDrafts>[0])),
  });
  assert.equal(res.status, 200);
});

test("live findings fail closed at $0 remaining with 429", async () => {
  const config = loadConfig({ MOCK_MODE: "0", SPEND_GUARD_USD: "0" });
  // Limit 0 means no spend allowed: remaining starts at 0, pre-check must trip before any fetch.
  const guard = new SpendGuard(0);
  const stubFetch = (() => {
    throw new Error("must not call live");
  }) as unknown as typeof fetch;
  const provider = findingsProvider({ META_API_KEY: "test" }, config, stubFetch, guard);
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  await assert.rejects(
    provider.draftFindings({ transcript: "t", findings: session.findings, receipts: session.receipts }),
    (error: unknown) => {
      assert.ok(error instanceof Error && /spend guard/.test(error.message));
      assert.equal((error as { status?: number }).status, 429);
      return true;
    },
  );
});
