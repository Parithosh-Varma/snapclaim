import { strict as assert } from "node:assert";
import { test } from "node:test";
import { checkPhoto, coinPrecision } from "../pwa/photo-check.js";

const W = 800;
const H = 600;

/** A plaster wall: seeded speckle and soft blotches, a dark crack, scaled by `gain` and lifted by `lift`. */
function wall(gain = 1, lift = 0) {
  let seed = 11;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const gray = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 150 + 25 * Math.sin(x / 37) * Math.cos(y / 53) + (rand() - 0.5) * 60;
      if (Math.abs(y - (0.4 * x + 150)) < 2 && x > 150 && x < 650) v = 40;
      gray[y * W + x] = v * gain + lift;
    }
  }
  return gray;
}

/** Box blur, `passes` times (three passes is close to a Gaussian of σ ≈ radius). */
function blurred(gray: Float32Array, radius: number, passes = 3): Float32Array {
  let cur = gray;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(cur.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        let n = 0;
        for (let d = -radius; d <= radius; d++) {
          const xx = Math.min(W - 1, Math.max(0, x + d));
          s += cur[y * W + xx]!;
          n++;
        }
        next[y * W + x] = s / n;
      }
    }
    const out = new Float32Array(cur.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        let n = 0;
        for (let d = -radius; d <= radius; d++) {
          const yy = Math.min(H - 1, Math.max(0, y + d));
          s += next[yy * W + x]!;
          n++;
        }
        out[y * W + x] = s / n;
      }
    }
    cur = out;
  }
  return cur;
}

function rgba(gray: Float32Array) {
  const data = new Uint8ClampedArray(W * H * 4);
  gray.forEach((v, i) => {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  return { data, width: W, height: H };
}

test("a sharp, well-lit wall passes", () => {
  const result = checkPhoto(rgba(wall()));
  assert.deepEqual(result.warnings, [], JSON.stringify(result));
});

test("a blurred wall is flagged as blurry", () => {
  const result = checkPhoto(rgba(blurred(wall(), 4)));
  assert.equal(result.warnings.length, 1, JSON.stringify(result));
  assert.match(result.warnings[0]!, /blurry/);
});

test("a dark photo is flagged as too dark, not blurry", () => {
  const result = checkPhoto(rgba(wall(0.2)));
  assert.equal(result.warnings.length, 1, JSON.stringify(result));
  assert.match(result.warnings[0]!, /too dark/);
});

test("a blown-out photo is flagged", () => {
  const result = checkPhoto(rgba(wall(1, 120)));
  assert.ok(result.clipped > 0.15);
  assert.ok(result.warnings.some((w) => /blown out/.test(w)), JSON.stringify(result));
});

test("a featureless photo (lens cap, blank wall far out of focus) is flagged", () => {
  const result = checkPhoto(rgba(new Float32Array(W * H).fill(140)));
  assert.match(result.warnings.join(" "), /blurry/);
});

function discMask(r: number): Uint8Array {
  const size = 2 * r + 4;
  const mask = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - size / 2) ** 2 + (y - size / 2) ** 2 <= r * r) mask[y * size + x] = 1;
    }
  }
  return mask;
}

test("a small coin warns how far off the millimetres may be", () => {
  const small = coinPrecision(discMask(20));
  assert.ok(Math.abs(small.diameterPx - 40) < 1.5, JSON.stringify(small));
  assert.ok(Math.abs(small.scaleErrorPercent - 2.5) < 0.1);
  assert.match(small.warning ?? "", /±2\.5%/);
});

test("a coin big enough in frame gives no warning", () => {
  const big = coinPrecision(discMask(60));
  assert.equal(big.warning, undefined);
  assert.ok(big.scaleErrorPercent < 1);
});
