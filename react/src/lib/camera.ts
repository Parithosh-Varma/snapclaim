// Camera + coin gate, ported from pwa/app.js. The gate scans the live feed
// for a ring (coin edge), steadies on it, identifies it with the CoinModel
// global (public/coin-model.js), then counts down to an automatic capture.
// It talks to React through callbacks; DOM nodes stay in the Capture screen.
export interface RingDet {
  cx: number;
  cy: number;
  rr: number;
  score: number;
}

export interface GateCoinRaw extends RingDet {
  fw: number;
  fh: number;
}

interface CoinModelGlobal {
  Classifier: new () => {
    predict(fv: unknown, opts?: { countries?: string[] }): { label: string; confidence: number }[];
  };
  extractFeatures(
    data: Uint8ClampedArray, w: number, h: number,
    c: { x: number; y: number; r: number },
  ): unknown;
  DB: { id: string; label: string; diam: number }[];
}

function coinModel(): CoinModelGlobal {
  return (globalThis as unknown as { CoinModel: CoinModelGlobal }).CoinModel;
}

const SW = 224; // detection width: cheaper beats sticking to 256

function grayEdges(img: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    g[i] = 0.299 * (img[o] ?? 0) + 0.587 * (img[o + 1] ?? 0) + 0.114 * (img[o + 2] ?? 0);
  }
  const edge = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -(g[i - w - 1] ?? 0) - 2 * (g[i - 1] ?? 0) - (g[i + w - 1] ?? 0) + (g[i - w + 1] ?? 0) + 2 * (g[i + 1] ?? 0) + (g[i + w + 1] ?? 0);
      const gy = -(g[i - w - 1] ?? 0) - 2 * (g[i - w] ?? 0) - (g[i - w + 1] ?? 0) + (g[i + w - 1] ?? 0) + 2 * (g[i + w] ?? 0) + (g[i + w + 1] ?? 0);
      if (gx * gx + gy * gy > 9000) edge[i] = 1;
    }
  }
  return edge;
}

