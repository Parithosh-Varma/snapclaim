// Finds a coin in the photo so the user does not have to tap it: a circle
// Hough transform driven by edge direction. Each strong edge votes for the
// centres a circle through it could have, one vote per radius, along its
// gradient (both ways, so a dark coin on a light wall counts as well as a
// light one on a dark wall). Each peak is then checked by fitting an ellipse
// to the outline around it, which also finds a tilted coin's true centre.
// Only the centre is used: it becomes the coin tap and SAM outlines the coin.
// Pure (no DOM): the PWA passes RGBA pixels and tests pass synthetic ones.

/** Longest side the search runs at; the photo is box-averaged down to it. */
const WORK_SIDE = 320;
/** Coin diameter as a share of the photo's short side. */
const MIN_DIAMETER = 0.03;
const MAX_DIAMETER = 0.35;
/** Share of edge pixels kept: the strongest gradients only. */
const EDGE_SHARE = 0.1;
/** Share of the 72 directions whose outline point must sit on the fitted ellipse. */
const MIN_COVERAGE = 0.75;

/**
 * @param {{ data: Uint8ClampedArray | Uint8Array, width: number, height: number }} image RGBA
 * @returns {{ x: number, y: number, r: number, coverage: number }[]} best first, in image pixels
 */
export function findCoins(image) {
  const scale = Math.min(1, WORK_SIDE / Math.max(image.width, image.height));
  const { gray, width, height } = downscaleGray(image, scale);
  const { gx, gy, mag } = sobel(gray, width, height);

  const sorted = Float32Array.from(mag).sort();
  const threshold = Math.max(sorted[Math.floor((1 - EDGE_SHARE) * (sorted.length - 1))] ?? 0, 8);

  const short = Math.min(width, height);
  const rMin = Math.max(4, Math.round((MIN_DIAMETER * short) / 2));
  const rMax = Math.round((MAX_DIAMETER * short) / 2);
  const radii = [];
  for (let r = rMin; r <= rMax; r += Math.max(1, Math.round(r * 0.06))) radii.push(r);

  // One accumulator per radius; votes are smeared over the 2x2 cell the centre falls in.
  const acc = radii.map(() => new Float32Array(width * height));
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const m = mag[i];
      if (m < threshold) continue;
      const ux = gx[i] / m;
      const uy = gy[i] / m;
      radii.forEach((r, k) => {
        for (const sign of [1, -1]) {
          const cx = x + sign * r * ux;
          const cy = y + sign * r * uy;
          const x0 = Math.floor(cx);
          const y0 = Math.floor(cy);
          if (x0 < 0 || y0 < 0 || x0 >= width - 1 || y0 >= height - 1) continue;
          const tx = cx - x0;
          const ty = cy - y0;
          const a = acc[k];
          a[y0 * width + x0] += (1 - tx) * (1 - ty);
          a[y0 * width + x0 + 1] += tx * (1 - ty);
          a[(y0 + 1) * width + x0] += (1 - tx) * ty;
          a[(y0 + 1) * width + x0 + 1] += tx * ty;
        }
      });
    }
  }

  // Peaks per radius, then checked against the outline itself so a cluster of
  // unrelated edges cannot pass. Votes scatter over neighbouring cells (and
  // radii), so each cell is scored with its 3x3 neighbourhood; the low floor
  // only prunes, the ellipse fit decides.
  const candidates = [];
  radii.forEach((r, k) => {
    const a = box3(acc[k], width, height);
    const floor = 0.2 * 2 * Math.PI * r;
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const v = a[y * width + x];
        if (v < floor || !isPeak(a, width, x, y, v)) continue;
        const fit = outlineFit(gx, gy, mag, threshold, width, height, x, y, r);
        if (fit && fit.coverage >= MIN_COVERAGE) candidates.push(fit);
      }
    }
  });

  candidates.sort((p, q) => q.coverage - p.coverage || q.r - p.r);
  // Concentric hits (a coin's rim and its inner relief) are one coin: keep the best.
  const kept = [];
  for (const c of candidates) {
    if (kept.some((k) => Math.hypot(k.x - c.x, k.y - c.y) < Math.max(k.r, c.r) * 0.5)) continue;
    kept.push(c);
  }
  return kept.slice(0, 5).map((c) => ({
    x: Math.round((c.x + 0.5) / scale - 0.5),
    y: Math.round((c.y + 0.5) / scale - 0.5),
    r: Math.round((c.r / scale) * 10) / 10,
    coverage: Math.round(c.coverage * 1000) / 1000,
  }));
}

