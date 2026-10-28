import { MeasurementError } from "../engine/math.ts";
import { type BinaryMask, assertMask } from "./mask.ts";

/** A vertex on the pixel-corner lattice, [x, y]. */
export type Point = [number, number];

// Directions in screen coordinates: 0 east, 1 south, 2 west, 3 north.
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
// Successor preference at a vertex: right turn, straight, left turn.
const TURN_ORDER = [1, 0, 3];

/**
 * Trace exact crack edges of a mask into closed loops on the pixel-corner lattice.
 * Edges run with the on pixel on their right, so outer boundaries are clockwise
 * (on screen) and holes counter-clockwise. Diagonal-touch rule: two on pixels that
 * meet only at a corner are NOT connected; at such a vertex the trace always turns
 * right (hugging the pixel it came from), so loops touch but never cross.
 * Loops are sorted by first vertex (y, then x); each starts at its top-left vertex.
 */
export function traceContours(mask: BinaryMask): Point[][] {
  assertMask(mask);
  const { width, height, data } = mask;
  const stride = width + 1;
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] !== 0;

  // Bit d of edges[v] is set when an edge leaves vertex v in direction d.
  const edges = new Uint8Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) edges[y * stride + x]! |= 1; // top edge, east
      if (!on(x + 1, y)) edges[y * stride + x + 1]! |= 2; // right edge, south
      if (!on(x, y + 1)) edges[(y + 1) * stride + x + 1]! |= 4; // bottom edge, west
      if (!on(x - 1, y)) edges[(y + 1) * stride + x]! |= 8; // left edge, north
    }
  }
  const used = new Uint8Array(edges.length);

  const loops: Point[][] = [];
  for (let start = 0; start < edges.length; start++) {
    for (;;) {
      const free = edges[start]! & ~used[start]!;
      if (free === 0) break;
      let startDir = 0;
      while ((free & (1 << startDir)) === 0) startDir++;
      const loop: Point[] = [[start % stride, Math.floor(start / stride)]];
      let v = start;
      let dir = startDir;
      for (;;) {
        used[v]! |= 1 << dir;
        const next = v + DY[dir]! * stride + DX[dir]!;
        // Successor edge is a pure function of the incoming one (TURN_ORDER).
        let nd = -1;
        for (const turn of TURN_ORDER) {
          const d = (dir + turn) % 4;
          if ((edges[next]! & (1 << d)) !== 0) {
            nd = d;
            break;
          }
        }
        if (next === start && nd === startDir) break;
        if (nd !== dir) loop.push([next % stride, Math.floor(next / stride)]);
        v = next;
        dir = nd;
      }
      loops.push(loop);
    }
  }
  return loops;
}

/** Perpendicular distance from p to the line through a and b (distance to a when a equals b). */
function lineDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / len;
}

/** Douglas-Peucker on points[0..n], marking kept indices; explicit stack so long loops cannot overflow. */
function dp(points: Point[], first: number, last: number, tolerance: number, keep: Set<number>): void {
  const stack: [number, number][] = [[first, last]];
  for (let range = stack.pop(); range !== undefined; range = stack.pop()) {
    const [lo, hi] = range;
    let worst = -1;
    let worstDist = tolerance;
    for (let i = lo + 1; i < hi; i++) {
      const d = lineDistance(points[i]!, points[lo]!, points[hi]!);
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst < 0) continue;
    keep.add(worst);
    stack.push([lo, worst], [worst, hi]);
  }
}

/**
 * Douglas-Peucker for a closed loop. Lattice vertices are whole numbers, so a tolerance
 * below 0.5 removes nothing and is treated as 0 (input returned unchanged). A loop that
 * collapses below 3 points has no area left and yields [].
 */
export function simplifyContour(points: Point[], tolerance: number): Point[] {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new MeasurementError("tolerance must be a non-negative number");
  if (tolerance < 0.5 || points.length <= 3) return points;
  let far = 0;
  let farDist = -1;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i]![0] - points[0]![0], points[i]![1] - points[0]![1]);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const keep = new Set<number>([0, far]);
  dp(points, 0, far, tolerance, keep);
  // Second half wraps back to the first point.
  const ring = [...points, points[0]!];
  dp(ring, far, points.length, tolerance, keep);
  if (keep.size < 3) return [];
  return [...keep].sort((a, b) => a - b).map((i) => points[i]!);
}

/** Format a number with at most 2 decimals and no trailing zeros. */
function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Build an SVG path (`M x y L ... Z` per loop) for use with fill-rule="evenodd". */
export function contoursToSvgPath(contours: Point[][], scale = 1): string {
  if (!Number.isFinite(scale) || scale <= 0) throw new MeasurementError("scale must be a positive number");
  return contours
    .filter((loop) => loop.length > 0)
    .map((loop) => {
      const first = loop[0]!;
      const rest = loop.slice(1);
      return (
        `M ${fmt(first[0] * scale)} ${fmt(first[1] * scale)}` +
        rest.map((p) => ` L ${fmt(p[0] * scale)} ${fmt(p[1] * scale)}`).join("") +
        " Z"
      );
    })
    .join(" ");
}

/** Trace, simplify and serialise a mask outline as one SVG path. */
export function maskOutlinePath(mask: BinaryMask, options: { tolerance?: number; scale?: number } = {}): string {
  const tolerance = options.tolerance ?? 0;
  const loops = traceContours(mask).map((loop) => simplifyContour(loop, tolerance));
  return contoursToSvgPath(loops, options.scale ?? 1);
}
