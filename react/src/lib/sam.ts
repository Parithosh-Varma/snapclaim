// SlimSAM worker client (public/sam-worker.js, copied from pwa/): the model
// download, per-photo embedding and tap decoding run off the main thread.
// Messages in: {type:"embed", photoId, image} / {type:"decode", id, photoId,
// point, preferSmallest}. Messages out: progress/ready/error and decoded.
import type { SamMask } from "./session.ts";
import { decodeRle, encodeRle, type Rle } from "./rle.ts";
import { unionMasks } from "./mask.ts";

export interface SamProgress {
  percent: number;
}

type Pending = { resolve: (m: SamMask | null) => void; reject: (e: Error) => void };

export class SamClient {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private decodeId = 0;
  photoId = 0;
  onProgress: ((p: SamProgress) => void) | null = null;
  onReady: ((device: string, embedMs: number) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  private embedWaiters = new Map<number, { resolve: (v: boolean) => void; timer: ReturnType<typeof setTimeout>; quiet: boolean }>();
  private settleStale: ((v: boolean) => void) | null = null;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const url = new URL("sam-worker.js", window.location.href);
    // ?device=wasm|webgpu on the page URL forces the worker's backend, for comparisons.
    const device = new URLSearchParams(window.location.search).get("device");
    if (device) url.searchParams.set("device", device);
    const w = new Worker(url, { type: "module" });
    w.onmessage = ({ data }: MessageEvent) => {
      if (data.type === "decoded") {
        const p = this.pending.get(data.id);
        if (!p) return;
        this.pending.delete(data.id);
        if (data.error) p.reject(new Error(data.error));
        else if (!data.result) p.resolve(null);
        else p.resolve({ mask: data.result.mask, iou: data.result.iou });
        return;
      }
      if (data.type === "progress" || data.type === "ready" || data.type === "error") {
        const waiter = data.photoId !== undefined ? this.embedWaiters.get(data.photoId) : undefined;
        if (data.type === "progress") {
          if (waiter) {
            // Quiet embeds (background warm-up) must not drive the UI progress bar.
            if (!waiter.quiet) this.onProgress?.({ percent: data.percent });
          } else if (data.photoId === undefined || data.photoId === this.photoId) {
            this.onProgress?.({ percent: data.percent });
          }
          return;
        }
        if (data.type === "ready") {
          if (waiter) {
            this.lastError = null;
            waiter.resolve(true);
            // Still notify the UI so embeddings.current flips even when the
            // ready came from an ensureEmbedded call.
            if (data.photoId === this.photoId) this.onReady?.(data.device, data.embedMs);
            return;
          }
          if (data.photoId !== undefined && data.photoId !== this.photoId) return; // stale photo
          this.onReady?.(data.device, data.embedMs);
          return;
        }
        if (data.type === "error") {
          if (waiter) {
            this.lastError = data.message;
            waiter.resolve(false);
            if (data.photoId === this.photoId) this.onError?.(data.message);
            return;
          }
          if (data.photoId !== undefined && data.photoId !== this.photoId) return; // stale photo
          this.onError?.(data.message);
          return;
        }
      }
      if (data.photoId !== undefined && data.photoId !== this.photoId) return; // stale photo
      if (data.type === "progress") this.onProgress?.({ percent: data.percent });
      else if (data.type === "ready") this.onReady?.(data.device, data.embedMs);
      else if (data.type === "error") this.onError?.(data.message);
    };
    w.onerror = (e) => {
      // Worker failed to start: fail all pending embeds fast, not via 180s timeout.
      for (const [, waiter] of [...this.embedWaiters]) {
        try { waiter.resolve(false); } catch { /* noop */ }
      }
      this.onError?.((e as ErrorEvent).message ?? "worker error");
    };
    this.worker = w;
    return w;
  }

  embed(photo: HTMLCanvasElement): void {
    const ctx = photo.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const image = ctx.getImageData(0, 0, photo.width, photo.height);
    this.photoId++;
    this.ensure().postMessage(
      { type: "embed", photoId: this.photoId, image: { data: image.data, width: image.width, height: image.height } },
      [image.data.buffer],
    );
  }

