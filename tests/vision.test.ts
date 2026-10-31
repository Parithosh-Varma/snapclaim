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
    id: "coin-27mm",
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
    id: "coin-27mm",
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

test("a partly covered coin is refused, not read as a tilted one", () => {
  const whole = circularReference(disc(200, 100, 100, 60), { id: "coin", knownMm: 24.26, confidence: 0.95 });
  assert.ok(whole.diagnostics.edgeError < 0.03, `edgeError ${whole.diagnostics.edgeError}`);
  assert.equal(whole.diagnostics.rejected, undefined);

  // A finger over the bottom fifth: the rest looks like a coin tilted ~40°, which
  // would stretch crack lengths by ~30%. Only the outline gives it away.
  const covered = disc(200, 100, 100, 60);
  for (let i = 130 * 200 + 200; i < covered.data.length; i++) covered.data[i] = 0;
  const { reference, diagnostics } = circularReference(covered, { id: "coin", knownMm: 24.26, confidence: 0.95 });
  assert.ok(diagnostics.aspect > 0.7 && diagnostics.fill > 0.95);
  assert.match(diagnostics.rejected ?? "", /covered/);
  assert.equal(reference.confidence, 0);

  const session = measureSession({
    component: { id: "wall", areaPx: 40000, confidence: 0.93 },
    masks: [{ id: "crack-1", label: "crack", areaPx: 400, skeletonPx: 200, regionCount: 1, confidence: 0.9 }],
    scaleReference: reference,
  });
  assert.equal(session.mode, "percent-only");
});

test("a tilted coin and a small coin still pass the outline check", () => {
  // 30 degrees of tilt: an ellipse, rotated 25 degrees in the frame.
  const t = (25 * Math.PI) / 180;
  const tilted = fill(createMask(240, 240), (x, y) => {
    const u = (x - 120) * Math.cos(t) + (y - 120) * Math.sin(t);
    const v = -(x - 120) * Math.sin(t) + (y - 120) * Math.cos(t);
    return (u / 80) ** 2 + (v / (80 * Math.cos(Math.PI / 6))) ** 2 <= 1;
  });
  const leaning = circularReference(tilted, { id: "coin", knownMm: 24.26, confidence: 0.95 });
  assert.equal(leaning.diagnostics.rejected, undefined);
  assert.ok(Math.abs(leaning.reference.lengthPx - 161) < 2, `lengthPx ${leaning.reference.lengthPx}`);

  const small = circularReference(disc(60, 30, 30, 9), { id: "coin", knownMm: 24.26, confidence: 0.95 });
  assert.equal(small.diagnostics.rejected, undefined, `edgeError ${small.diagnostics.edgeError}`);
  assert.ok(small.reference.confidence > 0.8);
});

test("a coin mask that swallowed a lump of background is refused", () => {
  const coin = disc(200, 100, 100, 40);
  fill(coin, (x, y) => x >= 130 && x < 175 && y >= 90 && y < 110);
  const { diagnostics } = circularReference(coin, { id: "coin", knownMm: 24.26, confidence: 0.95 });
  assert.match(diagnostics.rejected ?? "", /misshapen/);
});

test("crack pieces that are blocky rather than long and thin are flagged", () => {
  const thin = fill(createMask(300, 120), (x, y) => x >= 20 && x < 280 && Math.abs(y - (30 + x / 10)) < 2);
  const clean = observeMask(thin, { id: "crack-1", label: "crack", confidence: 0.9 });
  assert.equal(clean.blockyRegionCount, undefined);

  // The same crack plus a stone block grabbed by a stray tap.
  fill(thin, (x, y) => x >= 200 && x < 280 && y >= 70 && y < 115);
  const mixed = observeMask(thin, { id: "crack-1", label: "crack", confidence: 0.9 });
  assert.equal(mixed.regionCount, 2);
  assert.equal(mixed.blockyRegionCount, 1);
  assert.equal(mixed.blockyAreaPx, 80 * 45);

  const stain = observeMask(thin, { id: "stain-1", label: "stain", confidence: 0.7 });
  assert.equal(stain.blockyRegionCount, undefined);
});

test("crack pieces with a ruler-straight edge are flagged; a wandering crack is not", () => {
  // A crack that wanders: centreline from a fixed pseudo-random walk, width 3 to 5 px.
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const centre: number[] = [];
  const width: number[] = [];
  let y = 40;
  for (let x = 0; x < 300; x++) {
    y += Math.round((rand() - 0.5) * 3);
    centre.push(y);
    width.push(1.5 + rand());
  }
  const wander = fill(createMask(300, 100), (x, yy) => x >= 20 && x < 280 && Math.abs(yy - centre[x]!) < width[x]!);
  const crack = observeMask(wander, { id: "crack-1", label: "crack", confidence: 0.9 });
  assert.equal(crack.straightRegionCount, undefined);

  // A ledge strip at 3 degrees, 12 px thick, with a ragged lower edge: one straight edge is enough.
  const t = (3 * Math.PI) / 180;
  const ledge = fill(createMask(300, 100), (x, yy) => {
    const u = (x - 150) * Math.cos(t) + (yy - 50) * Math.sin(t);
    const v = -(x - 150) * Math.sin(t) + (yy - 50) * Math.cos(t);
    return Math.abs(u) < 100 && v > 0 && v < 10 + 2 * Math.sin(x / 3) + (x % 7) / 3;
  });
  const strip = observeMask(ledge, { id: "crack-1", label: "crack", confidence: 0.9 });
  assert.equal(strip.straightRegionCount, 1);
  assert.equal(strip.blockyRegionCount, undefined, "long and thin, so only the edge test catches it");

  // Under 30 px along its axis the edge is not judged.
  const stub = fill(createMask(60, 60), (x, yy) => x >= 10 && x < 35 && yy >= 20 && yy < 24);
  assert.equal(observeMask(stub, { id: "crack-1", label: "crack", confidence: 0.9 }).straightRegionCount, undefined);
});
