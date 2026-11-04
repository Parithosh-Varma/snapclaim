/**
 * Cloud-by-default compute policy: no phone CPU/GPU work unless the user
 * opts in via Settings → Compute. Port of pwa/compute.js (plain helpers,
 * no DOM) so both apps share one policy.
 *
 * - onDeviceEnabled: the Settings toggle. Missing key (existing users) is OFF.
 * - isLowMem: unknown (or 0) deviceMemory counts as low (fail safe, not fast).
 * - embedSize: SlimSAM embed input capped at a 640px long edge so a 2-3 GB
 *   phone never posts a 1024px ImageData into WASM/WebGPU unless asked to.
 */

/** Long-edge cap for the on-device embed input, in pixels. */
export const EMBED_LONG_EDGE = 640;

const SETTINGS_KEY = "snapclaim.settings.v1";

/**
 * @param settings value of the app store settings (or unknown storage shape)
 * @returns true only with an explicit opt-in
 */
export function onDeviceEnabled(settings: unknown): boolean {
  return !!(settings && typeof settings === "object" && (settings as Record<string, unknown>).onDevice === true);
}

/**
 * Single low-memory source: unknown (or 0) deviceMemory is low.
 * @param gb navigator.deviceMemory in GB
 */
export function isLowMem(gb: unknown): boolean {
  const n = Number(gb);
  if (!(n > 0)) return true;
  return n <= 4;
}

/**
 * Downscale dimensions so the long edge fits `cap` (default 640px).
 * Never upscales; every side stays >= 1px.
 */
export function embedSize(w: unknown, h: unknown, cap = EMBED_LONG_EDGE): { width: number; height: number } {
  const c = cap > 0 ? cap : EMBED_LONG_EDGE;
  const side = Math.min(1, c / Math.max(1, Math.max(Number(w) || 0, Number(h) || 0)));
  return {
    width: Math.max(1, Math.round((Number(w) || 0) * side)),
    height: Math.max(1, Math.round((Number(h) || 0) * side)),
  };
}

function readSettings(): Record<string, unknown> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(SETTINGS_KEY);
    const s: unknown = raw ? JSON.parse(raw) : {};
    return s && typeof s === "object" ? (s as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function deviceParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("device");
  } catch {
    return null;
  }
}

/**
 * Whether the on-device model may load at all. False unless the user opted
 * in via Settings → Compute AND the device is not low-memory. An explicit
 * `?device=wasm|webgpu` page param still forces it on (comparisons).
 * Unknown deviceMemory counts as low: fail safe, not fast.
 */
export function onDeviceAllowed(): boolean {
  if (deviceParam()) return true;
  try {
    const gb = typeof navigator !== "undefined" ? (navigator as unknown as { deviceMemory?: unknown }).deviceMemory : undefined;
    if (isLowMem(gb)) return false;
  } catch {
    return false;
  }
  return onDeviceEnabled(readSettings());
}
