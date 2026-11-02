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

test("a straight-edged tap is refuted, not measured", () => {
  const out = measureSession({
    component: wall,
    masks: [{ id: "t2", label: "crack", areaPx: 300, regionCount: 1, straightRegionCount: 1, straightAreaPx: 300, confidence: 0.85 }],
  });
  assert.equal(out.verdict, "no-damage");
  assert.equal(out.refuted[0]?.reason, "straight");
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
