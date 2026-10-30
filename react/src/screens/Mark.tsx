import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { apiPost } from "../lib/api";
import { checkPhoto } from "../lib/photo-check";
import { circleRle, encodeRle } from "../lib/rle";
import { closeMask } from "../lib/mask";
import { segmentViaApi, type SamClient } from "../lib/sam";
import { COIN_OPTIONS, resetDmg, type SamMask, type Session } from "../lib/session";
import { BackButton, Stepper } from "../lib/ui";

const MAX_SIDE = 512;
const CHIPS: { id: string; label: string; text: string }[] = [
  { id: "chipCrack", label: "crack", text: "Crack" },
  { id: "chipStain", label: "stain", text: "Stain" },
  { id: "chipPeel", label: "peel", text: "Peel" },
  { id: "chipDent", label: "dent", text: "Dent" },
];

/** On-device union of one SlimSAM mask per tap; null when no tap found anything. */
async function segmentOnDevice(sam: SamClient, s: Session): Promise<SamMask | null> {
  while (s.dmg.pointMasks.length < s.dmg.points.length) {
    s.dmg.pointMasks.push(await sam.decodeDamage(s.dmg.points[s.dmg.pointMasks.length] as [number, number]));
  }
  const found = s.dmg.pointMasks.filter((m): m is SamMask => !!m);
  if (!found.length) return null;
  const union = new Uint8Array((found[0] as SamMask).mask.length);
  for (const { mask } of found) for (let i = 0; i < union.length; i++) union[i] = (union[i] ?? 0) | (mask[i] ?? 0);
  return { mask: union, iou: Math.min(...found.map((f) => f.iou)) } as SamMask;
}