  private embedCache = new Map<HTMLCanvasElement, Promise<boolean>>();
  /** Last on-device failure, for error messages that name the cause. */
  lastError: string | null = null;

  /**
   * Embed the photo for on-device outlining, once per photo. Resolves true
   * when the model is ready, false when it fails or a newer photo supersedes
   * it. Damage taps go to cloud SAM first, so this is only awaited for the
   * coin outline, the offline fallback and the cross-check - never on entry.
   */
  ensureEmbedded(photo: HTMLCanvasElement, quiet = false): Promise<boolean> {
    const hit = this.embedCache.get(photo);
    if (hit) return hit;
    // A newer photo supersedes any in-flight embed: settle it instead of hanging.
    this.settleStale?.(false);
    this.settleStale = null;
    this.lastError = null;
    const before = this.photoId;
    this.embed(photo);
    // No 2d context: nothing was posted, fail fast instead of 180s hang.
    if (this.photoId === before) return Promise.resolve(false);
    const pid = this.photoId;
    const p = new Promise<boolean>((resolve) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        this.embedWaiters.delete(pid);
        this.settleStale = null;
        this.lastError = "model download timed out";
        this.embedCache.delete(photo);
        resolve(false);
      }, 180_000);
      const done = (v: boolean) => {
        clearTimeout(timer);
        this.embedWaiters.delete(pid);
        this.settleStale = null;
        // Never cache a failure: retry must re-attempt the download.
        if (!v) this.embedCache.delete(photo);
        resolve(v);
      };
      this.settleStale = (v: boolean) => {
        clearTimeout(timer);
        this.embedWaiters.delete(pid);
        this.settleStale = null;
        if (!v) this.embedCache.delete(photo);
        resolve(v);
      };
      this.embedWaiters.set(pid, { resolve: done, timer, quiet });
    });
    this.embedCache.set(photo, p);
    if (this.embedCache.size > 3) {
      const oldest = this.embedCache.keys().next();
      if (!oldest.done && oldest.value !== photo) this.embedCache.delete(oldest.value);
    }
    return p;
  }

  decode(point: [number, number], preferSmallest: boolean): Promise<SamMask | null> {
    const id = this.decodeId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ensure().postMessage({ type: "decode", id, photoId: this.photoId, point, preferSmallest });
    });
  }

  /** Damage taps: SAM's smallest confident candidate, not the wall around it. */
  decodeDamage(point: [number, number]): Promise<SamMask | null> {
    return this.decode(point, true);
  }

  /** Coins are compact: they keep SAM's best-scoring candidate. */
  decodeCoin(point: [number, number]): Promise<SamMask | null> {
    return this.decode(point, false);
  }
}

/** SAM 3.1 via the backend: one call for all taps so far. Throws on failure. */
export async function segmentViaApi(
  base: string,
  photo: HTMLCanvasElement,
  points: [number, number][],
  box?: { left: number; top: number; right: number; bottom: number },
  signal?: AbortSignal,
): Promise<SamMask> {
  const { apiPost } = await import("./api.ts");
  const { res, j } = await apiPost(base, "/v1/segment", {
    imageUrl: photo.toDataURL("image/jpeg", 0.85),
    width: photo.width,
    height: photo.height,
    points: points.map(([x, y]) => ({ x, y })),
    ...(box ? { box } : {}),
  }, signal);
  const result = (j.result ?? {}) as {
    records?: { rle: Parameters<typeof decodeRle>[0]; confidence?: number }[];
  };
  if (!res.ok || !j.ok) throw new Error((j as { error?: string }).error ?? `segment HTTP ${res.status}`);
  // SAM may split one crack into several objects; all of them are the damage.
  // But a single tap on a thin crack often returns the wall itself (90%+ of
  // the frame, high confidence) instead of the crack - unioning that buries
  // the damage. Drop wall-sized records before the union; when nothing but
  // wall remains, throw so the caller falls back to on-device SlimSAM, whose
  // prefer-smallest decode picks the crack over the wall.
  const records = result.records ?? [];
  if (!records.length) throw new Error("SAM found nothing there - tap the middle of the damage and retry.");
  const framePx = photo.width * photo.height;
  const kept = records.filter((rec) => {
    try {
      const m = decodeRle(rec.rle);
      let n = 0;
      for (let i = 0; i < m.length; i++) if (m[i]) n++;
      return n <= framePx * 0.5;
    } catch {
      return false;
    }
  });
  if (!kept.length) throw new Error("SAM caught the wall, not the crack - trying on-device; fill the frame with the crack and tap its middle.");
  const mask = unionMasks(kept.map((rec) => decodeRle(rec.rle))) as Uint8Array;
  return { mask, iou: Math.min(...kept.map((rec) => rec.confidence ?? 0)), rle: encodeRle(mask, photo.width, photo.height) };
}

