import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
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

test("real facade: the stone-frame tap is flagged as blocky", () => {
  const block = observe("block-tap");
  assert.equal(block.blockyRegionCount, 1);
  assert.ok(block.blockyAreaPx! > 0.99 * block.areaPx, "the whole tap is the frame block");

  // Four taps along the crack: the frame block is caught (plus a 63 px crack fragment at the
  // photo edge). The pediment-ledge strip is long and thin, so the shape check passes it:
  // 1,239 px of architecture still counted. A straightness check is the planned fix.
  const taps = observe("crack-taps");
  assert.equal(taps.blockyRegionCount, 2);
  assert.equal(taps.blockyAreaPx, 2115 + 63);
});
