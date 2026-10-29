// COCO RLE decode, shared by the PWA and the test suite. Plain JS, no imports.
// Matches src/vision/mask.ts decodeRle: size [h, w], column-major runs
// (index i -> x = floor(i/h), y = i%h), first run counts zeros.

/** Decodes one COCO RLE into a row-major Uint8Array of 0/1. */
export function decodeRle(rle) {
  const [h, w] = rle.size;
  const out = new Uint8Array(h * w);
  let i = 0, v = 0;
  for (const run of rle.counts) {
    for (let k = 0; k < run; k++, i++) {
      if (v) out[(i % h) * w + Math.floor(i / h)] = 1;
    }
    v = 1 - v;
  }
  return out;
}
