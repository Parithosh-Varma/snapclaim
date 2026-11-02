import { strict as assert } from "node:assert";
import { test } from "node:test";
import { measureSession } from "../src/engine/measure.ts";
import { validateFindings } from "../src/findings/evidence-gate.ts";
import { handleRequest } from "../backend/app.ts";

const wall = { id: "wall", areaPx: 10000, confidence: 1 };

test("a blocky tap is refuted, not measured", () => {
  const out = measureSession({
    component: wall,
    masks: [{ id: "t1", label: "crack", areaPx: 500, regionCount: 1, blockyRegionCount: 1, blockyAreaPx: 500, confidence: 0.9 }],
  });
  assert.equal(out.verdict, "no-damage");
  assert.equal(out.findings.length, 0);
  assert.equal(out.refuted.length, 1);
  assert.equal(out.refuted[0]?.reason, "blocky");
  assert.ok(out.receipts.some((r) => r.method === "damage_refuted"));
});

test("a straight-edged tap still measures (straight cracks are real)", () => {
  // Mortar joints, saw cuts and the synthetic tilted-wall bench crack are
  // ruler-straight. Straight alone never refutes - only blocky does.
  const out = measureSession({
    component: wall,
    masks: [{ id: "t2", label: "crack", areaPx: 300, skeletonPx: 120, regionCount: 1, straightRegionCount: 1, straightAreaPx: 300, confidence: 0.85 }],
  });
  assert.equal(out.verdict, "damage");
  assert.equal(out.findings.length, 1);
  assert.equal(out.refuted.length, 0);
});

test("a real crack still measures when mixed with a blob", () => {
  const out = measureSession({
    component: wall,
    masks: [
      { id: "t1", label: "crack", areaPx: 500, regionCount: 1, blockyRegionCount: 1, blockyAreaPx: 500, confidence: 0.9 },
      { id: "c1", label: "crack", areaPx: 500, skeletonPx: 100, regionCount: 1, confidence: 0.9 },
    ],
  });
  assert.equal(out.verdict, "damage");
  assert.equal(out.findings.length, 1);
  assert.equal(out.refuted.length, 1);
});

test("an empty mask list is a no-damage verdict with a citation", () => {
  const out = measureSession({ component: wall, masks: [] });
  assert.equal(out.verdict, "no-damage");
  assert.ok(out.receipts.some((r) => r.method === "damage_refuted"));
});

test("gate accepts a cited no-damage verdict", () => {
  const out = measureSession({ component: wall, masks: [] });
  const refuted = out.receipts.filter((r) => r.method === "damage_refuted").map((r) => r.id);
  const gate = validateFindings(
    [{ statement: "No crack found - the marked region is not damage.", citations: refuted }],
    out.receipts,
  );
  assert.equal(gate.ok, true);
});

test("gate rejects an uncited no-damage claim", () => {
  const out = measureSession({ component: wall, masks: [] });
  const gate = validateFindings([{ statement: "No crack found.", citations: [] }], out.receipts);
  assert.equal(gate.ok, false);
});

test("POST /v1/report on a clean wall answers 200, not 422", async () => {
  const res = await handleRequest({ method: "POST", path: "/v1/report", body: { component: wall, masks: [] }, env: {} });
  assert.equal(res.status, 200);
  const result = (res.body as { result: { findings: Array<{ statement: string }>; gate: { ok: boolean } } }).result;
  assert.equal(result.gate.ok, true);
  assert.match(result.findings[0]?.statement ?? "", /no crack found/i);
});

test("tiny unexamined regions stay measurable (conservative)", () => {
  // Regions under MIN_SHAPE_AREA_PX are never shape-checked: a mask of pure
  // speckle is measured, not refuted. Missing real micro-damage is worse
  // than measuring speckle, so refutation requires a flagged region.
  const out = measureSession({
    component: { id: "wall", areaPx: 10000, confidence: 1 },
    masks: [{ id: "s1", label: "crack", areaPx: 12, regionCount: 3, confidence: 0.9 }],
  });
  assert.equal(out.verdict, "damage");
  assert.equal(out.findings.length, 1);
});

test("non-crack labels are never shape-refuted", () => {
  const out = measureSession({
    component: { id: "wall", areaPx: 10000, confidence: 1 },
    masks: [{ id: "s1", label: "stain", areaPx: 500, regionCount: 1, blockyRegionCount: 1, blockyAreaPx: 500, confidence: 0.9 }],
  });
  assert.equal(out.verdict, "damage");
  assert.equal(out.refuted.length, 0);
});

