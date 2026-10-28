// Quick checks on the photo and the coin, before anything is measured, in
// words the user can act on. Pure (no DOM): the PWA passes RGBA pixels or a
// 0/1 mask, and tests pass synthetic ones.

/** Longest side the checks run at; the photo is box-averaged down to it. */
const WORK_SIDE = 512;
/**
 * Blur, from how much detail one more gentle blur removes (Crété et al. 2007):
 * a sharp photo loses most of it (ratio ~0.15 on a real facade), an already
 * soft one little (~0.53 once blurred by σ 2 at this size).
 */
const MAX_REBLUR_RATIO = 0.42;
/** Laplacian variance below this is a featureless or badly smeared photo. */
const MIN_DETAIL = 3;
/** Median brightness below this (0-255) is too dark to see a hairline crack. */
const MIN_MEDIAN = 40;
/** Share of blown-out pixels (≥ 250) above which bright detail is lost. */
const MAX_CLIPPED = 0.15;
/** Coin narrower than this (px) makes every millimetre uncertain by > ±1.7%. */
const MIN_COIN_PX = 60;

/**
 * @param {{ data: Uint8ClampedArray | Uint8Array, width: number, height: number }} image RGBA
 * @returns {{ reblurRatio: number, detail: number, median: number, clipped: number, warnings: string[] }}
 */
export function checkPhoto(image) {
  const { gray, width, height } = downscaleGray(image, Math.min(1, WORK_SIDE / Math.max(image.width, image.height)));
  const detail = laplacianVariance(gray, width, height);
  const reblurRatio = detail > 0 ? laplacianVariance(binomial(gray, width, height), width, height) / detail : 1;

  const histogram = new Uint32Array(256);
  for (const v of gray) histogram[Math.min(255, Math.round(v))]++;
  let seen = 0;
  let median = 0;
  for (; median < 256; median++) {
    seen += histogram[median];
    if (seen >= gray.length / 2) break;
  }
  let blown = 0;
  for (let v = 250; v < 256; v++) blown += histogram[v];
  const clipped = blown / gray.length;

  const warnings = [];
  if (detail < MIN_DETAIL || reblurRatio > MAX_REBLUR_RATIO) {
    warnings.push("The photo looks blurry. Hold the phone still, tap the crack on screen to focus, and retake it.");
  }
  if (median < MIN_MEDIAN) warnings.push("The photo is too dark to see fine cracks. Turn on a light or open the curtains.");
  if (clipped > MAX_CLIPPED) warnings.push("Part of the photo is blown out. Avoid the flash and direct sunlight on the wall.");

  return {
    reblurRatio: round(reblurRatio, 3),
    detail: round(detail, 1),
    median,
    clipped: round(clipped, 3),
    warnings,
  };
}

/**
 * How far the coin's size limits the millimetres: its outline is only known to
 * about a pixel, so the scale (and every length) is uncertain by ±1 px over
 * the coin's width. The width is taken from the mask's area, as a circle.
 * @param {ArrayLike<number>} mask 0/1, any layout
 * @returns {{ diameterPx: number, scaleErrorPercent: number, warning?: string }}
 */
export function coinPrecision(mask) {
  let area = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) area++;
  const diameterPx = 2 * Math.sqrt(area / Math.PI);
  const scaleErrorPercent = diameterPx > 0 ? 100 / diameterPx : Infinity;
  const out = { diameterPx: round(diameterPx, 1), scaleErrorPercent: round(scaleErrorPercent, 1) };
  if (diameterPx < MIN_COIN_PX) {
    return {
      ...out,
      warning: `The coin is only ${Math.round(diameterPx)} px across, so lengths may be off by about ±${round(scaleErrorPercent, 1)}%. Move closer for better millimetres.`,
    };
  }
  return out;
}

function round(x, digits) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
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
  return { gray, width, height };
}

/** Variance of the 4-neighbour Laplacian, skipping a 2 px border. */
function laplacianVariance(gray, width, height) {
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      const l = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      n++;
      sum += l;
      sumSq += l * l;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** 3x3 binomial blur ([1 2 1]/4 each way); edges copied. */
function binomial(gray, width, height) {
  const out = Float32Array.from(gray);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      out[i] =
        (gray[i - width - 1] + 2 * gray[i - width] + gray[i - width + 1] +
          2 * gray[i - 1] + 4 * gray[i] + 2 * gray[i + 1] +
          gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1]) / 16;
    }
  }
  return out;
}
