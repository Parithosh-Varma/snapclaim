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

/**
 * Undoes the foreshortening of a tilted surface: lengths along `angle`
 * (radians from +x, y pointing down) are multiplied by `factor`, lengths
 * across it are kept. From a coin's ellipse, `angle` is its minor axis and
 * `factor` is 1 / aspect.
 */
export interface PlaneStretch {
  angle: number;
  factor: number;
}

/**
 * The mask as it would look shot straight on: resampled onto
 * a grid stretched by `factor` along `angle`, bilinear and thresholded at one half. Measuring the resampled mask
 * keeps the skeleton and its link weights exact; stretching each link of the
 * original skeleton instead overstates stair-stepped lines by up to 13%.
 */
export function rectifyMask(mask: BinaryMask, stretch: PlaneStretch): BinaryMask {
  assertMask(mask);
  const nx = Math.cos(stretch.angle);
  const ny = Math.sin(stretch.angle);
  const forward = (x: number, y: number): [number, number] => {
    const along = (stretch.factor - 1) * (x * nx + y * ny);
    return [x + along * nx, y + along * ny];
  };
  const corners = [forward(0, 0), forward(mask.width, 0), forward(0, mask.height), forward(mask.width, mask.height)];
  const minX = Math.min(...corners.map((c) => c[0]));
  const minY = Math.min(...corners.map((c) => c[1]));
  const width = Math.ceil(Math.max(...corners.map((c) => c[0])) - minX);
  const height = Math.ceil(Math.max(...corners.map((c) => c[1])) - minY);
  const out = createMask(width, height);
  const back = 1 / stretch.factor - 1;
  const at = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.data[y * mask.width + x] !== 0 ? 1 : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Output pixel centre → original image, then the pixel that contains it.
      const ox = x + 0.5 + minX;
      const oy = y + 0.5 + minY;
      const along = back * (ox * nx + oy * ny);
      // Bilinear between pixel centres, kept at ≥ 0.5: nearest-pixel sampling
      // leaves stair steps on oblique edges that sprout skeleton spurs.
      const fx = ox + along * nx - 0.5;
      const fy = oy + along * ny - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const value =
        (1 - tx) * (1 - ty) * at(x0, y0) + tx * (1 - ty) * at(x0 + 1, y0) + (1 - tx) * ty * at(x0, y0 + 1) + tx * ty * at(x0 + 1, y0 + 1);
      if (value >= 0.5) out.data[y * width + x] = 1;
    }
  }
  return out;
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

function lineFitRmsPx(us: number[], vs: number[]): number {
  const n = us.length;
  const mu = us.reduce((a, b) => a + b, 0) / n;
  const mv = vs.reduce((a, b) => a + b, 0) / n;
  let suv = 0;
  let suu = 0;
  for (let k = 0; k < n; k++) {
    suv += ((us[k] as number) - mu) * ((vs[k] as number) - mv);
    suu += ((us[k] as number) - mu) ** 2;
  }
  const slope = suu === 0 ? 0 : suv / suu;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += ((vs[k] as number) - mv - slope * ((us[k] as number) - mu)) ** 2;
  return Math.sqrt(sum / n);
}

/**
 * How close a region's straighter long edge is to a line: RMS distance in pixels
 * of that edge from its best-fit line, over the middle 80% of the region's
 * length (the ends are rounded on any shape). Built things such as ledges, frames
 * and joints have at least one edge near 0.5 px; a crack's edges are
 * both ragged. Null when the region is shorter than `minLengthPx` along its axis.
 */
export function straightestEdgeRmsPx(width: number, region: Region, minLengthPx = 30): number | null {
  const n = region.areaPx;
  let sumX = 0;
  let sumY = 0;
  for (const i of region.pixels) {
    sumX += i % width;
    sumY += Math.floor(i / width);
  }
  const cx = sumX / n;
  const cy = sumY / n;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const i of region.pixels) {
    const dx = (i % width) - cx;
    const dy = Math.floor(i / width) - cy;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Per 1 px step along the main axis, the extreme offsets across it: the two edges.
  const low = new Map<number, number>();
  const high = new Map<number, number>();
  for (const i of region.pixels) {
    const dx = (i % width) - cx;
    const dy = Math.floor(i / width) - cy;
    const u = Math.round(dx * cos + dy * sin);
    const v = -dx * sin + dy * cos;
    if (!(v >= (low.get(u) ?? Infinity))) low.set(u, v);
    if (!(v <= (high.get(u) ?? -Infinity))) high.set(u, v);
  }
  const steps = [...low.keys()].sort((a, b) => a - b);
  if (steps.length < minLengthPx) return null;
  const cut = Math.floor(steps.length * 0.1);
  const us = steps.slice(cut, steps.length - cut);
  return Math.min(
    lineFitRmsPx(us, us.map((u) => low.get(u) as number)),
    lineFitRmsPx(us, us.map((u) => high.get(u) as number)),
  );
}
