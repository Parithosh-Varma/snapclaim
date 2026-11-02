import { strict as assert } from "node:assert";
import { test } from "node:test";
import { circleRle, encodeRle } from "../react/src/lib/rle.ts";
import { pickCoinRecord } from "../react/src/lib/sam.ts";

const W = 100;
const H = 100;

function slab(): ReturnType<typeof circleRle> {
  // Wall slab covering most of the frame, tap inside it.
  const mask = new Uint8Array(W * H).fill(1);
  return encodeRle(mask, W, H);
}

test("picks the disc over the wall slab when the tap is in the coin", () => {
  const coin = circleRle(30, 30, 10, W, H);
  const records = [
    { rle: slab(), confidence: 0.9 },
    { rle: coin, confidence: 0.7 },
  ];
  const picked = pickCoinRecord(records, [30, 30], W, H);
  assert.ok(picked);
  assert.equal(picked.mask[30 * W + 30], 1);
  assert.equal(picked.mask[80 * W + 80], 0);
});

test("returns null when the tap is only on the wall", () => {
  const coin = circleRle(30, 30, 10, W, H);
  const picked = pickCoinRecord(
    [{ rle: slab(), confidence: 0.9 }, { rle: coin, confidence: 0.7 }],
    [80, 80],
    W,
    H,
  );
  assert.equal(picked, null);
});

test("returns null for empty, corrupt-dimensioned or tiny records", () => {
  assert.equal(pickCoinRecord([], [50, 50], W, H), null);
  const wrong = circleRle(5, 5, 3, 20, 20);
  assert.equal(pickCoinRecord([{ rle: wrong, confidence: 0.9 }], [5, 5], W, H), null);
  const speck = new Uint8Array(W * H);
  speck[50 * W + 50] = 1;
  assert.equal(pickCoinRecord([{ rle: encodeRle(speck, W, H), confidence: 0.9 }], [50, 50], W, H), null);
});

test("prefers the most disc-like candidate containing the tap", () => {
  // Elongated blob and a disc, both containing the tap: the disc wins.
  const blob = new Uint8Array(W * H);
  for (let y = 40; y < 60; y++) for (let x = 10; x < 90; x++) blob[y * W + x] = 1;
  const disc = circleRle(50, 50, 12, W, H);
  const picked = pickCoinRecord(
    [
      { rle: encodeRle(blob, W, H), confidence: 0.95 },
      { rle: disc, confidence: 0.6 },
    ],
    [50, 50],
    W,
    H,
  );
  assert.ok(picked);
  // Blob's far corner is on, the disc's equivalent area is off.
  assert.equal(picked.mask[45 * W + 15], 0);
  assert.equal(picked.mask[50 * W + 50], 1);
});
