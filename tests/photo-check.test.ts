import { strict as assert } from "node:assert";
import { test } from "node:test";
import { checkPhoto, laplacianVariance } from "../pwa/photo-check.js";

function gray(w: number, h: number, fn: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

test("sharp edges score far above blurred ones", () => {
  const sharp = gray(32, 32, (x) => (x < 16 ? 0 : 255));
  const soft = gray(32, 32, (x) => Math.max(0, Math.min(255, Math.round(((x - 13) * 255) / 6))));
  assert.ok(laplacianVariance(sharp) > 10 * laplacianVariance(soft));
  assert.deepEqual(checkPhoto(sharp), []);
  assert.ok(checkPhoto(soft).some((note: string) => note.includes("blurry")));
});

test("dark, bright and tiny photos get actionable notes", () => {
  const dark = gray(16, 16, () => 10);
  assert.ok(checkPhoto(dark).some((note: string) => note.includes("dark")));
  const bright = gray(16, 16, () => 250);
  assert.ok(checkPhoto(bright).some((note: string) => note.includes("blown out")));
  const checker = gray(64, 64, (x, y) => ((x + y) % 2 ? 0 : 255));
  assert.ok(checkPhoto(checker, 400).some((note: string) => note.includes("low resolution")));
  assert.deepEqual(checkPhoto(checker, 2000).filter((n: string) => n.includes("resolution")), []);
});

test("unreadable input fails with words, not a crash", () => {
  assert.ok(checkPhoto({ width: 0, height: 0, data: new Uint8ClampedArray(0) })[0]?.includes("Could not read"));
});
