import { strict as assert } from "node:assert";
import { test } from "node:test";
import { measureSession } from "../src/engine/measure.ts";
import { renderAnnexureSvg } from "../src/render/svg.ts";
import { handleRequest } from "../backend/app.ts";
import { citingDrafts, LIVE_ENV, loadWallFixture, modelFetch, wallSession } from "./helpers.ts";

test("renderer is deterministic and cites receipts", () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  const a = renderAnnexureSvg({
    findings: session.findings,
    receipts: session.receipts,
    mode: session.mode,
    generatedAt: "2026-10-28T00:00:00.000Z",
    version: "0.2.0",
  });
  const b = renderAnnexureSvg({
    findings: session.findings,
    receipts: session.receipts,
    mode: session.mode,
    generatedAt: "2026-10-28T00:00:00.000Z",
    version: "0.2.0",
  });
  assert.equal(a, b);
  assert.ok(a.includes("5.17%"));
  assert.ok(a.includes("R001"));
  assert.ok(a.includes("PERCENT-ONLY") || a.includes("ABSOLUTE"));
});

test("renderer escapes hostile strings", () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  const svg = renderAnnexureSvg({
    findings: session.findings,
    receipts: session.receipts,
    mode: session.mode,
    transcript: "<script>alert(1)</script>",
    generatedAt: "2026-10-28T00:00:00.000Z",
  });
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;"));
});

test("backend /v1/render returns gated svg", async () => {
  const fixture = loadWallFixture();
  const res = await handleRequest({
    method: "POST",
    path: "/v1/render",
    body: { ...fixture, transcript: "wall crack" },
    env: LIVE_ENV,
    fetchFn: modelFetch(citingDrafts(wallSession().findings)),
  });
  assert.equal(res.status, 200);
  const body = res.body as { result: { svg: string; gate: { ok: boolean } } };
  assert.equal(body.result.gate.ok, true);
  assert.ok(body.result.svg.startsWith("<svg"));
});
