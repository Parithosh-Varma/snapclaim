import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleRequest } from "../backend/app.ts";
import { citingDrafts, LIVE_ENV, loadWallFixture, modelFetch, wallSession } from "./helpers.ts";

const payload = () => {
  const f = loadWallFixture();
  return {
    component: f.component,
    masks: f.masks,
    scaleReference: f.scaleReference,
    transcript: "wall crack near the window, coin for scale",
  };
};

test("backend health reports live mode only when keys are set", async () => {
  const res = await handleRequest({ method: "GET", path: "/v1/health", env: {} });
  assert.equal(res.status, 200);
  const body = res.body as { ok: boolean; version: string; mode: string };
  assert.equal(body.ok, true);
  assert.equal(body.mode, "config-error");
  assert.ok(body.version.length > 0);

  const live = await handleRequest({ method: "GET", path: "/v1/health", env: LIVE_ENV });
  assert.equal((live.body as { mode: string }).mode, "live");
});

test("backend measure is enveloped and ignores extra fields", async () => {
  const res = await handleRequest({
    method: "POST",
    path: "/v1/measure",
    body: { ...payload(), extra_future_field: "ignored" },
    env: {},
  });
  assert.equal(res.status, 200);
  const body = res.body as { ok: boolean; requestId: string; result: { findings: unknown[] } };
  assert.equal(body.ok, true);
  assert.ok(body.requestId.length > 0);
  assert.equal(body.result.findings.length, 2);
});

test("backend report runs measure + live findings + evidence gate", async () => {
  const fetchFn = modelFetch(citingDrafts(wallSession().findings));
  const res = await handleRequest({ method: "POST", path: "/v1/report", body: payload(), env: LIVE_ENV, fetchFn });
  assert.equal(res.status, 200);
  const body = res.body as {
    result: { findings: Array<{ statement: string }>; gate: { ok: boolean } };
  };
  assert.equal(body.result.gate.ok, true);
  assert.equal(body.result.findings.length, 2);
});

test("backend report rejects uncited numbers with 422 and failures", async () => {
  const res = await handleRequest({
    method: "POST",
    path: "/v1/report",
    body: { ...payload(), drafts: [{ statement: "crack covers 99.99% of the component.", citations: [] }] },
    env: {},
  });
  assert.equal(res.status, 422);
  const body = res.body as { ok: boolean; details: string[] };
  assert.equal(body.ok, false);
  assert.ok(Array.isArray(body.details) && body.details.length > 0);
});

test("backend caps masks at 50", async () => {
  const p = payload();
  const masks = Array.from({ length: 51 }, (_, i) => ({ id: `m${i}`, label: "crack" as const, areaPx: 10, confidence: 0.9 }));
  const res = await handleRequest({ method: "POST", path: "/v1/measure", body: { ...p, masks }, env: {} });
  assert.equal(res.status, 400);
});

test("live findings without a key fails closed with 503", async () => {
  const p = payload();
  const measured = await handleRequest({ method: "POST", path: "/v1/measure", body: p, env: {} });
  const result = (measured.body as { result: { findings: unknown[]; receipts: unknown[] } }).result;
  const res = await handleRequest({
    method: "POST",
    path: "/v1/findings",
    body: { transcript: "x", findings: result.findings, receipts: result.receipts },
    env: {},
  });
  assert.equal(res.status, 503);
});

test("findings with masks cross-checks receipts and rejects tampered ones", async () => {
  const p = payload();
  const measured = await handleRequest({ method: "POST", path: "/v1/measure", body: p, env: {} });
  const result = (measured.body as { result: { findings: unknown[]; receipts: unknown[] } }).result;
  const fetchFn = modelFetch(citingDrafts(wallSession().findings));

  const ok = await handleRequest({
    method: "POST",
    path: "/v1/findings",
    body: { ...p, transcript: "x", findings: result.findings, receipts: result.receipts },
    env: LIVE_ENV,
    fetchFn,
  });
  assert.equal(ok.status, 200);

  const tampered = JSON.parse(JSON.stringify(result.receipts)) as Array<{ output: { value: unknown } }>;
  (tampered[0] as { output: { value: unknown } }).output.value = 99.99;
  const bad = await handleRequest({
    method: "POST",
    path: "/v1/findings",
    body: { ...p, transcript: "x", findings: result.findings, receipts: tampered },
    env: LIVE_ENV,
    fetchFn,
  });
  assert.equal(bad.status, 422);
});

test("segment never invents masks: no fixture path, no key means 503", async () => {
  const f = loadWallFixture();
  const res = await handleRequest({
    method: "POST",
    path: "/v1/segment",
    body: { imageId: f.imageId, labels: ["crack"], fixture: { component: f.component, masks: f.masks } },
    env: {},
  });
  assert.equal(res.status, 503);
});
