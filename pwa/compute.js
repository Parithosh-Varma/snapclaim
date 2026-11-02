/**
 * Cloud-by-default compute policy: no phone CPU/GPU work unless the user
 * opts in via Settings → Compute. Pure helpers shared by the PWA shell and
 * the test suite (plain JS, no TS syntax - the PWA ships this file as-is).
 *
 * - onDeviceEnabled: the Settings toggle. Missing key (existing users) is OFF.
 * - isLowMem: unknown deviceMemory counts as low (fail safe, not fast).
 * - embedSize: SlimSAM embed input capped at a 640px long edge so a 2-3 GB
 *   phone never posts a 1024px ImageData into WASM/WebGPU unless asked to.
 */

/** Long-edge cap for the on-device embed input, in pixels. */
export const EMBED_LONG_EDGE = 640;

/**
 * @param {unknown} settings value of caseStore.getSettings()
 * @returns {boolean} true only with an explicit opt-in
 */
export function onDeviceEnabled(settings) {
  return !!(settings && typeof settings === "object" && settings.onDevice === true);
}

/**
 * Single low-memory source: unknown (or 0) deviceMemory is low.
 * @param {unknown} gb navigator.deviceMemory in GB
 */
export function isLowMem(gb) {
  const n = Number(gb);
  if (!(n > 0)) return true;
  return n <= 4;
}

/**
 * Downscale dimensions so the long edge fits `cap` (default 640px).
 * Never upscales; every side stays >= 1px.
 */
export function embedSize(w, h, cap) {
  const c = cap > 0 ? cap : EMBED_LONG_EDGE;
  const side = Math.min(1, c / Math.max(1, Math.max(Number(w) || 0, Number(h) || 0)));
  return {
    width: Math.max(1, Math.round((Number(w) || 0) * side)),
    height: Math.max(1, Math.round((Number(h) || 0) * side)),
  };
}
