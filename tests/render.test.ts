import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
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

function renderBase() {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  return { findings: session.findings, receipts: session.receipts, mode: session.mode, generatedAt: "t", version: "0.2.0" } as const;
}

test("overlay draws scaled mask paths over the photo", () => {
  const base = renderBase();
  const plain = renderAnnexureSvg({ ...base });
  const svg = renderAnnexureSvg({
    ...base,
    overlay: {
      width: 1504,
      height: 1000,
      photoHref: "data:image/png;base64,AAAA",
      masks: [{ id: "m1", label: "crack", path: "M 0 0 L 10 0 L 10 10 Z" }],
    },
  });
  assert.ok(plain.includes("bars are proportional schematics"));
  assert.ok(!svg.includes("not photo overlays"));
  assert.ok(svg.includes("<image"));
  assert.ok(svg.includes('d="M 0 0 L 10 0 L 10 10 Z"'));
  assert.ok(svg.includes("translate(24 88) scale(0.42)"));
  assert.ok(svg.includes('fill-rule="evenodd"'));
  assert.ok(svg.includes("#c0392b"));
  const h = (s: string): number => Number(s.match(/height="(\d+(?:\.\d+)?)"/)![1]);
  assert.ok(h(svg) > h(plain));
});

test("overlay drops hostile photo hrefs and escapes strings", () => {
  const base = renderBase();
  const mask = { id: 'a"b', label: "<x>", path: "M 0 0 L 1 1 Z" };
  const js = renderAnnexureSvg({ ...base, overlay: { width: 10, height: 10, photoHref: "javascript:alert(1)", masks: [mask] } });
  assert.ok(!js.includes("<image"));
  assert.ok(!js.includes("javascript:"));
  // Hostile https hrefs with quote-breakouts are dropped entirely (fail closed),
  // not escaped into the markup.
  const inj = renderAnnexureSvg({
    ...base,
    overlay: { width: 10, height: 10, photoHref: 'https://x.test/a.png" onload="alert(1)', masks: [mask] },
  });
  assert.ok(!inj.includes("<image"));
  assert.ok(!inj.includes("onload="));
  assert.ok(!inj.includes("<x>"));
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

test("overlay labels never read prototype keys", () => {
  const base = renderBase();
  for (const label of ["constructor", "__proto__"]) {
    const svg = renderAnnexureSvg({ ...base, overlay: { width: 10, height: 10, masks: [{ id: "m", label, path: "M 0 0 Z" }] } });
    assert.ok(svg.includes('fill="#7f8c8d"'));
    assert.ok(!svg.includes("[native code]") && !svg.includes("[object"));
  }
});

test("overlay caption and non-scaling stroke", () => {
  const base = renderBase();
  const svg = renderAnnexureSvg({ ...base, overlay: { width: 10, height: 10, masks: [{ id: "m", label: "crack", path: "M 0 0 Z" }] } });
  assert.ok(svg.includes("outlines traced from segmentation masks; bars are proportional schematics from receipts"));
  assert.ok(svg.includes('vector-effect="non-scaling-stroke"'));
});

test("overlay legend labels each measured outline with its own numbers", () => {
  const base = renderBase();
  const svg = renderAnnexureSvg({
    ...base,
    overlay: {
      width: 100,
      height: 80,
      masks: [
        { id: "damage-1", label: "crack", path: "M 0 0 L 10 0 L 10 10 Z" },
        { id: "coin", label: "coin", path: "M 20 20 L 30 20 L 30 30 Z" },
      ],
    },
  });
  // The crack outline is labelled with the measured value; the scale coin is not a finding.
  assert.ok(svg.includes("Crack 5.17% · 85.9 mm"));
  assert.ok(!svg.includes("Coin 5.17%"));
  assert.ok(svg.indexOf("Crack 5.17%") < svg.indexOf("Findings ("));
});

test("no-overlay svg is pinned (golden hash)", () => {
  const svg = renderAnnexureSvg({ ...renderBase(), generatedAt: "2026-10-28T00:00:00.000Z" });
  assert.equal(createHash("sha256").update(svg).digest("hex"), "f492a47f3614ac376393bca8cdbab2c37c5dc40688587b15968ed6e28c058ffa");
});
