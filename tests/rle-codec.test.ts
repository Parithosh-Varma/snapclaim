import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodeRle, encodeRle } from "../react/src/lib/rle.ts";

test("rle decode matches the backend encoder (round-trip)", () => {
  const w = 9, h = 7;
  const data = Uint8Array.from({ length: w * h }, (_, i) => ((i * 2654435761) >>> 8) % 3 === 0 ? 1 : 0);
  const decoded = decodeRle(encodeRle(data, w, h));
  assert.deepEqual(Array.from(decoded), Array.from(data));
});

test("rle decode handles empty and full masks", () => {
  assert.deepEqual(Array.from(decodeRle({ size: [3, 4], counts: [12] })), new Array(12).fill(0));
  assert.deepEqual(Array.from(decodeRle({ size: [3, 4], counts: [0, 12] })), new Array(12).fill(1));
});

test("segment tries the SAM API first, worker stays the fallback", () => {
  const sam = readFileSync(new URL("../react/src/lib/sam.ts", import.meta.url), "utf8");
  assert.ok(sam.includes('"/v1/segment"'), "client calls /v1/segment");
  assert.ok(/worker/i.test(sam), "worker fallback still wired");
  assert.ok(sam.includes("on-device"), "fallback source is labeled honestly");
});