function downscaleGray(image, scale) {
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const sum = new Float32Array(width * height);
  const count = new Float32Array(width * height);
  for (let y = 0; y < image.height; y++) {
    const ty = Math.min(height - 1, Math.floor(y * scale));
    for (let x = 0; x < image.width; x++) {
      const tx = Math.min(width - 1, Math.floor(x * scale));
      const o = (y * image.width + x) * 4;
      sum[ty * width + tx] += 0.299 * image.data[o] + 0.587 * image.data[o + 1] + 0.114 * image.data[o + 2];
      count[ty * width + tx]++;
    }
  }
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = count[i] ? sum[i] / count[i] : 0;
  // Percentile contrast stretch: on a dull or hazy photo the coin rim would
  // never reach the top gradient share, so spread p2–p98 over the full
  // range first. Skipped when the photo already spans 200+ levels, where the
  // rim is strong and stretching would only amplify noise.
  const sorted = Float32Array.from(gray).sort();
  const lo = sorted[Math.floor(0.02 * (sorted.length - 1))] ?? 0;
  const hi = sorted[Math.floor(0.98 * (sorted.length - 1))] ?? 255;
  if (hi - lo > 1 && hi - lo < 200) {
    const gain = 255 / (hi - lo);
    for (let i = 0; i < gray.length; i++) {
      const v = (gray[i] - lo) * gain;
      gray[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return { gray, width, height };
}

function sobel(gray, width, height) {
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = (dx, dy) => gray[(y + dy) * width + x + dx];
      const i = y * width + x;
      gx[i] = p(1, -1) + 2 * p(1, 0) + p(1, 1) - p(-1, -1) - 2 * p(-1, 0) - p(-1, 1);
      gy[i] = p(-1, 1) + 2 * p(0, 1) + p(1, 1) - p(-1, -1) - 2 * p(0, -1) - p(1, -1);
      mag[i] = Math.hypot(gx[i], gy[i]);
    }
  }
  return { gx, gy, mag };
}

function box3(a, width, height) {
  const out = new Float32Array(a.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v += a[(y + dy) * width + x + dx];
      out[y * width + x] = v;
    }
  }
  return out;
}

function isPeak(a, width, x, y, v) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if ((dx || dy) && a[(y + dy) * width + x + dx] > v) return false;
    }
  }
  return true;
}

const DIRECTIONS = 72;
/** An outline point within this share of the fitted ellipse counts as on it. */
const FIT_TOLERANCE = 0.06;
/** Flattest ellipse accepted, matching the backend's 60° coin limit. */
const MIN_ASPECT = 0.45;

/**
 * Checks a vote peak against the outline itself. In each of 72 directions it
 * takes the strongest edge between 0.4r and 1.6r whose gradient points along
 * the ray, fits an ellipse to those points (twice, re-centring on the fit so a
 * tilted coin's centre is found), and returns the share of directions whose
 * point lies on the ellipse. A circle or a tilted coin scores near 1; a square
 * leaves its corners off the fit and a cluster of unrelated edges scatters.
 */
function outlineFit(gx, gy, mag, threshold, width, height, cx, cy, r) {
  let fit = null;
  for (let pass = 0; pass < 3; pass++) {
    const points = rayEdges(gx, gy, mag, threshold, width, height, cx, cy, r);
    if (points.length < DIRECTIONS / 2) return null;
    fit = fitEllipse(points, cx, cy);
    if (!fit) return null;
    if (Math.hypot(fit.cx - cx, fit.cy - cy) < 0.5) break;
    cx = fit.cx;
    cy = fit.cy;
  }
  if (!fit || fit.aspect < MIN_ASPECT) return null;
  const points = rayEdges(gx, gy, mag, threshold, width, height, fit.cx, fit.cy, fit.r);
  let on = 0;
  for (const [x, y] of points) if (Math.abs(fit.radialError(x, y)) <= FIT_TOLERANCE) on++;
  return { x: fit.cx, y: fit.cy, r: fit.r, coverage: on / DIRECTIONS };
}

function rayEdges(gx, gy, mag, threshold, width, height, cx, cy, r) {
  const points = [];
  for (let s = 0; s < DIRECTIONS; s++) {
    const t = (2 * Math.PI * s) / DIRECTIONS;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    let best = null;
    let bestMag = threshold;
    for (let d = 0.4 * r; d <= 1.6 * r; d += 0.5) {
      const x = Math.round(cx + d * dx);
      const y = Math.round(cy + d * dy);
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) break;
      const i = y * width + x;
      if (mag[i] < bestMag) continue;
      if (Math.abs(gx[i] * dx + gy[i] * dy) / mag[i] < 0.85) continue;
      best = [x, y];
      bestMag = mag[i];
    }
    if (best) points.push(best);
  }
  return points;
}

/**
 * Least-squares conic a·x² + b·xy + c·y² + d·x + e·y = 1 (coordinates relative
 * to a guess centre), read back as centre, mean radius and aspect.
 */
function fitEllipse(points, ox, oy) {
  const n = 5;
  const m = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (const [px, py] of points) {
    const x = px - ox;
    const y = py - oy;
    const row = [x * x, x * y, y * y, x, y];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) m[i][j] += row[i] * row[j];
      m[i][n] += row[i];
    }
  }
  const sol = solve(m);
  if (!sol) return null;
  const [a, b, c, d, e] = sol;
  const det = 4 * a * c - b * b;
  if (!(det > 0) || a <= 0) return null; // not an ellipse
  const x0 = (b * e - 2 * c * d) / det;
  const y0 = (b * d - 2 * a * e) / det;
  // Centred form: a·u² + b·uv + c·v² = k
  const k = 1 + a * x0 * x0 + b * x0 * y0 + c * y0 * y0;
  if (!(k > 0)) return null;
  const mid = (a + c) / 2;
  const spread = Math.hypot((a - c) / 2, b / 2);
  const major = Math.sqrt(k / (mid - spread));
  const minor = Math.sqrt(k / (mid + spread));
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  const cx = ox + x0;
  const cy = oy + y0;
  return {
    cx,
    cy,
    r: Math.sqrt(major * minor),
    aspect: minor / major,
    // Distance from the centre over the ellipse's own radius in that direction, minus 1.
    radialError(px, py) {
      const u = px - cx;
      const v = py - cy;
      return Math.sqrt((a * u * u + b * u * v + c * v * v) / k) - 1;
    },
  };
}

function solve(m) {
  const n = m.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = m[row][col] / m[col][col];
      for (let j = col; j <= n; j++) m[row][j] -= f * m[col][j];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}
