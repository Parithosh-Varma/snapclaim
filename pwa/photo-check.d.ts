// Types for ../photo-check.js (plain JS shared by the PWA and the test suite).
export interface PhotoPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}
export function luminanceAt(data: PhotoPixels["data"], i: number): number;
export function laplacianVariance(pixels: PhotoPixels): number;
export function checkPhoto(
  pixels: PhotoPixels,
  originalSide?: number,
  thresholds?: { blurBelow?: number },
): string[];
