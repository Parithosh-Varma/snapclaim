import { strict as assert } from "node:assert";
import { test } from "node:test";
import { contoursToSvgPath, maskOutlinePath, simplifyContour, traceContours } from "../src/vision/contour.ts";
import { type BinaryMask, createMask, maskFromRows } from "../src/vision/mask.ts";

test("a single pixel traces its four corners", () => {
  const loops = traceContours(maskFromRows(["#"]));
  assert.deepEqual(loops, [[[0, 0], [1, 0], [1, 1], [0, 1]]]);
  assert.equal(contoursToSvgPath(loops), "M 0 0 L 1 0 L 1 1 L 0 1 Z");
});

test("a filled rectangle merges collinear vertices", () => {
  const loops = traceContours(maskFromRows(["###", "###"]));
  assert.deepEqual(loops, [[[0, 0], [3, 0], [3, 2], [0, 2]]]);
});

test("a ring yields an outer loop and a hole", () => {
  const loops = traceContours(maskFromRows(["###", "#.#", "###"]));
  assert.equal(loops.length, 2);
  assert.deepEqual(loops[0], [[0, 0], [3, 0], [3, 3], [0, 3]]);
  assert.equal(loops[1]!.length, 4);
  assert.deepEqual(loops[1]![0], [1, 1]);
  assert.equal(contoursToSvgPath(loops).split("M").length - 1, 2);
});

test("an L shape has six corners", () => {
  const loops = traceContours(maskFromRows(["#..", "#..", "###"]));
  assert.deepEqual(loops, [[[0, 0], [1, 0], [1, 2], [3, 2], [3, 3], [0, 3]]]);
});

test("separate regions are separate loops in top-left order", () => {
  const loops = traceContours(maskFromRows(["#...", "....", "..##"]));
  assert.equal(loops.length, 2);
  assert.deepEqual(loops[0]![0], [0, 0]);
  assert.deepEqual(loops[1]![0], [2, 2]);
});

test("diagonal-touching pixels stay separate loops", () => {
  const loops = traceContours(maskFromRows(["#.", ".#"]));
  assert.deepEqual(loops, [
    [[0, 0], [1, 0], [1, 1], [0, 1]],
    [[1, 1], [2, 1], [2, 2], [1, 2]],
  ]);
});

test("a staircase collapses under tolerance", () => {
  const loop = traceContours(maskFromRows(["#....", "##...", "###..", "####.", "#####"]))[0]!;
  assert.ok(loop.length > 6);
  const simple = simplifyContour(loop, 1);
  assert.ok(simple.length < loop.length);
  assert.ok(simple.length >= 3);
  assert.equal(simplifyContour(loop, 0), loop);
  assert.deepEqual(simplifyContour(loop, 100), []);
});

test("output is deterministic and empty masks give nothing", () => {
  const rows = ["##.#", "#..#", "####"];
  const opts = { tolerance: 0.5, scale: 2.5 };
  assert.equal(maskOutlinePath(maskFromRows(rows), opts), maskOutlinePath(maskFromRows(rows), opts));
  assert.deepEqual(traceContours(createMask(4, 4)), []);
  assert.equal(maskOutlinePath(createMask(4, 4)), "");
});

test("scale rounds to two decimals without trailing zeros", () => {
  assert.equal(contoursToSvgPath([[[1, 1], [2, 1], [2, 2]]], 0.3333), "M 0.33 0.33 L 0.67 0.33 L 0.67 0.67 Z");
});

test("a long staircase simplifies without overflowing the stack", () => {
  const n = 3000;
  const mask: BinaryMask = createMask(n + 1, n);
  for (let i = 0; i < n; i++) {
    mask.data[i * (n + 1) + i] = 1;
    mask.data[i * (n + 1) + i + 1] = 1;
  }
  const loop = traceContours(mask)[0]!;
  assert.ok(loop.length > 10000);
  for (const tol of [0.3, 1]) {
    const simple = simplifyContour(loop, tol);
    assert.ok(simple.length >= 3);
    assert.ok(simple.length <= loop.length);
  }
  assert.ok(simplifyContour(loop, 1).length < loop.length);
});

test("tolerance below half a pixel leaves the loop untouched", () => {
  const loop = traceContours(maskFromRows(["#....", "##...", "###.."]))[0]!;
  assert.equal(simplifyContour(loop, 0.4), loop);
});

test("a loop that collapses is dropped", () => {
  const thin: [number, number][] = [[0, 0], [10, 0], [10, 0.2], [0, 0.2]];
  assert.deepEqual(simplifyContour(thin, 1), []);
  const mask = maskFromRows(["#....", "##...", "###..", "####.", "#####"]);
  assert.equal(maskOutlinePath(mask, { tolerance: 100 }), "");
});

test("a mask touching the image edge closes on the border", () => {
  assert.deepEqual(traceContours(maskFromRows(["##", "##"])), [[[0, 0], [2, 0], [2, 2], [0, 2]]]);
});

test("simplification keeps detail near the start and end wrap", () => {
  const loop: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [-3, 5]];
  const simple = simplifyContour(loop, 1);
  assert.deepEqual(simple[0], [0, 0]);
  assert.deepEqual(simple[simple.length - 1], [-3, 5]);
  assert.equal(simple.length, 5);
});
