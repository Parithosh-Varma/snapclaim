// Types for ./mask-ops.js (plain JS shared by the PWA and the test suite).
export function unionMasks(masks: Uint8Array[]): Uint8Array | null;
export function closeMask(mask: Uint8Array, w: number, h: number, radius?: number): Uint8Array;
