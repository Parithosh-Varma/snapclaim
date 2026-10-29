import { strict as assert } from "node:assert";
import { test } from "node:test";
import { measureSession } from "../src/engine/measure.ts";
import { replay } from "../eval/replay.ts";
import { loadWallFixture } from "./helpers.ts";

test("replay matches a fresh measurement byte-for-byte", () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  const result = replay(
    { component: fixture.component, masks: fixture.masks, scaleReference: fixture.scaleReference },
    session,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test("replay catches a tampered receipt or a changed input", () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  const tampered = JSON.parse(JSON.stringify(session)) as typeof session;
  tampered.receipts[0]!.output.value = 99.99;
  const drifted = replay(
    { component: fixture.component, masks: fixture.masks, scaleReference: fixture.scaleReference },
    tampered,
  );
  assert.equal(drifted.ok, false);
  assert.ok(drifted.mismatches.some((mismatch) => mismatch.includes("R001")));

  const changedInput = replay(
    {
      component: fixture.component,
      masks: [{ ...fixture.masks[0]!, areaPx: 1 }],
      scaleReference: fixture.scaleReference,
    },
    session,
  );
  assert.equal(changedInput.ok, false);
});
