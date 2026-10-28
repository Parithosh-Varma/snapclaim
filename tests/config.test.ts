import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_CONFIG, loadConfig } from "../src/config/config.ts";
import { BudgetExceededError, SpendGuard, estimateCostUsd } from "../src/config/spend-guard.ts";

test("spend guard charges within the limit and reports the remainder", () => {
  const guard = new SpendGuard(1);
  guard.charge("spark findings", 0.25);
  assert.equal(guard.spentUsd, 0.25);
  assert.equal(guard.remainingUsd, 0.75);
  assert.equal(guard.entries.length, 1);
  assert.equal(guard.entries[0]?.label, "spark findings");
});

test("spend guard refuses to cross the limit", () => {
  const guard = new SpendGuard(1);
  guard.charge("first", 0.4);
  assert.throws(() => guard.charge("second", 0.8), BudgetExceededError);
  assert.equal(guard.spentUsd, 0.4);
  assert.equal(guard.entries.length, 1);
});

test("spend guard rejects negative charges", () => {
  const guard = new SpendGuard(1);
  assert.throws(() => guard.charge("bad", -0.01));
  assert.throws(() => new SpendGuard(-1));
});

test("token cost estimate is deterministic", () => {
  const cost = estimateCostUsd(
    { inputTokens: 1000, outputTokens: 500 },
    { inputUsdPerMTok: 0.5, outputUsdPerMTok: 1.5 },
  );
  assert.equal(cost, 0.00125);
});

test("config defaults to mock mode and the exact open-weights model id", () => {
  const config = loadConfig({});
  assert.equal(config.mockMode, true);
  assert.equal(loadConfig({ MOCK_MODE: "0" }).mockMode, false);
  assert.equal(loadConfig({ MOCK_MODE: "1" }).mockMode, true);
  assert.equal(config.spendLimitUsd, 5);
  assert.equal(config.models.sparkOpen, "meta-models/muse-spark-open");
  assert.equal(config.models.spark, "muse-spark-1.3");
  assert.equal(config.minReferenceConfidence, DEFAULT_CONFIG.minReferenceConfidence);
});

test("spend limits are validated", () => {
  const config = loadConfig({ SPEND_GUARD_USD: "2.5", MIN_REFERENCE_CONFIDENCE: "0.8" });
  assert.equal(config.spendLimitUsd, 2.5);
  assert.equal(config.minReferenceConfidence, 0.8);

  assert.throws(() => loadConfig({ SPEND_GUARD_USD: "nope" }));
  assert.throws(() => loadConfig({ MIN_REFERENCE_CONFIDENCE: "1.5" }));
});
