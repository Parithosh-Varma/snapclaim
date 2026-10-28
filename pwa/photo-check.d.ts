export interface PhotoCheck {
  /** Laplacian variance after / before one more gentle blur. Near 0 sharp, higher soft. */
  reblurRatio: number;
  /** Laplacian variance at the working size: how much fine detail there is. */
  detail: number;
  /** Median brightness, 0-255. */
  median: number;
  /** Share of pixels at 250 or above. */
  clipped: number;
  warnings: string[];
}

export function checkPhoto(image: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }): PhotoCheck;

export function coinPrecision(mask: ArrayLike<number>): { diameterPx: number; scaleErrorPercent: number; warning?: string };
