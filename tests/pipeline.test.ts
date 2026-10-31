import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findingsProvider, skepticProvider } from "../backend/providers.ts";
import { loadConfig } from "../src/config/config.ts";
import { EvidenceError, gateFindings } from "../src/findings/evidence-gate.ts";
import { citingDrafts, LIVE_ENV, modelFetch, wallSession } from "./helpers.ts";

test("pipeline: masks in, live findings provider out, evidence gate passes", async () => {
  const session = wallSession();
  const provider = findingsProvider(LIVE_ENV, loadConfig(LIVE_ENV), modelFetch(citingDrafts(session.findings)));
  const drafts = await provider.draftFindings({
    transcript: "wall crack near the window, coin for scale",
    findings: session.findings,
    receipts: session.receipts,
  });

  assert.equal(drafts.length, 2);
  assert.ok(drafts[0]?.statement.includes("5.17%"));
  assert.ok(drafts[0]?.statement.includes("85.9 mm"));

  assert.doesNotThrow(() => gateFindings(drafts, session.receipts));
  assert.equal(session.receipts.length, 11);
});

test("model prompts forbid scale-factor and count numbers", async () => {
  // Regression: the skeptic cited 0.637119 (mm_per_px) and bare 1s (region
  // counts) — units the gate can never verify — so every check failed 422.
  // Both live prompts must teach the model that only percent/mm/cm2 verify.
  const seen: string[] = [];
  const capture: typeof fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    seen.push(String((init as { body?: unknown })?.body ?? ""));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "[]" } }], usage: {} }),
    } as unknown as Response;
  }) as typeof fetch;
  const session = wallSession();
  await findingsProvider(LIVE_ENV, loadConfig(LIVE_ENV), capture).draftFindings({
    transcript: "t",
    findings: session.findings,
    receipts: session.receipts,
  });
  await skepticProvider(LIVE_ENV, loadConfig(LIVE_ENV), capture).draftFindings({
    transcript: "t",
    findings: session.findings,
    receipts: session.receipts,
  });
  const prompt = seen.join(" ");
  assert.ok(prompt.includes("mm_per_px"), "prompts name the forbidden scale unit");
  assert.ok(prompt.includes("region counts"), "prompts name the forbidden count numbers");
});

test("the pipeline can fail: a model that alters numbers is caught before shipping", async () => {
  const session = wallSession();
  const lying = citingDrafts(session.findings);
  const first = lying[0];
  assert.ok(first);
  first.statement = first.statement.replace("5.17", "7.77");

  const provider = findingsProvider(LIVE_ENV, loadConfig(LIVE_ENV), modelFetch(lying));
  const drafts = await provider.draftFindings({ transcript: "test", findings: session.findings, receipts: session.receipts });

  assert.throws(() => gateFindings(drafts, session.receipts), EvidenceError);
});
