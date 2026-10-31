// Mask clean-up shared by the PWA and the test suite. Plain JS, no imports.
// Thin cracks on textured stone come back from SAM/SlimSAM as near-touching
// fragments with 1-4 px gaps; measured as-is they read as many tiny regions
// instead of one crack. A small morphological close (dilate, then erode with
// the same radius) bridges those gaps without growing the overall outline.

/** Union of same-size 0/1 masks. */
export function unionMasks(masks) {
  if (!masks.length) return null;
  const out = new Uint8Array(masks[0].length);
  for (const m of masks) {
    if (m.length !== out.length) {
      throw new Error(`unionMasks: mask length ${m.length} differs from ${out.length}`);
    }
    for (let i = 0; i < out.length; i++) out[i] |= m[i];
  }
  return out;
}

function dilate(mask, w, h, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

function erode(mask, w, h, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = true;
      for (let dy = -r; dy <= r && all; dy++) {
        const yy = y + dy;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || yy < 0 || yy >= h || !mask[yy * w + xx]) { all = false; break; }
        }
      }
      out[y * w + x] = all ? 1 : 0;
    }
  }
  return out;
}

/**
 * Close gaps up to 2*radius px wide. Solid areas keep their outline: dilation
 * grows them by radius, erosion shrinks them back. Border pixels erode away
 * (a mask touching the frame edge loses `radius` px there) — acceptable for
 * damage masks, which the photo framing keeps off the very edge.
 */
export function closeMask(mask, w, h, radius = 2) {
  if (radius <= 0) return mask;
  return erode(dilate(mask, w, h, radius), w, h, radius);
}
