// COCO RLE decode, shared by the PWA and the test suite. Plain JS, no imports.
// Matches src/vision/mask.ts decodeRle: size [h, w], column-major runs
// (index i -> x = floor(i/h), y = i%h), first run counts zeros.

// Same pixel budget as the backend (src/vision/mask.ts MAX_MASK_PIXELS): a
// compromised allowlisted backend must not be able to OOM the tab with a
// 20000x20000 size header (~400MB allocation from one JSON reply).
export const MAX_RLE_PIXELS = 16777216;

/** Decodes one COCO RLE into a row-major Uint8Array of 0/1. */
export function decodeRle(rle) {
  const [h, w] = rle.size;
  if (!Number.isInteger(h) || !Number.isInteger(w) || h <= 0 || w <= 0) {
    throw new Error("rle.size must be [height, width] positive integers");
  }
  if (h * w > MAX_RLE_PIXELS) {
    throw new Error(`rle ${h}x${w} exceeds the ${MAX_RLE_PIXELS}-pixel cap`);
  }
  if (!Array.isArray(rle.counts)) {
    throw new Error("rle.counts must be an array");
  }
  const total = h * w;
  let sum = 0;
  for (const run of rle.counts) {
    if (!Number.isInteger(run) || run < 0) {
      throw new Error("rle run must be a non-negative integer");
    }
    sum += run;
    if (sum > total) {
      throw new Error("rle runs exceed the image size");
    }
  }
  if (sum !== total) {
    throw new Error(`rle covers ${sum} pixels, image has ${total}`);
  }
  const out = new Uint8Array(total);
  let i = 0, v = 0;
  for (const run of rle.counts) {
    for (let k = 0; k < run; k++, i++) {
      if (v) out[(i % h) * w + Math.floor(i / h)] = 1;
    }
    v = 1 - v;
  }
  return out;
}
