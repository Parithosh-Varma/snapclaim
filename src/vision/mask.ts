import { MeasurementError } from "../engine/math.ts";

/**
 * A binary segmentation mask in row-major order. Any non-zero byte is "on".
 * This is the shape SAM masks are reduced to before any measuring happens.
 */
export interface BinaryMask {
  width: number;
  height: number;
  data: Uint8Array;
}

/** COCO run-length encoding as returned by SAM: column-major, runs start with zeros. */
export interface CocoRle {
  /** [height, width], COCO order. */
  size: [number, number];
  /** Uncompressed run lengths, or the compressed COCO string form. */
  counts: number[] | string;
}

export function createMask(width: number, height: number): BinaryMask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new MeasurementError(`mask size must be positive integers, got ${width}x${height}`);
  }
  return { width, height, data: new Uint8Array(width * height) };
}

export function assertMask(mask: BinaryMask, name = "mask"): void {
  if (mask.data.length !== mask.width * mask.height) {
    throw new MeasurementError(
      `${name} has ${mask.data.length} bytes but is declared ${mask.width}x${mask.height}`,
    );
  }
}

/** Builds a mask from rows of "#" (on) and "." (off). Handy for tests and fixtures. */
export function maskFromRows(rows: string[]): BinaryMask {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const mask = createMask(width, height);
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new MeasurementError(`row ${y} has length ${row.length}, expected ${width}`);
    }
    for (let x = 0; x < width; x++) {
      mask.data[y * width + x] = row[x] === "#" ? 1 : 0;
    }
  });
  return mask;
}

/** Decodes the compressed COCO counts string (the format pycocotools writes). */
function decodeCountsString(encoded: string): number[] {
  const counts: number[] = [];
  let p = 0;
  while (p < encoded.length) {
    let x = 0;
    let k = 0;
    let more = true;
    while (more) {
      if (p >= encoded.length) {
        throw new MeasurementError("truncated COCO RLE string");
      }
      const c = encoded.charCodeAt(p) - 48;
      x |= (c & 0x1f) << (5 * k);
      more = (c & 0x20) !== 0;
      p++;
      k++;
      if (!more && (c & 0x10) !== 0) {
        x |= -1 << (5 * k);
      }
    }
    if (counts.length > 2) {
      x += counts[counts.length - 2] as number;
    }
    counts.push(x);
  }
  return counts;
}

/** COCO RLE → row-major binary mask. Run totals must cover the image exactly. */
export function decodeRle(rle: CocoRle): BinaryMask {
  const [height, width] = rle.size;
  const mask = createMask(width, height);
  const counts = typeof rle.counts === "string" ? decodeCountsString(rle.counts) : rle.counts;

  let index = 0;
  let on = false;
  for (const run of counts) {
    if (!Number.isInteger(run) || run < 0) {
      throw new MeasurementError(`RLE run must be a non-negative integer, got ${run}`);
    }
    if (index + run > width * height) {
      throw new MeasurementError("RLE runs exceed the image size");
    }
    if (on) {
      for (let i = index; i < index + run; i++) {
        // Column-major index → row-major position.
        const x = Math.floor(i / height);
        const y = i % height;
        mask.data[y * width + x] = 1;
      }
    }
    index += run;
    on = !on;
  }
  if (index !== width * height) {
    throw new MeasurementError(`RLE covers ${index} pixels, image has ${width * height}`);
  }
  return mask;
}

export function maskArea(mask: BinaryMask): number {
  assertMask(mask);
  let area = 0;
  for (const value of mask.data) {
    if (value !== 0) area++;
  }
  return area;
}

