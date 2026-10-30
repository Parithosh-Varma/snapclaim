'use strict';
/* CoinModel — a tiny on-device coin classifier. No dependencies.
 *
 * What it is: circle detection (background-contrast + shape filter) +
 * handcrafted colour/texture features + k-NN. Prototype priors built from
 * published coin specs give a zero-shot guess; user-added samples
 * (few-shot) override them and are far more accurate.
 *
 * What it is not: a production currency classifier. Same-colour coins of
 * different denominations (e.g. US nickel vs dime in B/W thinking, or
 * EUR 1c/2c/5c) are indistinguishable without absolute scale, so single-
 * coin predictions are a colour-family guess + size prior. Train a few
 * samples per coin at a fixed camera distance for real accuracy.
 *
 * Works in browser (<script src>) and node (globalThis.CoinModel).
 */
(function () {
  const DB = [
    // USA
    { id: 'USD-1c',  country: 'USA',   label: 'US 1¢ penny',    diam: 19.05, color: 'copper' },
    { id: 'USD-5c',  country: 'USA',   label: 'US 5¢ nickel',   diam: 21.21, color: 'silver' },
    { id: 'USD-10c', country: 'USA',   label: 'US 10¢ dime',    diam: 17.91, color: 'silver' },
    { id: 'USD-25c', country: 'USA',   label: 'US 25¢ quarter', diam: 24.26, color: 'silver' },
    // Eurozone
    { id: 'EUR-1c',  country: 'EUR',   label: '€ 1 cent',  diam: 16.25, color: 'copper' },
    { id: 'EUR-2c',  country: 'EUR',   label: '€ 2 cent',  diam: 18.75, color: 'copper' },
    { id: 'EUR-5c',  country: 'EUR',   label: '€ 5 cent',  diam: 21.25, color: 'copper' },
    { id: 'EUR-10c', country: 'EUR',   label: '€ 10 cent', diam: 19.75, color: 'gold' },
    { id: 'EUR-20c', country: 'EUR',   label: '€ 20 cent', diam: 22.25, color: 'gold' },
    { id: 'EUR-50c', country: 'EUR',   label: '€ 50 cent', diam: 24.25, color: 'gold' },
    { id: 'EUR-1e',  country: 'EUR',   label: '€1',        diam: 23.25, color: 'bimetal-gold' },
    { id: 'EUR-2e',  country: 'EUR',   label: '€2',        diam: 25.75, color: 'bimetal-silver' },
    // UK
    { id: 'GBP-1p',  country: 'GBP',   label: 'UK 1p',  diam: 20.30, color: 'copper' },
    { id: 'GBP-2p',  country: 'GBP',   label: 'UK 2p',  diam: 25.90, color: 'copper' },
    { id: 'GBP-5p',  country: 'GBP',   label: 'UK 5p',  diam: 18.00, color: 'silver' },
    { id: 'GBP-10p', country: 'GBP',   label: 'UK 10p', diam: 24.50, color: 'silver' },
    { id: 'GBP-20p', country: 'GBP',   label: 'UK 20p', diam: 21.40, color: 'silver', note: '7-sided' },
    { id: 'GBP-50p', country: 'GBP',   label: 'UK 50p', diam: 27.30, color: 'silver', note: '7-sided' },
    { id: 'GBP-1',   country: 'GBP',   label: 'UK £1',  diam: 23.03, color: 'bimetal-gold' },
    { id: 'GBP-2',   country: 'GBP',   label: 'UK £2',  diam: 28.40, color: 'bimetal-silver' },
    // India
    { id: 'INR-1',   country: 'INR',   label: '₹1',  diam: 22.00, color: 'silver' },
    { id: 'INR-2',   country: 'INR',   label: '₹2',  diam: 25.00, color: 'silver' },
    { id: 'INR-5',   country: 'INR',   label: '₹5',  diam: 23.00, color: 'silver' },
    { id: 'INR-10',  country: 'INR',   label: '₹10', diam: 27.00, color: 'bimetal' },
    // Japan (¥5 and ¥50 have centre holes — detection is less reliable)
    { id: 'JPY-1',   country: 'JPY',   label: '¥1',   diam: 20.00, color: 'silver-light', note: 'aluminium' },
    { id: 'JPY-5',   country: 'JPY',   label: '¥5',   diam: 22.00, color: 'gold', note: 'holed' },
    { id: 'JPY-10',  country: 'JPY',   label: '¥10',  diam: 23.50, color: 'copper' },
    { id: 'JPY-50',  country: 'JPY',   label: '¥50',  diam: 21.00, color: 'silver', note: 'holed' },
    { id: 'JPY-100', country: 'JPY',   label: '¥100', diam: 22.60, color: 'silver' },
    { id: 'JPY-500', country: 'JPY',   label: '¥500', diam: 26.50, color: 'bimetal-silver' },
  ];

  const COLOR_MEAN = {
    'copper':         { rgb: [0.70, 0.33, 0.22], rim: 0.06 },
    'gold':           { rgb: [0.80, 0.64, 0.28], rim: 0.06 },
    'silver':         { rgb: [0.75, 0.76, 0.79], rim: 0.05 },
    'silver-light':   { rgb: [0.83, 0.84, 0.85], rim: 0.05 },
    'bimetal':        { rgb: [0.72, 0.68, 0.60], rim: 0.38 },
    'bimetal-gold':   { rgb: [0.78, 0.68, 0.42], rim: 0.35 },
    'bimetal-silver': { rgb: [0.76, 0.74, 0.66], rim: 0.35 },
  };

  // Feature layout: 0 diam, 1-3 RGB, 4 H, 5 S, 6 V, 7 rimDist,
  // 8 gold, 9 copper, 10 silver, 11 contrast, 12-27 thumb 4x4.
  const FVLEN = 28;
  const WEIGHTS = [0, 1, 1, 1, 1.2, 1, 0.5, 1.6, 1, 1, 1, 0.4,
    0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3];

  function rgbToHsv(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const d = mx - mn;
    let h = 0;
    if (d > 1e-6) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
      if (h < 0) h += 1;
    }
    return [h, mx === 0 ? 0 : d / mx, mx];
  }

  function colorScores(r, g, b) {
    const gold = Math.max(0, Math.min(1, ((r + g) / 2 - b) * 2.2 + 0.15));
    const copper = Math.max(0, Math.min(1, (r - (g + b) / 2) * 2.4 + 0.12));
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const silver = Math.max(0, Math.min(1, mn * 1.15 - (mx - mn) * 1.6));
    return [gold, copper, silver];
  }

  function prototypeFv(def) {
    const c = COLOR_MEAN[def.color] || COLOR_MEAN.silver;
    const [r, g, b] = c.rgb;
    const [h, s, v] = rgbToHsv(r, g, b);
    const [gold, copper, silver] = colorScores(r, g, b);
    const fv = new Array(FVLEN).fill(0);
    fv[0] = def.diam / 28.4;
    fv[1] = r; fv[2] = g; fv[3] = b;
    fv[4] = h; fv[5] = s; fv[6] = v;
    fv[7] = c.rim;
    fv[8] = gold; fv[9] = copper; fv[10] = silver;
    fv[11] = 0.25;
    for (let i = 12; i < FVLEN; i++) fv[i] = 0.5; // neutral thumb
    return fv;
  }
  const PROTOS = DB.map((d) => ({ def: d, fv: prototypeFv(d) }));

  /* data: Uint8ClampedArray RGBA, W/H size, c {x,y,r} in same pixels */
  function extractFeatures(data, W, H, c) {
    const r = Math.max(4, c.r);
    let n = 0, sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0;
    let nc = 0, scr = 0, scg = 0, scb = 0;
    let nr = 0, srr = 0, srg = 0, srb = 0;
    const thumb = new Float64Array(16);
    const tcnt = new Float64Array(16);
    const x0 = Math.max(0, Math.floor(c.x - r)), x1 = Math.min(W - 1, Math.ceil(c.x + r));
    const y0 = Math.max(0, Math.floor(c.y - r)), y1 = Math.min(H - 1, Math.ceil(c.y + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - c.x) / r, dy = (y + 0.5 - c.y) / r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        const o = (y * W + x) * 4;
        const R = data[o] / 255, G = data[o + 1] / 255, B = data[o + 2] / 255;
        const L = 0.299 * R + 0.587 * G + 0.114 * B;
        n++; sr += R; sg += G; sb += B; sl += L; sl2 += L * L;
        if (d2 < 0.25) { nc++; scr += R; scg += G; scb += B; }
        else if (d2 > 0.49) { nr++; srr += R; srg += G; srb += B; }
        const tx = Math.min(3, Math.max(0, Math.floor(((x - x0) / Math.max(1, x1 - x0)) * 4)));
        const ty = Math.min(3, Math.max(0, Math.floor(((y - y0) / Math.max(1, y1 - y0)) * 4)));
        thumb[ty * 4 + tx] += L; tcnt[ty * 4 + tx]++;
      }
    }
    if (!n) return null;
    const mr = sr / n, mg = sg / n, mb = sb / n, ml = sl / n;
    const [h, s, v] = rgbToHsv(mr, mg, mb);
    let rim = 0;
    if (nc > 0 && nr > 0) {
      const cr = scr / nc - srr / nr, cg = scg / nc - srg / nr, cb = scb / nc - srb / nr;
      rim = Math.min(1, Math.sqrt(cr * cr + cg * cg + cb * cb) * 2.2);
    }
    const [gold, copper, silver] = colorScores(mr, mg, mb);
    const variance = Math.max(0, sl2 / n - ml * ml);
    const fv = new Array(FVLEN);
    fv[0] = (2 * r) / Math.min(W, H);
    fv[1] = mr; fv[2] = mg; fv[3] = mb;
    fv[4] = h; fv[5] = s; fv[6] = v;
    fv[7] = rim;
    fv[8] = gold; fv[9] = copper; fv[10] = silver;
    fv[11] = Math.min(1, Math.sqrt(variance) * 3);
    for (let i = 0; i < 16; i++) fv[12 + i] = tcnt[i] ? thumb[i] / tcnt[i] : ml;
    return fv;
  }

  function dist2(a, b, useThumb) {
    let d = 0;
    for (let i = 1; i < 12; i++) {
      let dd = a[i] - b[i];
      if (i === 4) dd = Math.min(Math.abs(dd), 1 - Math.abs(dd)); // circular hue
      d += WEIGHTS[i] * dd * dd;
    }
    if (useThumb) {
      // mean-normalised thumbs: compare relief, not brightness
      let ma = 0, mb = 0;
      for (let i = 12; i < 28; i++) { ma += a[i]; mb += b[i]; }
      ma /= 16; mb /= 16;
      for (let i = 12; i < 28; i++) {
        const dd = (a[i] - ma) - (b[i] - mb);
        d += WEIGHTS[i] * dd * dd;
      }
    }
    return d;
  }

  /* Detect coins: contrast blobs vs local background + circularity filter.
     Uses full colour distance (luminance alone misses silver-on-grey),
     so a contrasting surface still matters but chroma differences count.
     data: Uint8ClampedArray RGBA. Returns [{x,y,r,score}] in input pixels. */
  function detectCoins(data, W, H, opts) {
    opts = opts || {};
    const T = opts.threshold == null ? 30 : opts.threshold; // colour distance 0..441
    const maxCoins = opts.maxCoins || 8;
    const n = W * H;
    // local background colour via integral-image box blur (per channel)
    const iR = new Float64Array((W + 1) * (H + 1));
    const iG = new Float64Array((W + 1) * (H + 1));
    const iB = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let rr = 0, gg = 0, bb = 0;
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        rr += data[o]; gg += data[o + 1]; bb += data[o + 2];
        const a = (y + 1) * (W + 1) + x + 1, b = y * (W + 1) + x + 1;
        iR[a] = iR[b] + rr; iG[a] = iG[b] + gg; iB[a] = iB[b] + bb;
      }
    }
    // Small window on purpose: it only has to follow background gradients /
    // shadows. A window near the coin's own size gets coin-polluted and
    // masks the whole frame (giant blob, everything rejected). Large coins
    // are covered by the border-background rule below instead.
    const R = Math.max(6, Math.floor(Math.min(W, H) / 24));
    // frame border is almost always background — anchors close-ups where
    // the blur window fits inside the coin
    let br = 0, bg2 = 0, bb = 0, bn = 0;
    const BD = 4;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x >= BD && y >= BD && x < W - BD && y < H - BD) continue;
        const o = (y * W + x) * 4;
        br += data[o]; bg2 += data[o + 1]; bb += data[o + 2]; bn++;
      }
    }
    br /= Math.max(1, bn); bg2 /= Math.max(1, bn); bb /= Math.max(1, bn);
    const T2 = T * 1.3, T2sq = T2 * T2, Tsq = T * T;
    const mask = new Uint8Array(n);
    for (let y = 0; y < H; y++) {
      const ya = Math.max(0, y - R), yb = Math.min(H - 1, y + R);
      for (let x = 0; x < W; x++) {
        const xa = Math.max(0, x - R), xb = Math.min(W - 1, x + R);
        const A = ya * (W + 1) + xa, B = ya * (W + 1) + xb + 1;
        const C = (yb + 1) * (W + 1) + xa, D = (yb + 1) * (W + 1) + xb + 1;
        const cnt = (xb - xa + 1) * (yb - ya + 1);
        const o = (y * W + x) * 4;
        const pr = data[o], pg = data[o + 1], pb = data[o + 2];
        const dr = pr - (iR[D] - iR[B] - iR[C] + iR[A]) / cnt;
        const dg = pg - (iG[D] - iG[B] - iG[C] + iG[A]) / cnt;
        const db = pb - (iB[D] - iB[B] - iB[C] + iB[A]) / cnt;
        if (dr * dr + dg * dg + db * db > Tsq) { mask[y * W + x] = 1; continue; }
        const er = pr - br, eg = pg - bg2, eb = pb - bb;
        if (er * er + eg * eg + eb * eb > T2sq) mask[y * W + x] = 1;
      }
    }
    // connected components (4-neighbourhood BFS)
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n);
    const raw = [];
    const minArea = Math.max(60, n * (opts.minAreaFrac == null ? 0.0012 : opts.minAreaFrac));
    const maxArea = n * (opts.maxAreaFrac == null ? 0.65 : opts.maxAreaFrac);
    for (let i = 0; i < n; i++) {
      if (!mask[i] || seen[i]) continue;
      let sp = 0;
      stack[sp++] = i; seen[i] = 1;
      let area = 0, sx = 0, sy = 0;
      let minX = W, maxX = -1, minY = H, maxY = -1;
      while (sp > 0) {
        const c = stack[--sp];
        const x = c % W, y = (c / W) | 0;
        area++; sx += x; sy += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0 && mask[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack[sp++] = c - 1; }
        if (x < W - 1 && mask[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack[sp++] = c + 1; }
        if (y > 0 && mask[c - W] && !seen[c - W]) { seen[c - W] = 1; stack[sp++] = c - W; }
        if (y < H - 1 && mask[c + W] && !seen[c + W]) { seen[c + W] = 1; stack[sp++] = c + W; }
      }
      if (area < minArea || area > maxArea) continue;
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (bw <= 2 || bh <= 2) continue;
      const aspect = bw > bh ? bw / bh : bh / bw;
      if (aspect > 1.35) continue;
      if (minX <= 1 || minY <= 1 || maxX >= W - 2 || maxY >= H - 2) continue; // touches edge
      const fill = area / (bw * bh);
      if (fill < 0.40 || fill > 0.98) continue; // circle ≈ 0.785; holed ≈ 0.6
      raw.push({ x: sx / area, y: sy / area, r: Math.sqrt(area / Math.PI) });
    }
    // halo-immune refit turns rough blobs into tight circles.
    // (No circle-vs-edge pre-check here: raw r is halo-inflated and its
    // centre halo-shifted. Edge-touching blobs were already dropped via
    // the mask bbox above; refineCircle clamps sampling to the frame.)
    const out = [];
    for (const c of raw) {
      const f = refineCircle(data, W, H, c);
      if (f && f.score >= 0.25) out.push(f);
    }
    // non-max suppression
    out.sort((a, b) => b.score - a.score);
    const kept = [];
    for (const c of out) {
      let dup = false;
      for (const k of kept) {
        if (Math.hypot(c.x - k.x, c.y - k.y) < Math.min(c.r, k.r) * 1.2) { dup = true; break; }
      }
      if (!dup) kept.push(c);
      if (kept.length >= maxCoins) break;
    }
    return kept;
  }

  /* Halo-immune circle fit: the contrast mask overshoots (pixels just
     outside a coin still pollute the background window), so the true edge
     is re-found per ray as the strongest colour step. Returns refined
     {x,y,r,score} or null. */
  function refineCircle(data, W, H, c) {
    const at = (x, y) => {
      x = Math.max(0, Math.min(W - 1, Math.round(x)));
      y = Math.max(0, Math.min(H - 1, Math.round(y)));
      const o = (y * W + x) * 4;
      return [data[o], data[o + 1], data[o + 2]];
    };
    // Ray-cast circle fit. Returns {x,y,r,gs} with the median radius and
    // per-ray edge strengths, or null when nothing edge-like is found.
    // Edge rule: the OUTERMOST step above half the max. A single peak
    // (plain coin) is unaffected, but a bimetal coin's rim is chosen over
    // its brighter core ring. Scan range is capped so neighbouring coins
    // are mostly out of reach; stragglers are trimmed by consensus below.
    const cast = (cx, cy, rScan, gate) => {
      const ANG = 24, radii = [], gs = [], pts = [];
      const tMax = Math.min(rScan * 1.4 + 4, Math.hypot(W, H));
      for (let a = 0; a < ANG; a++) {
        const dx = Math.cos((a / ANG) * Math.PI * 2), dy = Math.sin((a / ANG) * Math.PI * 2);
        const prof = [];
        let px = at(cx, cy);
        for (let t = 2; t < tMax; t += 1) {
          const p = at(cx + dx * t, cy + dy * t);
          const g = (p[0] - px[0]) * (p[0] - px[0]) + (p[1] - px[1]) * (p[1] - px[1]) + (p[2] - px[2]) * (p[2] - px[2]);
          px = p;
          prof.push(g);
        }
        let maxG = 0;
        for (let i = 0; i < prof.length; i++) {
          if (i + 2 > gate && prof[i] > maxG) maxG = prof[i];
        }
        let bestT = rScan, bestG = 0;
        if (maxG >= 30 * 30) {
          for (let i = prof.length - 1; i >= 0; i--) {
            if (i + 2 > gate && prof[i] >= maxG * 0.5) { bestT = i + 2; bestG = prof[i]; break; }
          }
        }
        radii.push(bestT); gs.push(bestG); pts.push([cx + dx * bestT, cy + dy * bestT]);
      }
      return { radii, gs, pts };
    };
    // Kasa least-squares circle fit: solves x²+y²+Dx+Ey+F=0.
    const fitCircle = (pts) => {
      const n = pts.length;
      if (n < 6) return null;
      let Sx = 0, Sy = 0, Sxx = 0, Sxy = 0, Syy = 0, Sxz = 0, Syz = 0, Sz = 0;
      for (const [x, y] of pts) {
        const z = x * x + y * y;
        Sx += x; Sy += y; Sxx += x * x; Sxy += x * y; Syy += y * y;
        Sxz += x * z; Syz += y * z; Sz += z;
      }
      // 3x3 solve via Cramer's rule
      const a11 = Sxx, a12 = Sxy, a13 = Sx, b1 = -Sxz;
      const a21 = Sxy, a22 = Syy, a23 = Sy, b2 = -Syz;
      const a31 = Sx, a32 = Sy, a33 = n, b3 = -Sz;
      const det = a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) + a13 * (a21 * a32 - a22 * a31);
      if (Math.abs(det) < 1e-9) return null;
      const rep = (c1, c2, c3) =>
        (c1 * (a22 * a33 - a23 * a32) - a12 * (c2 * a33 - a23 * c3) + a13 * (c2 * a32 - a22 * c3)) / det;
      const D = rep(b1, b2, b3);
      const E = (a11 * (b2 * a33 - a23 * b3) - b1 * (a21 * a33 - a23 * a31) + a13 * (a21 * b3 - b2 * a31)) / det;
      const F = (a11 * (a22 * b3 - b2 * a32) - a12 * (a21 * b3 - b2 * a31) + b1 * (a21 * a32 - a22 * a31)) / det;
      const xc = -D / 2, yc = -E / 2;
      const r = Math.sqrt(Math.max(1, (D * D + E * E) / 4 - F));
      return { x: xc, y: yc, r };
    };
    let cx = c.x, cy = c.y, rEst = Math.max(8, c.r);
    // Scan range stays anchored to the raw (halo-inflated, generous) radius:
    // shrinking it from the estimate would blind later passes, because the
    // median exit distance from an off-centre start underestimates R.
    const rScan = Math.max(8, c.r);
    for (let iter = 0; iter < 3; iter++) {
      const last = iter === 2;
      const { radii, gs, pts } = cast(cx, cy, rScan, rScan * (last ? 0.35 : 0.12));
      const inliers = [];
      for (let i = 0; i < pts.length; i++) {
        if (gs[i] <= 0) continue;
        if (iter > 0 && Math.abs(radii[i] - rEst) > rEst * 0.4) continue;
        inliers.push({ p: pts[i], t: radii[i] });
      }
      if (inliers.length < 10) return null; // mostly looking at blank background
      const fit = fitCircle(inliers.map((o) => o.p));
      if (!fit || !(fit.r > 4) || fit.r > Math.min(W, H) * 0.48) return null;
      cx = fit.x; cy = fit.y; rEst = fit.r;
      if (last) {
        // spread check: inlier radii must agree (only judged once centred)
        const ts = inliers.map((o) => o.t).sort((a, b) => a - b);
        const spread = (ts[ts.length - 4] - ts[3]) / Math.max(1, rEst);
        if (spread > 0.9) return null;
        const edge = gs.reduce((a, b) => a + b, 0) / gs.length;
        const score = Math.max(0, Math.min(1, (1 - spread) * 0.6 + Math.min(1, edge / (60 * 60)) * 0.4 + 0.2));
        return { x: cx, y: cy, r: rEst, score };
      }
    }
    return null;
  }

  class Classifier {
    constructor() { this.samples = []; } // {fv, label}
    addSample(fv, label) {
      if (!fv || !label) return;
      this.samples.push({ fv: Array.from(fv), label: String(label) });
      if (this.samples.length > 400) this.samples.splice(0, this.samples.length - 400);
    }
    clear(label) {
      if (label) this.samples = this.samples.filter((s) => s.label !== label);
      else this.samples = [];
    }
    predict(fv, opts) {
      opts = opts || {};
      const k = Math.min(opts.k || 3, 8);
      const filter = opts.countries; // e.g. ['USA','EUR']
      if (!fv) return [];
      let pool, useThumb;
      const trained = this.samples.filter((s) => !filter || filter.some((cc) =>
        (DB.find((d) => d.id === s.label) || {}).country === cc));
      if (trained.length) {
        pool = trained.map((s) => ({ label: s.label, d: dist2(fv, s.fv, true) }));
        useThumb = true;
      } else {
        pool = PROTOS
          .filter((p) => !filter || filter.includes(p.def.country))
          .map((p) => ({ label: p.def.id, d: dist2(fv, p.fv, false) }));
        useThumb = false;
      }
      if (!pool.length) return [];
      pool.sort((a, b) => a.d - b.d);
      const top = pool.slice(0, k);
      const votes = new Map();
      for (const t of top) {
        const w = 1 / (1 + t.d * 4);
        votes.set(t.label, (votes.get(t.label) || 0) + w);
      }
      let tot = 0;
      for (const v of votes.values()) tot += v;
      const ranked = [...votes.entries()]
        .map(([label, w]) => ({ label, confidence: w / tot, dist: pool.find((p) => p.label === label).d }))
        .sort((a, b) => b.confidence - a.confidence);
      const reject = opts.rejectDist == null ? (useThumb ? 0.9 : 2.2) : opts.rejectDist;
      if (ranked[0].dist > reject) {
        return [{ label: 'unknown', confidence: 0.35, dist: ranked[0].dist, alternatives: ranked.slice(0, 3) }];
      }
      ranked[0].alternatives = ranked.slice(1, 3);
      return ranked;
    }
    toJSON() { return { samples: this.samples }; }
    fromJSON(o) {
      if (o && Array.isArray(o.samples)) {
        this.samples = o.samples.filter((s) => Array.isArray(s.fv) && s.fv.length === FVLEN && s.label);
      }
      return this;
    }
  }

  function labelOf(id) {
    if (id === 'unknown') return 'unknown coin';
    const d = DB.find((x) => x.id === id);
    return d ? d.label : id;
  }

  globalThis.CoinModel = { DB, FVLEN, extractFeatures, detectCoins, refineCircle, Classifier, labelOf, prototypeFv };
})();
