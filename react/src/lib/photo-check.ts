// Photo quality notes, in words the user can act on. Port of pwa/photo-check.js.
// Input: {width, height, data} with RGBA bytes (e.g. from getImageData),
// plus the original photo's longest side before the 512px downscale.
export interface PhotoPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export function luminanceAt(data: PhotoPixels["data"], i: number): number {
  return 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
}

/** Variance of the Laplacian response — low means soft/blurry. Heuristic, not a diagnosis. */
export function laplacianVariance(pixels: PhotoPixels): number {
  const { width, height, data } = pixels;
  if (width < 3 || height < 3) return 0;
  const lum = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) lum[i] = luminanceAt(data, i * 4);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = (lum[i - width] ?? 0) + (lum[i - 1] ?? 0) + (lum[i + 1] ?? 0) + (lum[i + width] ?? 0) - 4 * (lum[i] ?? 0);
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  return n === 0 ? 0 : sumSq / n - (sum / n) * (sum / n);
}

export function checkPhoto(
  pixels: PhotoPixels,
  originalSide = 0,
  thresholds: { blurBelow?: number } = {},
): string[] {
  const { width, height, data } = pixels;
  const blurBelow = thresholds.blurBelow ?? 150;
  const notes: string[] = [];
  if (width === 0 || height === 0 || !data || data.length < width * height * 4) {
    return ["Could not read this photo. Try another one."];
  }
  let sum = 0;
  let dark = 0;
  let bright = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const l = luminanceAt(data, i * 4);
    sum += l;
    if (l < 25) dark++;
    if (l > 235) bright++;
  }
  const mean = sum / n;
  if (mean < 40 || dark / n > 0.6) notes.push("This photo is very dark — add light and retake it.");
  else if (mean > 215 || bright / n > 0.6) notes.push("This photo is blown out — move out of direct light and retake it.");
  if (laplacianVariance(pixels) < blurBelow) notes.push("This photo looks blurry — hold steady and retake it.");
  if (originalSide > 0 && originalSide < 800) notes.push("This photo is low resolution — move closer instead of zooming.");
  return notes;
}