/** Biggest ring-like edge blob: centroid + radial uniformity score. */
export function findRing(edge: Uint8Array, w: number, h: number): RingDet | null {
  const seen = new Uint8Array(w * h);
  let best: RingDet | null = null;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!edge[s] || seen[s]) continue;
    let sx = 0;
    let sy = 0;
    let n = 0;
    const pts: number[] = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length && pts.length < 4000) {
      const i = stack.pop() as number;
      const x = i % w;
      const y = (i / w) | 0;
      pts.push(i);
      sx += x;
      sy += y;
      n++;
      if (x > 0 && !seen[i - 1] && edge[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !seen[i + 1] && edge[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !seen[i - w] && edge[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !seen[i + w] && edge[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    if (n < 25 || n > 4000) continue;
    const cx = sx / n;
    const cy = sy / n;
    let rr = 0;
    for (const i of pts) {
      const dx = (i % w) - cx;
      const dy = ((i / w) | 0) - cy;
      rr += Math.sqrt(dx * dx + dy * dy);
    }
    rr /= n;
    if (rr < w * 0.02 || rr > w * 0.35) continue;
    let inband = 0;
    const tol = Math.max(1.5, rr * 0.18);
    for (const i of pts) {
      const dx = (i % w) - cx;
      const dy = ((i / w) | 0) - cy;
      if (Math.abs(Math.sqrt(dx * dx + dy * dy) - rr) <= tol) inband++;
    }
    const score = inband / n;
    if (score > 0.6 && (!best || score > best.score)) best = { cx, cy, rr, score };
  }
  return best;
}

export interface GateCallbacks {
  onHint(text: string): void;
  /** Ring overlay in CSS px, or null to hide it. Locked = shutter disabled. */
  onRing(r: { left: number; top: number; size: number } | null, locked: boolean): void;
  onCount(n: number | null): void;
  onCoinIdentified(label: string, diamMm: number): void;
  onAutoCapture(): void;
  onCameraError(errName: string): void;
}

export class CoinGate {
  private video: HTMLVideoElement;
  private cb: GateCallbacks;
  private work = document.createElement("canvas");
  private full = document.createElement("canvas");
  private history: (RingDet | null)[] = [];
  private stream: MediaStream | null = null;
  private clf: InstanceType<CoinModelGlobal["Classifier"]> | null = null;
  coinSeen = false;
  smooth: RingDet | null = null;
  coinLabel = "";
  /** Diameter of the identified coin in mm; 0 until a known coin is confirmed. */
  coinMm = 0;
  private assistPt: { x: number; y: number } | null = null;
  private assistScan = 0;
  private scanCount = 0;
  private lastDetAt = 0;
  private captureTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(video: HTMLVideoElement, cb: GateCallbacks) {
    this.video = video;
    this.cb = cb;
  }

  get videoEl(): HTMLVideoElement {
    return this.video;
  }

  /** Current smoothed detection + its scan-frame size, for the still capture. */
  gateCoinRaw(): GateCoinRaw | null {
    if (!this.smooth || !this.video.videoWidth) return null;
    const fh = Math.round((SW * this.video.videoHeight) / this.video.videoWidth);
    return { ...this.smooth, fw: SW, fh };
  }

  debug(): Record<string, unknown> {
    return {
      coinSeen: this.coinSeen,
      assist: !!this.assistPt,
      scans: this.scanCount,
      lastDetAgo: this.scanCount - this.lastDetAt,
    };
  }

  async acquire(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cb.onCameraError("unsupported");
      return;
    }
    const backCam: MediaStreamConstraints = { video: { facingMode: { exact: "environment" } }, audio: false };
    const anyCam: MediaStreamConstraints = { video: { facingMode: "environment" }, audio: false };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(backCam).catch(() =>
        navigator.mediaDevices.getUserMedia(anyCam));
      this.stream = stream;
      (stream as MediaStream & { oninactive: (() => void) | null }).oninactive = () => {
        this.coinSeen = false;
        this.smooth = null;
        this.history.length = 0;
        this.cancelCapture();
        this.cb.onCameraError("stopped");
      };
      this.video.srcObject = stream;
      await this.video.play();
      this.running = true;
      this.scan();
    } catch (e) {
      this.cb.onCameraError((e as { name?: string })?.name ?? "unknown");
    }
  }

  stop(): void {
    this.running = false;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.cancelCapture();
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  reset(): void {
    this.coinSeen = false;
    this.smooth = null;
    this.coinLabel = "";
    this.coinMm = 0;
    this.history.length = 0;
    this.assistPt = null;
    this.setLocked(true, "Add a coin for scale");
  }

  /** Percent-only path: unlocks the shutter without a coin. */
  unlockWithoutScale(): void {
    this.setLocked(false, "Percent-only — no scale. Tap to snap.");
    this.cancelCapture();
  }

  /** Tap-to-assist: narrows the search window; the ring must still be found. */
  assistAt(clientX: number, clientY: number): void {
    if (this.coinSeen || !this.video.videoWidth) return;
    const r = this.video.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    const fw = SW;
    const fh = Math.round((SW * this.video.videoHeight) / this.video.videoWidth);
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const scale = Math.max(vw / fw, vh / fh);
    const ox = (vw - fw * scale) / 2 / scale;
    const oy = (vh - fh * scale) / 2 / scale;
    this.assistPt = {
      x: Math.max(0, Math.min(fw, (fx * vw) / scale - ox)),
      y: Math.max(0, Math.min(fh, (fy * vh) / scale - oy)),
    };
    this.assistScan = this.scanCount;
    this.cb.onHint("Checking that spot…");
  }

  private setLocked(locked: boolean, label?: string): void {
    if (label) this.cb.onHint(label);
    this.cb.onRing(locked ? null : this.ringBox(), locked);
  }

  private ringBox(): { left: number; top: number; size: number } | null {
    if (!this.smooth || !this.video.videoWidth) return null;
    const fw = SW;
    const fh = Math.round((SW * this.video.videoHeight) / this.video.videoWidth);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.max(vw / fw, vh / fh);
    const dw = fw * scale;
    const dh = fh * scale;
    const ox = (vw - dw) / 2;
    const oy = (vh - dh) / 2;
    const cx = ox + (this.smooth.cx / fw) * dw;
    const cy = oy + (this.smooth.cy / fh) * dh;
    const r = Math.min(Math.max((this.smooth.rr / fw) * dw, 28), Math.min(vw, vh) * 0.4);
    return { left: cx - r, top: cy - r, size: r * 2 };
  }

  private identifyCoin(det: RingDet, fw: number, fh: number): void {
    try {
      const CM = coinModel();
      this.clf ??= new CM.Classifier();
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      if (!vw) return;
      const k = Math.min(1, 640 / Math.max(vw, vh));
      this.full.width = Math.round(vw * k);
      this.full.height = Math.round(vh * k);
      const fctx = this.full.getContext("2d", { willReadFrequently: true });
      if (!fctx) return;
      fctx.drawImage(this.video, 0, 0, this.full.width, this.full.height);
      const img = fctx.getImageData(0, 0, this.full.width, this.full.height);
      const kx = (this.full.width / fw) * det.cx;
      const ky = (this.full.height / fh) * det.cy;
      const kr = (this.full.width / fw) * det.rr;
      const fv = CM.extractFeatures(img.data, this.full.width, this.full.height, { x: kx, y: ky, r: kr });
      const best = this.clf.predict(fv)[0];
      if (best && best.label !== "unknown") {
        const def = CM.DB.find((d) => d.id === best.label);
        this.coinLabel = def ? `${def.label} · Ø${def.diam} mm` : best.label;
        this.coinMm = def?.diam ?? 0;
        this.cb.onCoinIdentified(this.coinLabel, this.coinMm);
        this.cb.onHint(`${this.coinLabel} (${Math.round(best.confidence * 100)}%) — hold steady…`);
      } else {
        this.coinLabel = "";
        this.coinMm = 0;
        this.cb.onCoinIdentified("", 0);
        this.cb.onHint("Coin found — hold steady…");
      }
    } catch { /* ID is advisory; the gate stands on geometry */ }
  }

  private armCapture(): void {
    this.cancelCapture();
    let n = 3;
    this.cb.onHint("Hold steady…");
    this.cb.onCount(3);
    this.countdownTimer = setInterval(() => {
      n--;
      if (n > 0) this.cb.onCount(n);
    }, 1000);
    this.captureTimer = setTimeout(() => {
      this.cancelCapture();
      if (this.coinSeen) this.cb.onAutoCapture();
    }, 3000);
  }

  private cancelCapture(): void {
    if (this.captureTimer) clearTimeout(this.captureTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.captureTimer = null;
    this.countdownTimer = null;
    this.cb.onCount(null);
  }

  private scan = (): void => {
    if (!this.running) return;
    if (!this.video.videoWidth) {
      this.scanTimer = setTimeout(this.scan, 500);
      return;
    }
    try {
      this.scanFrame();
    } catch { /* one bad frame must never kill the loop */ }
    this.scanTimer = setTimeout(this.scan, 200);
  };

  private scanFrame(): void {
    const fw = SW;
    const fh = Math.round((SW * this.video.videoHeight) / this.video.videoWidth);
    this.work.width = fw;
    this.work.height = fh;
    const wctx = this.work.getContext("2d", { willReadFrequently: true });
    if (!wctx) return;
    wctx.drawImage(this.video, 0, 0, fw, fh);
    const img = wctx.getImageData(0, 0, fw, fh);
    const edge = grayEdges(img.data, fw, fh);
    let found: RingDet | null = null;
    if (this.assistPt) {
      if (this.scanCount - this.assistScan > 50) this.assistPt = null; // assist expires after ~10 s
      else {
        const r = Math.round(fw * 0.25);
        const x0 = Math.max(0, Math.round(this.assistPt.x - r));
        const x1 = Math.min(fw, Math.round(this.assistPt.x + r));
        const y0 = Math.max(0, Math.round(this.assistPt.y - r));
        const y1 = Math.min(fh, Math.round(this.assistPt.y + r));
        const sub = new Uint8Array((x1 - x0) * (y1 - y0));
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sub[(y - y0) * (x1 - x0) + (x - x0)] = edge[y * fw + x] ?? 0;
        const sub0 = findRing(sub, x1 - x0, y1 - y0);
        if (sub0) found = { cx: sub0.cx + x0, cy: sub0.cy + y0, rr: sub0.rr, score: sub0.score };
      }
    }
    if (!found && !this.assistPt) found = findRing(edge, fw, fh);
    const tooClose = !!found && found.rr > fw * 0.32;
    const det = found && !tooClose ? found : null;
    if (tooClose) {
      this.history.push(null);
      if (this.history.length > 10) this.history.shift();
      this.cancelCapture();
      if (this.coinSeen) this.cb.onHint("A bit too close — move back a little");
      return;
    }
    this.history.push(det);
    if (this.history.length > 10) this.history.shift();
    this.scanCount++;
    if (det) this.lastDetAt = this.scanCount;
    if (!this.coinSeen && !this.assistPt && this.scanCount > 25 && this.scanCount - this.lastDetAt > 25) {
      this.cb.onHint("No coin yet — tap it to point");
    }
    const recent = this.history.filter((d): d is RingDet => !!d);
    const need = this.assistPt ? 3 : 6;
    const tol = this.assistPt ? 30 : 25;
    let steady = false;
    if (recent.length >= need) {
      const xs = recent.map((d) => d.cx).sort((a, b) => a - b);
      const ys = recent.map((d) => d.cy).sort((a, b) => a - b);
      const med = { cx: xs[recent.length >> 1] ?? 0, cy: ys[recent.length >> 1] ?? 0 };
      steady = recent.every((d) => Math.hypot(d.cx - med.cx, d.cy - med.cy) < tol);
    }
    if (steady) {
      const d = recent[recent.length - 1] as RingDet;
      this.smooth = this.smooth
        ? {
            cx: this.smooth.cx + (d.cx - this.smooth.cx) * 0.35,
            cy: this.smooth.cy + (d.cy - this.smooth.cy) * 0.35,
            rr: this.smooth.rr + (d.rr - this.smooth.rr) * 0.35,
            score: d.score,
          }
        : { ...d };
      this.cb.onRing(this.ringBox(), false);
      if (!this.coinSeen) {
        this.coinSeen = true;
        this.identifyCoin(this.smooth, fw, fh);
        this.armCapture();
      }
    } else if (this.coinSeen && recent.length < 3) {
      this.cancelCapture();
      this.coinSeen = false;
      this.smooth = null;
      this.coinLabel = "";
      this.coinMm = 0;
      this.cb.onCoinIdentified("", 0);
      this.assistPt = null;
      this.setLocked(true, "Add a coin for scale");
    }
  }
}
