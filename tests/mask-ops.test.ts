import { strict as assert } from "node:assert";
import { test } from "node:test";
import { closeMask, unionMasks } from "../pwa/mask-ops.js";
import { connectedRegions } from "../src/vision/mask.ts";

function maskWith(w: number, h: number, pts: [number, number][]): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const [x, y] of pts) m[y * w + x] = 1;
  return m;
}

test("closeMask bridges hairline gaps so one crack reads as one region", () => {
  const w = 40;
  const h = 20;
  // A horizontal crack with two 3px gaps — SAM on textured stone looks like this.
  const pts: [number, number][] = [];
  for (let x = 4; x < 36; x++) if (!(x >= 14 && x < 17) && !(x >= 24 && x < 27)) pts.push([x, 10], [x, 11]);
  const fragmented = maskWith(w, h, pts);
  const regionsBefore = connectedRegions({ width: w, height: h, data: fragmented }).length;
  assert.equal(regionsBefore, 3, "fixture starts as three fragments");

  const closed = closeMask(fragmented, w, h, 2);
  const regionsAfter = connectedRegions({ width: w, height: h, data: closed });
  assert.equal(regionsAfter.length, 1, "gaps bridged into a single region");
  assert.equal(closed[10 * w + 15], 1, "gap pixel filled");
});

test("closeMask does not grow a solid block", () => {
  const w = 30;
  const h = 30;
  const pts: [number, number][] = [];
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) pts.push([x, y]);
  const block = maskWith(w, h, pts);
  const closed = closeMask(block, w, h, 2);
  const area = closed.reduce((n, v) => n + v, 0);
  assert.equal(area, 100, "dilate+erode restores the original outline");
});

test("closeMask leaves distant fragments separate and honours radius 0", () => {
  const w = 40;
  const h = 20;
  const pts: [number, number][] = [];
  for (let x = 4; x < 10; x++) pts.push([x, 10]);
  for (let x = 30; x < 36; x++) pts.push([x, 10]);
  const two = maskWith(w, h, pts);
  assert.equal(connectedRegions({ width: w, height: h, data: closeMask(two, w, h, 2) }).length, 2);
  assert.deepEqual(closeMask(two, w, h, 0), two);
});

test("unionMasks merges SAM records and handles the empty case", () => {
  const a = maskWith(4, 2, [[0, 0], [1, 0]]);
  const b = maskWith(4, 2, [[1, 0], [3, 1]]);
  const u = unionMasks([a, b]);
  assert.deepEqual(Array.from(u ?? []), Array.from(maskWith(4, 2, [[0, 0], [1, 0], [3, 1]])));
  assert.equal(unionMasks([]), null);
});
