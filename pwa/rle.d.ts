export interface CocoRleLike {
  size: [number, number];
  counts: number[] | string;
}

/** Decodes one COCO RLE into a row-major Uint8Array of 0/1. */
export function decodeRle(rle: CocoRleLike): Uint8Array;