export interface CoinOutline {
  mask: Uint8Array;
  iou: number;
  rle: Rle;
}

/** Compactness of a binary mask: 4πA/P², 1 for a disc. Coins are discs;
    cracks, shadows and wall patches are not. P is the boundary-pixel count. */
function compactness(mask: Uint8Array, w: number, h: number, area: number): number {
  let edge = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (
        x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        !mask[y * w + x - 1] || !mask[y * w + x + 1] ||
        !mask[(y - 1) * w + x] || !mask[(y + 1) * w + x]
      ) edge++;
    }
  }
  if (!edge) return 0;
  return (4 * Math.PI * area) / (edge * edge);
}

/**
 * Pick the coin among SAM's candidates for a tap. Must contain the tap,
 * coin-sized (a wall slab is never a coin) and the most disc-like of those.
 * Pure - unit-tested without a backend.
 */
export function pickCoinRecord(
  records: { rle: Rle; confidence?: number }[],
  tap: [number, number],
  w: number,
  h: number,
): { mask: Uint8Array; iou: number } | null {
  const framePx = w * h;
  const tx = Math.min(w - 1, Math.max(0, Math.round(tap[0])));
  const ty = Math.min(h - 1, Math.max(0, Math.round(tap[1])));
  let best: { mask: Uint8Array; iou: number } | null = null;
  let bestScore = 0;
  for (const rec of records) {
    let mask: Uint8Array;
    try {
      mask = decodeRle(rec.rle);
    } catch {
      continue;
    }
    if (mask.length !== framePx) continue;
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      n++;
      sx += i % w;
      sy += Math.floor(i / w);
    }
    // Speckle is not a coin; a wall slab is not a coin.
    if (n < 20 || n > framePx * 0.25) continue;
    if (!mask[ty * w + tx]) continue;
    const dist = Math.hypot(sx / n - tap[0], sy / n - tap[1]);
    const score = (compactness(mask, w, h, n) * (rec.confidence ?? 0.5)) / (1 + dist / Math.sqrt(n));
    if (score > bestScore) {
      bestScore = score;
      best = { mask, iou: rec.confidence ?? 0.5 };
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Outline the coin at a manual tap via the SAM 3.1 API - the same mechanism
 * as the crack tap. Throws when nothing coin-like is under the tap.
 */
export async function segmentCoinViaApi(
  base: string,
  photo: HTMLCanvasElement,
  point: [number, number],
): Promise<CoinOutline> {
  const { apiPost } = await import("./api.ts");
  const { res, j } = await apiPost(base, "/v1/segment", {
    imageUrl: photo.toDataURL("image/jpeg", 0.85),
    width: photo.width,
    height: photo.height,
    points: [{ x: point[0], y: point[1] }],
  });
  const result = (j.result ?? {}) as {
    records?: { rle: Rle; confidence?: number }[];
  };
  if (!res.ok || !j.ok) throw new Error((j as { error?: string }).error ?? `segment HTTP ${res.status}`);
  const records = result.records ?? [];
  if (!records.length) throw new Error("SAM found nothing there - tap the middle of the coin.");
  const picked = pickCoinRecord(records, point, photo.width, photo.height);
  if (!picked) throw new Error("No coin found there - tap the middle of the coin.");
  return { ...picked, rle: encodeRle(picked.mask, photo.width, photo.height) };
}
