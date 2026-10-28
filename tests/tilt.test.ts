import { strict as assert } from "node:assert";
import { test } from "node:test";
import { observeBody } from "../backend/app.ts";
import { calibratedLengthMm } from "../src/engine/math.ts";
import { type BinaryMask, createMask } from "../src/vision/mask.ts";
import { MIN_COIN_ASPECT, circularReference, observeMask, tiltStretch } from "../src/vision/observe.ts";

const SIZE = 400;

/**
 * A wall photographed at an angle: points on the wall (in straight-on pixels,
 * centred on the photo) are squashed by `aspect` along the unit vector at `angle`.
 * Each photo pixel is mapped back onto the wall and tested there.
 */
function photographed(aspect: number, angleDeg: number, onWall: (u: number, v: number) => boolean): BinaryMask {
  const nx = Math.cos((angleDeg * Math.PI) / 180);
  const ny = Math.sin((angleDeg * Math.PI) / 180);
  const mask = createMask(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = x - SIZE / 2;
      const py = y - SIZE / 2;
      const along = (1 / aspect - 1) * (px * nx + py * ny);
      if (onWall(px + along * nx, py + along * ny)) mask.data[y * SIZE + x] = 1;
    }
  }
  return mask;
}

/** A 3 px wide straight crack on the wall, `lengthPx` long at `deg` through (u0, v0). */
function crack(u0: number, v0: number, lengthPx: number, deg: number) {
  const dx = Math.cos((deg * Math.PI) / 180);
  const dy = Math.sin((deg * Math.PI) / 180);
  return (u: number, v: number) => {
    const t = (u - u0) * dx + (v - v0) * dy;
    const d = Math.abs(-(u - u0) * dy + (v - v0) * dx);
    return t >= -lengthPx / 2 && t <= lengthPx / 2 && d <= 1.5;
  };
}

const coin = (u: number, v: number) => (u + 110) ** 2 + (v + 110) ** 2 <= 40 * 40;
const COIN = { id: "coin", knownMm: 24.26, confidence: 0.95 };

function toRle(mask: BinaryMask): { size: [number, number]; counts: number[] } {
  const counts: number[] = [];
  let run = 0;
  let on = false;
  for (let x = 0; x < mask.width; x++) {
    for (let y = 0; y < mask.height; y++) {
      if ((mask.data[y * mask.width + x] !== 0) !== on) {
        counts.push(run);
        run = 0;
        on = !on;
      }
      run++;
    }
  }
  counts.push(run);
  return { size: [mask.height, mask.width], counts };
}

for (const [aspect, angleDeg, crackDeg] of [
  [0.7, 90, 30],
  [0.6, 20, 40],
  [0.8, 135, 120],
] as const) {
  test(`a crack on a wall tilted to aspect ${aspect} measures as if shot straight on`, () => {
    const tiltedMask = photographed(aspect, angleDeg, crack(40, 30, 220, crackDeg));

    const { diagnostics } = circularReference(photographed(aspect, angleDeg, coin), COIN);
    assert.equal(diagnostics.rejected, undefined);
    assert.ok(Math.abs(diagnostics.aspect - aspect) < 0.02, `aspect ${diagnostics.aspect}`);
    const stretch = tiltStretch(diagnostics);
    assert.ok(stretch !== undefined);

    const naive = observeMask(tiltedMask, { id: "c", label: "crack", confidence: 0.9 });
    const corrected = observeMask(tiltedMask, { id: "c", label: "crack", confidence: 0.9, stretch });
    // Against the true 220 px: the skeleton's own angle bias is up to ~5%, so
    // a straight-on baseline at a different angle would not be a fair target.
    const err = (o: { skeletonPx?: number }) => Math.abs(o.skeletonPx! / 220 - 1);
    assert.ok(err(corrected) < 0.04, `corrected ${corrected.skeletonPx} vs true 220`);
    assert.ok(err(naive) > err(corrected), `naive ${naive.skeletonPx} should be further off`);
  });
}

test("a tilted coin keeps its confidence instead of dropping the report to percent-only", () => {
  const { reference, diagnostics } = circularReference(photographed(0.6, 90, coin), COIN);
  assert.ok(Math.abs(diagnostics.tiltDeg - 53.1) < 1.5, `tilt ${diagnostics.tiltDeg}`);
  assert.ok(reference.confidence > 0.9, `confidence ${reference.confidence}`);
  assert.ok(calibratedLengthMm(100, reference) !== null);
});

test("a coin tilted past the limit is refused with a reason", () => {
  const { reference, diagnostics } = circularReference(photographed(MIN_COIN_ASPECT - 0.08, 90, coin), COIN);
  assert.equal(reference.confidence, 0);
  assert.match(diagnostics.rejected ?? "", /tilted too far/);
  assert.equal(tiltStretch(diagnostics), undefined);
});

test("a coin seen straight on applies no correction", () => {
  const { diagnostics } = circularReference(photographed(1, 0, coin), COIN);
  assert.ok(diagnostics.tiltDeg < 12);
  assert.equal(tiltStretch(diagnostics), undefined);
});

test("/v1/observe corrects crack length with the coin's tilt", () => {
  const crackMask = photographed(0.65, 90, crack(40, 30, 220, 60));
  const coinMask = photographed(0.65, 90, coin);
  const body = (withCoin: boolean) => ({
    masks: [{ id: "crack-1", label: "crack", confidence: 0.9, rle: toRle(crackMask) }],
    ...(withCoin ? { reference: { ...COIN, rle: toRle(coinMask) } } : {}),
  });
  const result = (withCoin: boolean) =>
    (observeBody(body(withCoin)) as unknown as { result: { masks: { skeletonPx: number }[]; referenceCheck?: { tiltDeg: number } } })
      .result;
  const corrected = result(true);
  assert.ok(corrected.referenceCheck!.tiltDeg > 45);
  assert.ok(Math.abs(corrected.masks[0]!.skeletonPx / 220 - 1) < 0.04, `corrected ${corrected.masks[0]!.skeletonPx}`);
  assert.ok(result(false).masks[0]!.skeletonPx < 0.85 * 220);
});