test("threshold dial cannot flip a verdict past its receipt", () => {
  const base = {
    component: { id: "wall", areaPx: 10000, confidence: 1 },
    masks: [{ id: "c1", label: "crack" as const, areaPx: 500, skeletonPx: 100, regionCount: 1, confidence: 0.9 }],
  };
  const strict = measureSession({ ...base, thresholds: { cosmeticMaxRatio: 0.005, moderateMaxRatio: 0.01, significantCrackMm: 50, significantRegionCount: 1 } });
  const loose = measureSession({ ...base, thresholds: { cosmeticMaxRatio: 0.005, moderateMaxRatio: 0.5, significantCrackMm: 500, significantRegionCount: 10 } });
  // Same pixels, same percent - only the band label moves, and the receipt records which dials were used.
  assert.equal(strict.findings[0]?.percent, loose.findings[0]?.percent);
  assert.equal(strict.findings[0]?.severity, "significant");
});

test("gate blocks payout-grade severity without a severity receipt", () => {
  const out = measureSession({
    component: { id: "wall", areaPx: 10000, confidence: 1 },
    masks: [{ id: "c1", label: "crack", areaPx: 500, skeletonPx: 100, regionCount: 1, confidence: 0.9 }],
  });
  const ratio = out.findings[0]?.receiptIds.ratio ?? "R000";
  const sev = out.findings[0]?.receiptIds.severity ?? "R000";
  for (const word of ["demolish", "condemned", "collapse", "evacuate"]) {
    const gate = validateFindings(
      [{ statement: `crack covers ${out.findings[0]?.percent}%; wall must be ${word}.`, citations: [ratio, sev] }],
      out.receipts,
    );
    assert.equal(gate.ok, false, word);
  }
});

test("POST /v1/findings on a refuted tap answers no-damage", async () => {
  const measured = measureSession({
    component: { id: "wall", areaPx: 10000, confidence: 1 },
    masks: [{ id: "t1", label: "crack", areaPx: 500, regionCount: 1, blockyRegionCount: 1, blockyAreaPx: 500, confidence: 0.9 }],
  });
  assert.equal(measured.verdict, "no-damage");
  const res = await handleRequest({
    method: "POST",
    path: "/v1/findings",
    body: {
      component: { id: "wall", areaPx: 10000, confidence: 1 },
      masks: [{ id: "t1", label: "crack", areaPx: 500, regionCount: 1, blockyRegionCount: 1, blockyAreaPx: 500, confidence: 0.9 }],
      transcript: "x",
      findings: measured.findings,
      receipts: measured.receipts,
    },
    env: {},
  });
  assert.equal(res.status, 200);
  const result = (res.body as { result: { findings: Array<{ statement: string }> } }).result;
  assert.match(result.findings[0]?.statement ?? "", /no crack found/i);
});

test("observe then report: empty mask flows end to end, not 400", async () => {
  const W = 16, H = 16;
  const observed = await handleRequest({
    method: "POST",
    path: "/v1/observe",
    body: { masks: [{ id: "m1", label: "crack", rle: { size: [H, W], counts: [H * W] }, confidence: 0.9 }] },
    env: {},
  });
  assert.equal(observed.status, 200);
  const body = (observed.body as { result: Record<string, unknown> }).result;
  const reported = await handleRequest({ method: "POST", path: "/v1/report", body: { ...body, transcript: "wall" }, env: {} });
  assert.equal(reported.status, 200);
  const result = (reported.body as { result: { gate: { ok: boolean }; measurement: { verdict: string } } }).result;
  assert.equal(result.measurement.verdict, "no-damage");
  assert.equal(result.gate.ok, true);
});

test("observe drops 1-3px noise regions before measuring", async () => {
  const W = 64, H = 64;
  const counts: number[] = [];
  let cur = 0, run = 0;
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    const v = (x * 7 + y * 13) % 97 < 2 ? 1 : 0;
    if (v !== cur) { counts.push(run); run = 0; cur = v; }
    run++;
  }
  counts.push(run);
  const observed = await handleRequest({
    method: "POST",
    path: "/v1/observe",
    body: { masks: [{ id: "m1", label: "crack", rle: { size: [H, W] as [number, number], counts }, confidence: 0.9 }] },
    env: {},
  });
  assert.equal(observed.status, 200);
  const masks = (observed.body as { result: { masks: Array<{ regionCount: number; areaPx: number }> } }).result.masks;
  assert.ok(masks[0]!.regionCount <= 2, `noise regions should be floored, got ${masks[0]!.regionCount}`);
});