export default function Mark() {
  const ctx = useApp();
  const { session: s, go, base, sam, embeddings } = ctx;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Tap the crack, then Measure.");
  const [tfState, setTfState] = useState("");
  const [photoNotes, setPhotoNotes] = useState("");
  const [label, setLabel] = useState(s.dmgLabel);
  const [coinKind, setCoinKind] = useState(s.coinKindMm);
  const [hasMask, setHasMask] = useState(!!s.dmg.mask);
  const [ready, setReady] = useState(false);

  const drawMark = useCallback(() => {
    const c = canvasRef.current;
    const photo = s.photo;
    if (!c || !photo) return;
    c.width = photo.width;
    c.height = photo.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return;
    g.drawImage(photo, 0, 0);
    if (s.dmg.mask) {
      const img = g.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < s.dmg.mask.length; i++) {
        if (!s.dmg.mask[i]) continue;
        const o = i * 4;
        img.data[o] = (img.data[o] ?? 0) * 0.55 + 196 * 0.45;
        img.data[o + 1] = (img.data[o + 1] ?? 0) * 0.55 + 31 * 0.45;
        img.data[o + 2] = (img.data[o + 2] ?? 0) * 0.55 + 41 * 0.45;
      }
      g.putImageData(img, 0, 0);
    }
    if (s.gateCoin) {
      const kx = photo.width / s.gateCoin.sw;
      const ky = photo.height / s.gateCoin.sh;
      const cx = (s.gateCoin.cx / s.gateCoin.fw) * s.gateCoin.sw * kx;
      const cy = (s.gateCoin.cy / s.gateCoin.fh) * s.gateCoin.sh * ky;
      const r = (s.gateCoin.rr / s.gateCoin.fw) * s.gateCoin.sw * kx;
      g.strokeStyle = "#0e8a4d";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = "#c81e2b";
    g.strokeStyle = "#fff";
    g.lineWidth = 2;
    for (const [x, y] of s.dmg.points) {
      g.beginPath();
      g.arc(x, y, Math.max(5, c.width / 120), 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    setHasMask(!!s.dmg.mask);
  }, [s]);

  /* build the marking photo + start the SlimSAM embed for this photo */
  useEffect(() => {
    sam.onProgress = ({ percent }) => setTfState(`Downloading the outlining model… ${percent}%`);
    sam.onReady = (device, embedMs) => {
      embeddings.current = true;
      setTfState("");
      console.info(`[sam] embedded on ${device} in ${embedMs} ms`);
    };
    sam.onError = (message) => setStatus(`Outlining unavailable (${message}). Check the connection and retry.`);
    if (s.photo && s.photoFor === s.stillDataUrl) {
      setReady(true);
      drawMark();
      return;
    }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const photo = document.createElement("canvas");
      photo.width = Math.round(img.width * scale);
      photo.height = Math.round(img.height * scale);
      photo.getContext("2d", { willReadFrequently: true })?.drawImage(img, 0, 0, photo.width, photo.height);
      s.photo = photo;
      s.photoFor = s.stillDataUrl;
      resetDmg(s);
      embeddings.current = false;
      setReady(true);
      drawMark();
      sam.embed(photo);
    };
    img.src = s.stillDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** SAM's outline of the coin at the gate's circle, or null when it doesn't look like that coin. */
  const traceCoin = useCallback(
    async (cx: number, cy: number, r: number, w: number, h: number): Promise<SamMask | null> => {
      if (!embeddings.current) return null;
      let out: SamMask | null;
      try {
        out = await sam.decodeCoin([Math.round(cx), Math.round(cy)]);
      } catch {
        return null;
      }
      if (!out) return null;
      let area = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < out.mask.length; i++) {
        if (out.mask[i]) {
          area++;
          sx += i % w;
          sy += (i / w) | 0;
        }
      }
      const circle = Math.PI * r * r;
      if (area < circle * 0.4 || area > circle * 1.6) return null;
      if (Math.hypot(sx / area - cx, sy / area - cy) > r * 0.5) return null;
      return out;
    },
    [embeddings, sam],
  );

  const measure = useCallback(async () => {
    if (!s.dmg.mask || !s.photo) return;
    try {
      const px = s.photo.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, s.photo.width, s.photo.height);
      if (px) setPhotoNotes(checkPhoto({ width: px.width, height: px.height, data: px.data }, Math.max(s.photo.width, s.photo.height)).join(" "));
    } catch { /* advisory only */ }
    const w = s.photo.width;
    const h = s.photo.height;
    ctx.setNumError(null);
    ctx.setMeasuring(true);
    go("sNum");
    const body: Record<string, unknown> = {
      masks: [{ id: "damage-1", label: s.dmgLabel, rle: encodeRle(s.dmg.mask, w, h), confidence: s.dmg.iou || 0.8 }],
    };
    let circleRef: Record<string, unknown> | null = null;
    if (s.gateCoin) {
      const kx = w / s.gateCoin.sw;
      const ky = h / s.gateCoin.sh;
      const cx = (s.gateCoin.cx / s.gateCoin.fw) * s.gateCoin.sw * kx;
      const cy = (s.gateCoin.cy / s.gateCoin.fh) * s.gateCoin.sh * ky;
      const r = Math.max(3, (s.gateCoin.rr / s.gateCoin.fw) * s.gateCoin.sw * kx);
      circleRef = { id: "coin", rle: circleRle(cx, cy, r, w, h), knownMm: s.coinKindMm, confidence: 0.85 };
      // The coin's real outline, not the gate's circle: a tilted wall shows the
      // coin as an ellipse, and the backend uses that to correct crack lengths.
      const traced = await traceCoin(cx, cy, r, w, h);
      body.reference = traced ? { ...circleRef, rle: encodeRle(traced.mask, w, h), confidence: traced.iou } : circleRef;
    } else if (s.noScaleMode) body.note = "percent-only requested";
    setStatus("");
    try {
      let { res, j } = await apiPost(base, "/v1/observe", body);
      // a traced outline the backend refuses (not coin-shaped) falls back to the gate's circle
      if (res.status === 422 && circleRef && body.reference !== circleRef) {
        console.info(`[coin] traced outline refused (${j.error}); using the detected circle`);
        body.reference = circleRef;
        ({ res, j } = await apiPost(base, "/v1/observe", body));
      }
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const m = await apiPost(base, "/v1/measure", j.result);
      if (!m.res.ok || !m.j.ok) throw new Error(m.j.error ?? `HTTP ${m.res.status}`);
      s.payload = j.result as typeof s.payload;
      s.measurement = m.j.result as unknown as typeof s.measurement;
      s.autoListen = true;
      ctx.setMeasuring(false);
      go("sSay");
    } catch (e) {
      ctx.setMeasuring(false);
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Measuring failed (${msg}).`);
      ctx.setNumError({ title: "Measurement failed", detail: msg });
      go("sNum");
    }
  }, [base, ctx, go, s, traceCoin]);

  useEffect(() => {
    ctx.measureRef.current = measure;
  }, [ctx.measureRef, measure]);

  const onTap = async (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!s.photo || !ready) return;
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const x = Math.round((ev.clientX - r.left) * (c.width / r.width));
    const y = Math.round((ev.clientY - r.top) * (c.height / r.height));
    s.dmg.points.push([x, y]);
    setStatus("Outlining…");
    // SAM 3.1 API first; the on-device model only when the API call fails.
    let out: SamMask | null = null;
    let source: "api" | "device" = "api";
    try {
      out = await segmentViaApi(base, s.photo, s.dmg.points);
    } catch (e) {
      console.info("[sam] API failed, using on-device", e);
      source = "device";
      if (!embeddings.current) {
        s.dmg.points.pop();
        setStatus("Outlining model still loading…");
        drawMark();
        return;
      }
      try {
        out = await segmentOnDevice(sam, s);
      } catch {
        out = null;
      }
    }
    if (out) {
      // Bridge hairline gaps (≤4 px) so one crack reads as one region, not
      // speckle. Done here so the outline shown is exactly what gets measured.
      s.dmg.mask = closeMask(out.mask, s.photo.width, s.photo.height, 2);
      s.dmg.iou = out.iou;
      s.dmg.source = source;
      setStatus(`Outlined (${Math.round(out.iou * 100)}% sure) via ${source === "api" ? "SAM 3.1 API" : "on-device"}.`);
    } else {
      s.dmg.mask = null;
      s.dmg.source = null;
      setStatus("No mask there. Tap the middle of it.");
    }
    drawMark();
  };

  return (
    <section className="screen on" aria-labelledby="h-mark">
      <div className="wrap">
        <BackButton label="Camera" onClick={() => go("capture")} />
        <Stepper step={2} />
        <h1 id="h-mark">Tap the damage.</h1>
        <p className="sub">One tap on the crack. The coin is already outlined from the gate.</p>
        <div className="card">
          <canvas id="markCanvas" ref={canvasRef} onPointerDown={onTap} />
          <div className="seg" role="group" aria-label="Damage type">
            {CHIPS.slice(0, 2).map((chip) => (
              <button
                key={chip.id}
                id={chip.id}
                type="button"
                className={label === chip.label ? "on" : undefined}
                onClick={() => {
                  setLabel(chip.label);
                  s.dmgLabel = chip.label;
                }}
              >
                {chip.text}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="More types">
            {CHIPS.slice(2).map((chip) => (
              <button
                key={chip.id}
                id={chip.id}
                type="button"
                className={label === chip.label ? "on" : undefined}
                onClick={() => {
                  setLabel(chip.label);
                  s.dmgLabel = chip.label;
                }}
              >
                {chip.text}
              </button>
            ))}
          </div>
          <label className="field">
            Coin (auto-detected — confirm)
            <select
              id="coinKind"
              value={coinKind}
              onChange={(e) => {
                const v = Number(e.target.value);
                setCoinKind(v);
                s.coinKindMm = v;
              }}
            >
              {COIN_OPTIONS.map((o) => (
                <option key={o.label} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <div id="photoNotes" className="hint" style={{ fontSize: 13, color: "#5b6b8c" }}>{photoNotes}</div>
          <div id="tfState" style={{ fontSize: 12, color: "#5b6b8c", fontFamily: "'IBM Plex Mono',monospace" }}>{tfState}</div>
          <button id="measureBtn" className="btn-primary" type="button" disabled={!hasMask} onClick={measure}>
            Measure damage
          </button>
          <span id="status">{status}</span>
        </div>
      </div>
    </section>
  );
}
