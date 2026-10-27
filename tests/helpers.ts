import { readFileSync } from "node:fs";
import type { ComponentObservation, MaskObservation, ScaleReference } from "../src/engine/types.ts";

export interface WallFixture {
  imageId: string;
  component: ComponentObservation;
  masks: MaskObservation[];
  scaleReference: ScaleReference;
}

export function loadWallFixture(): WallFixture {
  const raw = readFileSync(new URL("../fixtures/masks/wall-crack.json", import.meta.url), "utf8");
  return JSON.parse(raw) as WallFixture;
}
