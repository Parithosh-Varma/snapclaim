import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MAX_MEDIAN_LENGTH_ERROR, runScene, scenes, summarize } from "../bench/truth.ts";

// The full grid takes a few seconds; the steepest tilt plus the refusals is enough here.
const picked = scenes().filter((s) => s.aspect === 0.65 || s.id.startsWith("refuse-"));
const results = picked.map(runScene);

test("known-truth scenes on a tilted wall measure length and width within 10%", () => {
  for (const r of results.filter((r) => r.trueLengthMm !== null)) {
    assert.ok(r.lengthError! <= 0.1, `${r.scene.id}: length off by ${r.lengthError}`);
    assert.ok(r.widthError! <= 0.1, `${r.scene.id}: width off by ${r.widthError}`);
  }
  assert.ok(summarize(results).medianLengthError <= MAX_MEDIAN_LENGTH_ERROR);
});

test("no coin or a coin tilted too far gives no millimetres at all", () => {
  const s = summarize(results);
  assert.equal(s.refusalCases, 3);
  assert.deepEqual(s.refusalFailures, []);
});
