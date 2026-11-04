// COCO RLE encode/decode. Matches src/vision/mask.ts: size [h, w],
// column-major runs (index i -> x = floor(i/h), y = i%h), first run counts zeros.
export interface Rle {
  size: [number, number];
  counts: number[];
}

// Same pixel budget as the backend (src/vision/mask.ts MAX_MASK_PIXELS): a
// compromised allowlisted backend must not be able to OOM the tab with a
// 20000x20000 size header (~400MB allocation from one JSON reply).
export const MAX_RLE_PIXELS = 16777216;

/** Decodes one COCO RLE into a row-major Uint8Array of 0/1. */
export function decodeRle(rle: Rle): Uint8Array {
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
  let i = 0;
  let v = 0;
  for (const run of rle.counts) {
    for (let k = 0; k < run; k++, i++) {
      if (v) out[(i % h) * w + Math.floor(i / h)] = 1;
    }
    v = 1 - v;
  }
  return out;
}

/** Encodes a row-major 0/1 mask into COCO RLE. */
export function encodeRle(mask: Uint8Array, w: number, h: number): Rle {
  const counts: number[] = [];
  let cur = 0;
  let run = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const v = mask[y * w + x] ? 1 : 0;
      if (v === cur) run++;
      else {
        counts.push(run);
        cur = v;
        run = 1;
      }
    }
  }
  counts.push(run);
  return { size: [h, w], counts };
}

/** Filled circle as RLE (the coin gate's scale reference). */
export function circleRle(cx: number, cy: number, r: number, w: number, h: number): Rle {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) mask[y * w + x] = 1;
    }
  }
  return encodeRle(mask, w, h);
}
