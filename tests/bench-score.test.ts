import { strict as assert } from "node:assert";
import { test } from "node:test";
import { scoreDisputes } from "../bench/score.ts";

const label = (maskId: string, expected: "CONFIRMED" | "DISPUTED") => ({ caseId: "c1", maskId, expected });
const pred = (maskId: string, verdict: "CONFIRMED" | "DISPUTED") => ({ caseId: "c1", maskId, verdict });

test("counts all four outcomes and derives precision and recall", () => {
  const score = scoreDisputes(
    [label("a", "DISPUTED"), label("b", "DISPUTED"), label("c", "CONFIRMED"), label("d", "CONFIRMED")],
    [pred("a", "DISPUTED"), pred("b", "CONFIRMED"), pred("c", "DISPUTED"), pred("d", "CONFIRMED")],
  );
  assert.deepEqual(
    [score.truePositives, score.falsePositives, score.falseNegatives, score.trueNegatives],
    [1, 1, 1, 1],
  );
  assert.equal(score.precision, 0.5);
  assert.equal(score.recall, 0.5);
  assert.deepEqual(score.missing, []);
});

test("a labeled finding with no verdict is listed as missing and not hidden", () => {
  const score = scoreDisputes([label("a", "DISPUTED"), label("b", "CONFIRMED")], []);
  assert.deepEqual(score.missing, ["c1/a", "c1/b"]);
  assert.equal(score.falseNegatives, 1);
  assert.equal(score.recall, 0);
});

test("precision and recall are null, not 0 or 1, when there is nothing to divide by", () => {
  const score = scoreDisputes([label("a", "CONFIRMED")], [pred("a", "CONFIRMED")]);
  assert.equal(score.precision, null);
  assert.equal(score.recall, null);
  assert.equal(score.trueNegatives, 1);
});

test("matches on caseId and maskId together", () => {
  const score = scoreDisputes(
    [{ caseId: "c1", maskId: "m", expected: "DISPUTED" }],
    [{ caseId: "c2", maskId: "m", verdict: "DISPUTED" }],
  );
  assert.equal(score.truePositives, 0);
  assert.deepEqual(score.missing, ["c1/m"]);
});
