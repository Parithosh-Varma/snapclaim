import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { observeBody } from "../backend/app.ts";
import { decodeRle } from "../src/vision/mask.ts";
import { observeMask } from "../src/vision/observe.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const rle = read("../fixtures/rle/facade-crack.json");
const bench = read("../fixtures/masks/facade-crack.json");
const masks = new Map<string, { label: never; confidence: number; rle: never }>(
  rle.masks.map((m: { id: string }) => [m.id, m]),
);

function observe(id: string) {
  const m = masks.get(id)!;
  return observeMask(decodeRle(m.rle), { id, label: m.label, confidence: m.confidence });
}

test("real facade masks reproduce the bench statistics", () => {
  // If the vision code changes these numbers, update fixtures/masks/facade-crack.json and its expected file on purpose.
  assert.deepEqual(observe("crack-taps"), bench.masks[0]);
});

test("calibrated SAM 3.1 RLE fixtures reproduce fixtures/masks/calibrated-*.json via observeBody", () => {
  for (const id of [
    "calibrated-plaster-hairline-01",
    "calibrated-masonry-step-02",
    "calibrated-stone-oblique-03",
  ]) {
    const rawRle = read(`../fixtures/rle/${id}.json`);
    const maskFixture = read(`../fixtures/masks/${id}.json`);
    const observed = observeBody({ masks: rawRle.masks, reference: rawRle.reference });
    assert.equal(observed.ok, true);
    if (!observed.ok) throw new Error("observeBody failed");
    const res = observed.result as {
      component: unknown;
      masks: unknown;
      scaleReference: unknown;
    };
    assert.deepEqual(
      {
        component: res.component,
        masks: res.masks,
        scaleReference: res.scaleReference,
      },
      {
        component: maskFixture.component,
        masks: maskFixture.masks,
        scaleReference: maskFixture.scaleReference,
      },
    );
  }
});

test("real facade: built pieces are flagged, the crack itself is not", () => {
  const block = observe("block-tap");
  assert.equal(block.blockyRegionCount, 1);
  assert.ok(block.blockyAreaPx! > 0.99 * block.areaPx, "the whole tap is the frame block");
  assert.equal(block.straightRegionCount, 1, "the frame block's edges are ruler-straight");

  // Four taps along the crack. Blocky: the frame block (2,115 px) plus a 63 px crack
  // fragment at the photo edge. Straight-edged: the frame block and the pediment-ledge
  // strip (1,239 px), which is long and thin and so passes the blocky check. The two
  // real crack segments (829 and 244 px) are in neither.
  const taps = observe("crack-taps");
  assert.equal(taps.blockyRegionCount, 2);
  assert.equal(taps.blockyAreaPx, 2115 + 63);
  assert.equal(taps.straightRegionCount, 2);
  assert.equal(taps.straightAreaPx, 2115 + 1239);
});
