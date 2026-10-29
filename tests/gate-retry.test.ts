import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleRequest, MAX_DRAFT_ATTEMPTS } from "../backend/app.ts";
import type { FindingDraft } from "../src/findings/evidence-gate.ts";
import { citingDrafts, LIVE_ENV, loadWallFixture, wallSession } from "./helpers.ts";

const payload = () => {
  const f = loadWallFixture();
  return {
    component: f.component,
    masks: f.masks,
    scaleReference: f.scaleReference,
    transcript: "wall crack near the window, coin for scale",
  };
};

/** Non-compliant model output, like the live failures: extra numbers, no citations. */
const badDrafts = (): FindingDraft[] => [
  { statement: "The crack covers 99% of the wall and is about 10m long with 7 regions.", citations: [] },
  { statement: "Stain looks moderate, roughly 3cm wide.", citations: [] },
];

/** Serves one reply per call and records every request body. */
function scriptedFetch(replies: FindingDraft[][], seen: unknown[]) {
  let calls = 0;
  const fetchFn = (async (url: unknown, init?: { body?: unknown }) => {
    calls++;
    seen.push(JSON.parse(String((init as { body: string }).body)));
    const drafts = replies[Math.min(calls - 1, replies.length - 1)];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(drafts) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as unknown as Response;
  }) as typeof fetch;
  return { fetchFn, calls: () => calls };
}

test("report retries a failing draft and passes on the repaired retry", async () => {
  const seen: unknown[] = [];
  const good = citingDrafts(wallSession().findings);
  const { fetchFn, calls } = scriptedFetch([badDrafts(), good], seen);
  const res = await handleRequest({ method: "POST", path: "/v1/report", body: payload(), env: LIVE_ENV, fetchFn });
  assert.equal(res.status, 200);
  const body = res.body as { result: { gate: { ok: boolean } } };
  assert.equal(body.result.gate.ok, true);
  assert.equal(calls(), 2);
  // The retry carries the previous gate failures so the model repairs instead of guessing again.
  const retry = seen[1]! as { messages: Array<{ content: string }> };
  assert.ok(retry.messages.length > 2, "retry appends a feedback turn");
  assert.match(retry.messages[retry.messages.length - 1]!.content, /evidence gate/i);
});

test("report fails closed after exhausting retries", async () => {
  const seen: unknown[] = [];
  const { fetchFn, calls } = scriptedFetch([badDrafts()], seen);
  const res = await handleRequest({ method: "POST", path: "/v1/report", body: payload(), env: LIVE_ENV, fetchFn });
  assert.equal(res.status, 422);
  assert.equal(calls(), MAX_DRAFT_ATTEMPTS);
  const body = res.body as { ok: boolean; details: string[] };
  assert.ok(body.details.length > 0);
});

test("findings requests are deterministic and tightly prompted", async () => {
  const seen: unknown[] = [];
  const good = citingDrafts(wallSession().findings);
  const { fetchFn } = scriptedFetch([good], seen);
  const res = await handleRequest({ method: "POST", path: "/v1/report", body: payload(), env: LIVE_ENV, fetchFn });
  assert.equal(res.status, 200);
  const first = seen[0]! as { temperature: number; messages: Array<{ role: string; content: string }> };
  assert.equal(first.temperature, 0);
  assert.match(first.messages[0]!.content, /EXACTLY one draft per fact/);
});

test("caller-supplied drafts never trigger a model retry", async () => {
  const seen: unknown[] = [];
  const { fetchFn, calls } = scriptedFetch([badDrafts()], seen);
  const res = await handleRequest({
    method: "POST",
    path: "/v1/report",
    body: { ...payload(), drafts: badDrafts() },
    env: LIVE_ENV,
    fetchFn,
  });
  assert.equal(res.status, 422);
  assert.equal(calls(), 0);
});
