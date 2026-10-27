import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MeasurementError, calibratedLengthMm } from "../src/engine/math.ts";
import { measureSession } from "../src/engine/measure.ts";
import {
  type BinaryMask,
  DIAGONAL_LINK_PX,
  ORTHOGONAL_LINK_PX,
  connectedRegions,
  createMask,
  decodeRle,
  maskArea,
  maskFromRows,
  skeletonLengthPx,
  skeletonize,
} from "../src/vision/mask.ts";
import { circularReference, observeMask } from "../src/vision/observe.ts";

function fill(mask: BinaryMask, inside: (x: number, y: number) => boolean): BinaryMask {
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (inside(x, y)) mask.data[y * mask.width + x] = 1;
    }
  }
  return mask;
}

function disc(size: number, cx: number, cy: number, r: number): BinaryMask {
  return fill(createMask(size, size), (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
}

/** pycocotools rleToString, used to round-trip the compressed decoder. */
function encodeCounts(counts: number[]): string {
  let s = "";
  counts.forEach((count, i) => {
    let x = i > 2 ? count - (counts[i - 2] as number) : count;
    let more = true;
    while (more) {
      let c = x & 0x1f;
      x >>= 5;
      more = (c & 0x10) !== 0 ? x !== -1 : x !== 0;
      if (more) c |= 0x20;
      s += String.fromCharCode(c + 48);
    }
  });
  return s;
}

test("COCO RLE decodes column-major into a row-major mask", () => {
  // 3 rows x 2 cols; column 0 = [0,1,1], column 1 = [1,0,0].
  const mask = decodeRle({ size: [3, 2], counts: [1, 3, 2] });
  assert.deepEqual([...mask.data], [0, 1, 1, 0, 1, 0]);

  const counts = [5, 12, 40, 3, 7, 200, 33];
  const total = counts.reduce((a, b) => a + b, 0);
  const plain = decodeRle({ size: [total / 10, 10], counts });
  const compressed = decodeRle({ size: [total / 10, 10], counts: encodeCounts(counts) });
  assert.deepEqual(compressed.data, plain.data);

  assert.throws(() => decodeRle({ size: [3, 2], counts: [1, 3] }), MeasurementError);
  assert.throws(() => decodeRle({ size: [3, 2], counts: [1, 9] }), MeasurementError);
});

test("regions are 8-connected and sorted largest first", () => {
  const mask = maskFromRows([
    "##....#",
    "##...#.",
    ".......",
    "...#...",
  ]);
  assert.equal(maskArea(mask), 7);
  const regions = connectedRegions(mask);
  assert.deepEqual(regions.map((r) => r.areaPx), [4, 2, 1]);
});

test("skeleton length measures straight, diagonal and cornered lines", () => {
  const horizontal = maskFromRows(["..........", ".########.", ".........."]);
  assert.ok(Math.abs(skeletonLengthPx(horizontal) - 7 * ORTHOGONAL_LINK_PX) < 1e-9);

  const diagonal = fill(createMask(50, 50), (x, y) => x === y);
  assert.ok(Math.abs(skeletonLengthPx(diagonal) - 49 * DIAGONAL_LINK_PX) < 1e-9);

  // An L corner is two orthogonal links, not two links plus a diagonal.
  assert.ok(Math.abs(skeletonLengthPx(maskFromRows(["#.", "##"])) - 2 * ORTHOGONAL_LINK_PX) < 1e-9);
});

test("a thick crack thins to a centreline close to its true length", () => {
  // 300 px long, 7 px wide, tilted 30 degrees.
  const angle = Math.PI / 6;
  const crack = fill(createMask(320, 200), (x, y) => {
    const u = (x - 20) * Math.cos(angle) + (y - 20) * Math.sin(angle);
    const v = -(x - 20) * Math.sin(angle) + (y - 20) * Math.cos(angle);
    return u >= 0 && u <= 300 && Math.abs(v) <= 3.5;
  });
  const length = skeletonLengthPx(skeletonize(crack));
  // Thinning eats about half the width at each end, and pixel steps add a little.
  assert.ok(length > 290 && length < 310, `skeleton length ${length}`);
});

test("observeMask clips to the component, drops speckle and measures cracks", () => {
  const crack = fill(createMask(120, 40), (x, y) => (y >= 18 && y <= 21 && x >= 10 && x < 110) || (x === 2 && y === 2));
  const component = fill(createMask(120, 40), (x) => x < 60);

  const whole = observeMask(crack, { id: "crack-1", label: "crack", confidence: 0.9 });
  assert.equal(whole.regionCount, 2);

  const clipped = observeMask(crack, { id: "crack-1", label: "crack", confidence: 0.9, component, minRegionAreaPx: 2 });
  assert.equal(clipped.areaPx, 50 * 4);
  assert.equal(clipped.regionCount, 1);
  assert.ok(clipped.skeletonPx !== undefined && clipped.skeletonPx > 40 && clipped.skeletonPx <= 49, `skeletonPx ${clipped.skeletonPx}`);

  const stain = observeMask(crack, { id: "stain-1", label: "stain", confidence: 0.7 });
  assert.equal(stain.skeletonPx, undefined);
});

test("a coin seen straight on calibrates to its diameter", () => {
  const { reference, diagnostics } = circularReference(disc(200, 100, 100, 60), {
    id: "coin-10inr",
    knownMm: 27,
    confidence: 0.95,
  });
  assert.ok(Math.abs(reference.lengthPx - 121) < 1.5, `lengthPx ${reference.lengthPx}`);
  assert.ok(diagnostics.aspect > 0.98);
  assert.ok(reference.confidence > 0.9);

  const length = calibratedLengthMm(300, reference);
  assert.ok(length !== null && Math.abs(length - 300 * (27 / reference.lengthPx)) < 0.1);
});

test("a half-covered coin loses confidence and the report drops to percent-only", () => {
  const halfCoin = disc(200, 100, 100, 60);
  for (let i = 0; i < halfCoin.data.length; i++) {
    if (Math.floor(i / 200) > 100) halfCoin.data[i] = 0;
  }
  const { reference, diagnostics } = circularReference(halfCoin, {
    id: "coin-10inr",
    knownMm: 27,
    confidence: 0.95,
  });
  assert.ok(diagnostics.aspect < 0.6);
  assert.ok(reference.confidence < 0.6, `confidence ${reference.confidence}`);

  const session = measureSession({
    component: { id: "wall", areaPx: 480000, confidence: 0.93 },
    masks: [{ id: "crack-1", label: "crack", areaPx: 2400, skeletonPx: 300, regionCount: 1, confidence: 0.9 }],
    scaleReference: reference,
  });
  assert.equal(session.mode, "percent-only");
  assert.ok(session.receipts.some((receipt) => receipt.method === "scale_rejected"));
});

test("stray pixels in a coin mask are ignored and discount confidence", () => {
  const coin = disc(200, 100, 100, 40);
  const clean = circularReference(coin, { id: "coin", knownMm: 27, confidence: 0.95 });
  fill(coin, (x, y) => x >= 180 && y >= 180);
  const noisy = circularReference(coin, { id: "coin", knownMm: 27, confidence: 0.95 });
  assert.equal(noisy.reference.lengthPx, clean.reference.lengthPx);
  assert.ok(noisy.diagnostics.largestShare < 1);
  assert.ok(noisy.reference.confidence < clean.reference.confidence);

  assert.throws(() => circularReference(createMask(10, 10), { id: "x", knownMm: 27, confidence: 1 }), MeasurementError);
});
