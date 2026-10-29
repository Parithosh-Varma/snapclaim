// Synthetic photos of a wall shot at an angle, shared by tests/tilt.test.ts and
// the tilted-wall bench case (fixtures/masks/tilted-wall.json).
import type { MeasureSessionInput } from "../src/engine/types.ts";
import { type BinaryMask, createMask } from "../src/vision/mask.ts";
import { circularReference, observeMask, tiltStretch } from "../src/vision/observe.ts";

export const SIZE = 400;

/**
 * A wall photographed at an angle: points on the wall (in straight-on pixels,
 * centred on the photo) are squashed by `aspect` along the unit vector at `angle`.
 * Each photo pixel is mapped back onto the wall and tested there.
 */
export function photographed(aspect: number, angleDeg: number, onWall: (u: number, v: number) => boolean): BinaryMask {
  const nx = Math.cos((angleDeg * Math.PI) / 180);
  const ny = Math.sin((angleDeg * Math.PI) / 180);
  const mask = createMask(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = x - SIZE / 2;
      const py = y - SIZE / 2;
      const along = (1 / aspect - 1) * (px * nx + py * ny);
      if (onWall(px + along * nx, py + along * ny)) mask.data[y * SIZE + x] = 1;
    }
  }
  return mask;
}

/** A 3 px wide straight crack on the wall, `lengthPx` long at `deg` through (u0, v0). */
export function crack(u0: number, v0: number, lengthPx: number, deg: number) {
  const dx = Math.cos((deg * Math.PI) / 180);
  const dy = Math.sin((deg * Math.PI) / 180);
  return (u: number, v: number) => {
    const t = (u - u0) * dx + (v - v0) * dy;
    const d = Math.abs(-(u - u0) * dy + (v - v0) * dx);
    return t >= -lengthPx / 2 && t <= lengthPx / 2 && d <= 1.5;
  };
}

export const coin = (u: number, v: number) => (u + 110) ** 2 + (v + 110) ** 2 <= 40 * 40;
export const COIN = { id: "coin", knownMm: 24.26, confidence: 0.95 };

/**
 * The bench scene: a quarter (80 px across, straight on) and a 220 px crack at
 * 60° on a wall tilted to aspect 0.65 (49°) about the horizontal. The crack is
 * truly 220 × 24.26 / 80 = 66.7 mm.
 */
export function tiltedWallBench(): Pick<MeasureSessionInput, "component" | "masks" | "scaleReference"> {
  const measured = circularReference(photographed(0.65, 90, coin), COIN);
  const stretch = tiltStretch(measured.diagnostics);
  return {
    component: { id: "photo", areaPx: SIZE * SIZE, confidence: 1 },
    masks: [
      observeMask(photographed(0.65, 90, crack(40, 30, 220, 60)), {
        id: "crack-1",
        label: "crack",
        confidence: 0.9,
        ...(stretch ? { stretch } : {}),
      }),
    ],
    scaleReference: measured.reference,
  };
}
