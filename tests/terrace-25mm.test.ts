import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { measureSession } from "../src/engine/measure.ts";
import { validateRun } from "../bench/run.ts";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

function terraceCase(): Record<string, unknown> {
  const split = JSON.parse(read("bench/split.json")) as {
    heldOut: Record<string, unknown>[];
  };
  const found = split.heldOut.find((c) => c.id === "terrace-slab-tape-01");
  assert.ok(found, "terrace-slab-tape-01 is in heldOut");
  return found;
}

test("terrace case uses the user-supplied 25 mm coin, no thread truth", () => {
  const c = terraceCase();
  const coin = c.coin as { knownMm: number; knownMmNote: string };
  assert.equal(coin.knownMm, 25, "knownMm is the user-supplied 25");
  assert.match(coin.knownMmNote, /user-supplied/, "the note says where 25 came from");
  const blob = JSON.stringify(c);
  assert.ok(!/238\.8/.test(blob), "no thread value in the case");
  assert.ok(!/\b23 mm\b/.test(blob), "no 23 mm in the case");
  assert.ok(!/\b24 mm\b/.test(blob), "no 24 mm in the case");
  const gt = c.groundTruth as Record<string, unknown>;
  assert.equal(gt.pathMm, undefined, "thread path is not ground truth here");
  assert.equal(gt.spanMm, 227, "tape span stands");
  assert.deepEqual(gt.spanRangeMm, [225, 230], "span range stands");
});

test("archived terrace run uses the 25 mm coin and matches an engine re-run", () => {
  const run = JSON.parse(read("bench/runs/terrace-slab-tape-01.json"));
  assert.equal(validateRun(run), null, "archived run validates");
  assert.equal(run.caseId, "terrace-slab-tape-01");
  assert.equal(run.findings[0]?.maskId, "damage-1");
  assert.equal(run.findings[0]?.crackLengthMm, 237.5);
  const byId = new Map(run.receipts.map((r: { id: string }) => [r.id, r]));
  const r001 = byId.get("R001") as { inputs: { knownMm: number }; output: { value: number } };
  assert.equal(r001.inputs.knownMm, 25, "archived R001 uses the 25 mm coin");
  assert.equal(r001.output.value, 0.773994);

  // Re-execute the measurement from the signed-report scalars (areaPx,
  // skeletonPx, lengthPx derived by algebra from the 23 mm report's
  // receipts; same crack photo, so same pixels — only knownMm changes).
  const rerun = measureSession(
    JSON.parse(
      JSON.stringify({
        component: { id: "slab", areaPx: 175890, confidence: 0.95 },
        masks: [
          { id: "damage-1", label: "crack", areaPx: 1284, skeletonPx: 306.8, regionCount: 1, confidence: 0.9 },
        ],
        scaleReference: { id: "coin-2inr", knownMm: 25, lengthPx: 32.3, confidence: 0.88 },
      }),
    ),
  );
  const val = (id: string): unknown => rerun.receipts.find((r) => r.id === id)?.output.value;
  assert.equal(val("R001"), 0.773994);
  assert.equal(val("R004"), 7.69);
  assert.equal(val("R005"), 237.5);
  assert.equal(val("R006"), 3.2);
  assert.equal(rerun.mode, "absolute");
  assert.equal(rerun.provenance, "self-reported", "no RLE in repo, so no pixel provenance");
});
