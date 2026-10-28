import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runHeldOut } from "../bench/run.ts";

test("a scale-less case with a millimetre value is flagged as invented", () => {
  const r = runHeldOut(
    [{ id: "a", hasScaleReference: false }, { id: "b", hasScaleReference: false }],
    [
      { caseId: "a", findings: [{ maskId: "m", crackLengthMm: 12 }] },
      { caseId: "b", findings: [{ maskId: "m", crackLengthMm: null }] },
    ],
  );
  assert.deepEqual(r.invented, ["a"]);
  assert.deepEqual(r.refusedCorrectly, ["b"]);
});

test("a case with no archived run is unrun, not a pass", () => {
  const r = runHeldOut([{ id: "a", hasScaleReference: false }], []);
  assert.deepEqual(r.unrun, ["a"]);
  assert.deepEqual(r.refusedCorrectly, []);
});

test("a scaled case may carry millimetres", () => {
  const r = runHeldOut([{ id: "a", hasScaleReference: true }], [{ caseId: "a", findings: [{ maskId: "m", crackLengthMm: 40 }] }]);
  assert.deepEqual(r.invented, []);
});

test("dispute labels on a held-out case are scored against the run's verdicts", () => {
  const r = runHeldOut(
    [{ id: "a", hasScaleReference: true, disputeLabels: [{ maskId: "m", expected: "DISPUTED" }] }],
    [{ caseId: "a", findings: [{ maskId: "m", crackLengthMm: 40, verdict: "DISPUTED" }] }],
  );
  assert.equal(r.disputes.truePositives, 1);
  assert.equal(r.disputes.recall, 1);
});
