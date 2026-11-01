import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleRequest } from "../backend/app.ts";
import { citingDrafts, loadWallFixture, modelFetch, wallSession } from "./helpers.ts";

const payload = () => {
  const f = loadWallFixture();
  return { component: f.component, masks: f.masks, scaleReference: f.scaleReference, transcript: "wall crack, coin for scale" };
};

/** modelFetch that also records the bearer token each call went out with. */
function recordingFetch(): { fetchFn: typeof fetch; tokens: string[] } {
  const inner = modelFetch(citingDrafts(wallSession().findings));
  const tokens: string[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    tokens.push(headers.authorization ?? "");
    return inner(url, init);
  }) as typeof fetch;
  return { fetchFn, tokens };
}

test("byok: x-meta-key runs a live report with no worker secret set", async () => {
  const { fetchFn, tokens } = recordingFetch();
  const res = await handleRequest({
    method: "POST",
    path: "/v1/report",
    body: payload(),
    env: { MOCK_MODE: "0" },
    fetchFn,
    headers: { "x-meta-key": "  caller-key  " },
  });
  assert.equal(res.status, 200);
  assert.ok(tokens.length > 0);
  assert.ok(tokens.every((t) => t === "Bearer caller-key"));
});

test("byok: caller key wins over the worker secret", async () => {
  const { fetchFn, tokens } = recordingFetch();
  const res = await handleRequest({
    method: "POST",
    path: "/v1/report",
    body: payload(),
    env: { MOCK_MODE: "0", META_API_KEY: "ours" },
    fetchFn,
    headers: { "x-meta-key": "theirs" },
  });
  assert.equal(res.status, 200);
  assert.ok(tokens.every((t) => t === "Bearer theirs"));
});

test("byok: no header and no secret still fails closed with 503", async () => {
  const { fetchFn, tokens } = recordingFetch();
  const res = await handleRequest({ method: "POST", path: "/v1/report", body: payload(), env: { MOCK_MODE: "0" }, fetchFn, headers: { "x-meta-key": "   " } });
  assert.equal(res.status, 503);
  assert.equal(tokens.length, 0);
});

test("byok: an oversized key is rejected before any call", async () => {
  const { fetchFn, tokens } = recordingFetch();
  const res = await handleRequest({
    method: "POST",
    path: "/v1/report",
    body: payload(),
    env: { MOCK_MODE: "0" },
    fetchFn,
    headers: { "x-baseten-key": "k".repeat(513) },
  });
  assert.equal(res.status, 400);
  assert.equal(tokens.length, 0);
});
