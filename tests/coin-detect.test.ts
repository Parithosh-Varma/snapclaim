import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { findCoins } from "../src/vision/coin-detect.js";

type Paint = (x: number, y: number) => number | undefined;

/** A grey wall with seeded noise; each painter may return a brightness for its pixels. */
function scene(width: number, height: number, ...painters: Paint[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 24;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 170 + 20 * Math.sin(x / 90) + noise();
      for (const paint of painters) v = paint(x, y) ?? v;
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

const disc = (cx: number, cy: number, r: number, shade: number, aspect = 1): Paint => (x, y) =>
  ((x - cx) / r) ** 2 + ((y - cy) / (r * aspect)) ** 2 <= 1 ? shade + 10 * Math.sin((x + y) / 3) : undefined;
const crack: Paint = (x, y) => (Math.abs(y - (0.35 * x + 120)) < 2.5 && x > 200 && x < 700 ? 60 : undefined);
const square = (x0: number, y0: number, s: number): Paint => (x, y) =>
  x >= x0 && x < x0 + s && y >= y0 && y < y0 + s ? 90 : undefined;

test("finds a light coin beside a crack, at its centre", () => {
  const coins = findCoins(scene(800, 600, crack, disc(560, 420, 34, 225)));
  assert.ok(coins.length >= 1);
  const best = coins[0]!;
  assert.ok(Math.hypot(best.x - 560, best.y - 420) <= 4, JSON.stringify(best));
  assert.ok(Math.abs(best.r - 34) <= 5, JSON.stringify(best));
});

test("finds a dark coin on a light wall", () => {
  const best = findCoins(scene(800, 600, crack, disc(150, 450, 28, 70)))[0];
  assert.ok(best && Math.hypot(best.x - 150, best.y - 450) <= 4, JSON.stringify(best));
});

test("finds a tilted coin's centre (an ellipse)", () => {
  const best = findCoins(scene(800, 600, crack, disc(560, 420, 40, 225, 0.65)))[0];
  assert.ok(best && Math.hypot(best.x - 560, best.y - 420) <= 5, JSON.stringify(best));
});

test("finds nothing round in a wall with only a crack and a square", () => {
  assert.deepEqual(findCoins(scene(800, 600, crack, square(500, 350, 70))), []);
});

test("the coin beats a square when both are in the photo", () => {
  const best = findCoins(scene(800, 600, crack, square(100, 380, 70), disc(560, 420, 34, 225)))[0];
  assert.ok(best && Math.hypot(best.x - 560, best.y - 420) <= 4, JSON.stringify(best));
});

test("finds a low-contrast coin on a dull photo", () => {
  // Wall 170, coin 186: a 16-level rim a fixed threshold would miss entirely.
  const best = findCoins(scene(800, 600, crack, disc(560, 420, 34, 186)))[0];
  assert.ok(best && Math.hypot(best.x - 560, best.y - 420) <= 5, JSON.stringify(best));
});

test("finds the centre through a tape halo", () => {
  // Taped coin: faint larger ring (the tape edge) around the true rim.
  const halo = (x: number, y: number) => {
    const d = Math.hypot(x - 560, y - 420);
    if (d <= 34) return 225 + 10 * Math.sin((x + y) / 3);
    if (d <= 52) return 190;
    return undefined;
  };
  const best = findCoins(scene(800, 600, crack, halo))[0];
  assert.ok(best && Math.hypot(best.x - 560, best.y - 420) <= 6, JSON.stringify(best));
});

test("the detector is plain browser JS with no imports", () => {
  const source = readFileSync(new URL("../src/vision/coin-detect.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^\s*import\s/m);
});