/** Pixels on in both masks. Used to keep damage inside the component it is measured against. */
export function intersectMasks(a: BinaryMask, b: BinaryMask): BinaryMask {
  assertMask(a, "a");
  assertMask(b, "b");
  if (a.width !== b.width || a.height !== b.height) {
    throw new MeasurementError(`mask sizes differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const out = createMask(a.width, a.height);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = a.data[i] !== 0 && b.data[i] !== 0 ? 1 : 0;
  }
  return out;
}

export interface Region {
  areaPx: number;
  /** Row-major pixel indices belonging to this region. */
  pixels: Int32Array;
}

/** 8-connected regions, largest first. */
export function connectedRegions(mask: BinaryMask): Region[] {
  assertMask(mask);
  const { width, height, data } = mask;
  const seen = new Uint8Array(data.length);
  const stack = new Int32Array(data.length);
  const regions: Region[] = [];

  for (let start = 0; start < data.length; start++) {
    if (data[start] === 0 || seen[start] === 1) continue;

    const members: number[] = [];
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top] as number;
      members.push(i);
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
          const n = ny * width + nx;
          if (data[n] !== 0 && seen[n] === 0) {
            seen[n] = 1;
            stack[top++] = n;
          }
        }
      }
    }
    regions.push({ areaPx: members.length, pixels: Int32Array.from(members) });
  }

  return regions.sort((a, b) => b.areaPx - a.areaPx);
}

/** Mask holding only the given regions. */
export function maskFromRegions(width: number, height: number, regions: Region[]): BinaryMask {
  const out = createMask(width, height);
  for (const region of regions) {
    for (const i of region.pixels) out.data[i] = 1;
  }
  return out;
}

/**
 * Zhang–Suen thinning: reduces a crack mask to a one-pixel centreline.
 * Deterministic and dependency-free, so the same skeleton replays anywhere.
 */
export function skeletonize(mask: BinaryMask): BinaryMask {
  assertMask(mask);
  const { width, height } = mask;
  const img = Uint8Array.from(mask.data, (v) => (v !== 0 ? 1 : 0));
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : (img[y * width + x] as number);

  const toClear: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      toClear.length = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (img[y * width + x] === 0) continue;
          // P2..P9 clockwise from north.
          const p = [
            at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1),
            at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1),
          ] as [number, number, number, number, number, number, number, number];
          const neighbours = p.reduce((sum, v) => sum + v, 0);
          if (neighbours < 2 || neighbours > 6) continue;
          let transitions = 0;
          for (let k = 0; k < 8; k++) {
            if (p[k] === 0 && p[(k + 1) % 8] === 1) transitions++;
          }
          if (transitions !== 1) continue;
          const [p2, , p4, , p6, , p8] = p;
          const clear =
            step === 0
              ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0
              : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0;
          if (clear) toClear.push(y * width + x);
        }
      }
      for (const i of toClear) img[i] = 0;
      if (toClear.length > 0) changed = true;
    }
  }

  pruneStaircases(img, width, height);
  return { width, height, data: img };
}

const RING: Array<[number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

/**
 * Zhang–Suen leaves 4-connected staircases on diagonal lines, which would be
 * measured as 2 px per step instead of √2. Removes each staircase corner
 * (two perpendicular orthogonal neighbours) whose neighbours stay connected
 * without it, in place, so the line keeps its connectivity.
 */
function pruneStaircases(img: Uint8Array, width: number, height: number): void {
  const at = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && img[y * width + x] !== 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue;
      const n = at(x, y - 1);
      const e = at(x + 1, y);
      const s = at(x, y + 1);
      const w = at(x - 1, y);
      const orthogonal = Number(n) + Number(e) + Number(s) + Number(w);
      if (orthogonal !== 2 || (n && s) || (e && w)) continue;

      const neighbours = RING.filter(([dx, dy]) => at(x + dx, y + dy));
      // Flood the neighbours through each other only; one group means p is redundant.
      const reached = new Set<number>([0]);
      const queue = [0];
      while (queue.length > 0) {
        const [ax, ay] = neighbours[queue.pop() as number] as [number, number];
        neighbours.forEach(([bx, by], j) => {
          if (!reached.has(j) && Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1) {
            reached.add(j);
            queue.push(j);
          }
        });
      }
      if (reached.size === neighbours.length) img[y * width + x] = 0;
    }
  }
}

/** Kulpa (1977) link weights: unbiased length of a digitised line over all angles. */
export const ORTHOGONAL_LINK_PX = 0.948;
export const DIAGONAL_LINK_PX = 1.343;

/**
 * Length of a skeleton in pixels, from the links between neighbouring pixels,
 * weighted with Kulpa's coefficients (plain 1 and √2 overstate angled lines by
 * up to 8%). A diagonal link is skipped when an orthogonal path already joins
 * the two pixels, so L-shaped corners are not counted twice.
 */
export function skeletonLengthPx(skeleton: BinaryMask): number {
  assertMask(skeleton);
  const { width, height, data } = skeleton;
  const on = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] !== 0;

  let length = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!on(x, y)) continue;
      if (on(x + 1, y)) length += ORTHOGONAL_LINK_PX;
      if (on(x, y + 1)) length += ORTHOGONAL_LINK_PX;
      if (on(x + 1, y + 1) && !on(x + 1, y) && !on(x, y + 1)) length += DIAGONAL_LINK_PX;
      if (on(x - 1, y + 1) && !on(x - 1, y) && !on(x, y + 1)) length += DIAGONAL_LINK_PX;
    }
  }
  return length;
}

/** Copy of one region, cropped to its bounding box plus a one-pixel empty border. */
export function cropRegion(width: number, region: Region): BinaryMask {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of region.pixels) {
    const x = i % width;
    const y = Math.floor(i / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const out = createMask(maxX - minX + 3, maxY - minY + 3);
  for (const i of region.pixels) {
    out.data[(Math.floor(i / width) - minY + 1) * out.width + (i % width) - minX + 1] = 1;
  }
  return out;
}

/**
 * Largest distance from a mask pixel to the background, in pixels, from a
 * two-pass 3-4 chamfer transform (within 8% of Euclidean). Twice this is the
 * thickest point of the shape.
 */
export function maxInscribedRadiusPx(mask: BinaryMask): number {
  assertMask(mask);
  const { width, height } = mask;
  const dist = new Int32Array(width * height);
  const far = 1 << 28;
  const get = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : (dist[y * width + x] as number);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask.data[i] === 0) continue;
      dist[i] = Math.min(far, get(x - 1, y) + 3, get(x, y - 1) + 3, get(x - 1, y - 1) + 4, get(x + 1, y - 1) + 4);
    }
  }
  let best = 0;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (mask.data[i] === 0) continue;
      const d = Math.min(
        dist[i] as number,
        get(x + 1, y) + 3,
        get(x, y + 1) + 3,
        get(x + 1, y + 1) + 4,
        get(x - 1, y + 1) + 4,
      );
      dist[i] = d;
      if (d > best) best = d;
    }
  }
  return best / 3;
}
