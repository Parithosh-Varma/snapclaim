// SlimSAM worker client (public/sam-worker.js, copied from pwa/): the model
// download, per-photo embedding and tap decoding run off the main thread.
// Messages in: {type:"embed", photoId, image} / {type:"decode", id, photoId,
// point, preferSmallest}. Messages out: progress/ready/error and decoded.
import type { SamMask } from "./session";
import { decodeRle, encodeRle } from "./rle";
import { unionMasks } from "./mask";

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
      if (data.photoId !== undefined && data.photoId !== this.photoId) return; // stale photo
      if (data.type === "progress") this.onProgress?.({ percent: data.percent });
      else if (data.type === "ready") this.onReady?.(data.device, data.embedMs);
      else if (data.type === "error") this.onError?.(data.message);
    };
    w.onerror = (e) => this.onError?.(e.message ?? "worker error");
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
): Promise<SamMask> {
  const res = await fetch(base.replace(/\/$/, "") + "/v1/segment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageUrl: photo.toDataURL("image/jpeg", 0.85),
      width: photo.width,
      height: photo.height,
      points: points.map(([x, y]) => ({ x, y })),
    }),
  });
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean; error?: string;
    result?: { records?: { rle: Parameters<typeof decodeRle>[0]; confidence?: number }[] };
  };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `segment HTTP ${res.status}`);
  // SAM may split one crack into several objects; all of them are the damage.
  const records = j.result?.records ?? [];
  if (!records.length) throw new Error("SAM found nothing there — tap the middle of the damage and retry.");
  const mask = unionMasks(records.map((rec) => decodeRle(rec.rle))) as Uint8Array;
  return { mask, iou: Math.min(...records.map((rec) => rec.confidence ?? 0)), rle: encodeRle(mask, photo.width, photo.height) };
}
