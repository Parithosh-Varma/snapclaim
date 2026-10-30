// COCO RLE encode/decode. Matches src/vision/mask.ts: size [h, w],
// column-major runs (index i -> x = floor(i/h), y = i%h), first run counts zeros.
export interface Rle {
  size: [number, number];
  counts: number[];
}

/** Decodes one COCO RLE into a row-major Uint8Array of 0/1. */
export function decodeRle(rle: Rle): Uint8Array {
  const [h, w] = rle.size;
  const out = new Uint8Array(h * w);
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
