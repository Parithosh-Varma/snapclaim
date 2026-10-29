import { strict as assert } from "node:assert";
import { test } from "node:test";
import { agreementVerdict, maskAgreement } from "../src/vision/agreement.ts";
import { maskFromRows } from "../src/vision/mask.ts";

test("identical masks agree perfectly, disjoint masks score zero", () => {
  const a = maskFromRows(["##.", "##.", "..."]);
  assert.deepEqual(maskAgreement(a, a), { intersection: 4, union: 4, iou: 1, dice: 1 });
  const b = maskFromRows(["..#", "..#", "..#"]);
  const disjoint = maskAgreement(a, b);
  assert.equal(disjoint.intersection, 0);
  assert.equal(disjoint.iou, 0);
});

test("partial overlap scores between 0 and 1", () => {
  const a = maskFromRows(["###", "...", "..."]);
  const b = maskFromRows(["##.", "##.", "..."]);
  const agreement = maskAgreement(a, b);
  // Intersection 2, union 5 → IoU 0.4, Dice 2*2/(3+4) ≈ 0.571.
  assert.equal(agreement.intersection, 2);
  assert.equal(agreement.union, 5);
  assert.equal(agreement.iou, 0.4);
  assert.equal(agreement.dice, 0.571);
  assert.equal(agreementVerdict(agreement, 0.5), "DISPUTED");
  assert.equal(agreementVerdict(agreement, 0.3), "AGREED");
});

test("two empty masks agree vacuously; size mismatch throws", () => {
  const empty = maskFromRows(["...", "..."]);
  assert.equal(maskAgreement(empty, empty).iou, 1);
  assert.throws(() => maskAgreement(empty, maskFromRows(["..", ".."])));
  assert.throws(() => agreementVerdict(maskAgreement(empty, empty), 2));
});
