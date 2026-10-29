import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodeRle } from "../pwa/rle.js";
import { encodeRle } from "../src/vision/mask.ts";

test("pwa rle decode matches the backend encoder (round-trip)", () => {
  const w = 9, h = 7;
  const mask = { width: w, height: h, data: Uint8Array.from({ length: w * h }, (_, i) => ((i * 2654435761) >>> 8) % 3 === 0 ? 1 : 0) };
  const decoded = decodeRle(encodeRle(mask));
  assert.deepEqual(Array.from(decoded), Array.from(mask.data));
});

test("pwa rle decode handles empty and full masks", () => {
  assert.deepEqual(Array.from(decodeRle({ size: [3, 4], counts: [12] })), new Array(12).fill(0));
  assert.deepEqual(Array.from(decodeRle({ size: [3, 4], counts: [0, 12] })), new Array(12).fill(1));
});

test("pwa segment tries the SAM API first, worker stays the fallback", () => {
  const app = readFileSync(new URL("../pwa/app.js", import.meta.url), "utf8");
  assert.ok(app.includes('"/v1/segment"') || app.includes("'/v1/segment'"), "app calls /v1/segment");
  assert.ok(app.includes("segmentViaApi"), "app has an API segment path");
  assert.ok(app.includes("sam-worker") || app.includes("samWorker"), "worker fallback still wired");
  assert.ok(app.includes("on-device"), "fallback source is labeled honestly");
});
