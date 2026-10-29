export const TILT_WARN_DEG: number;
export const TILT_REFUSE_DEG: number;
export type Surface = "wall" | "floor";
export type TiltZone = "ok" | "flatter" | "refuse" | "unknown";

/** Degrees between the camera and facing the surface square on, or null without readings. */
export function tiltFromOrientation(beta: number | null, gamma: number | null, surface?: Surface): number | null;
export function tiltZone(deg: number | null): TiltZone;
export function tiltMessage(deg: number | null, surface?: Surface): string;
export function mountTiltMeter(el: unknown, opts?: { win?: unknown; surface?: Surface }): () => void;
