import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { apiPost } from "../lib/api";
import { checkPhoto } from "../lib/photo-check";
import { findCoins } from "../../../src/vision/coin-detect.js";
import { circleRle, encodeRle } from "../lib/rle";
import { closeMask } from "../lib/mask";
import { segmentViaApi, type SamClient } from "../lib/sam";
import { COIN_GROUPS, COIN_OPTIONS, resetDmg, type SamMask, type Session } from "../lib/session";
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
  // Wall-sized union is the room, not the damage — reject so the tap retries.
  let n = 0;
  for (let i = 0; i < union.length; i++) if (union[i]) n++;
  if (n > union.length * 0.5) return null;
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
  const [coinCustom, setCoinCustom] = useState("");
  const [hasMask, setHasMask] = useState(!!s.dmg.mask);
  const [tapCount, setTapCount] = useState(s.dmg.points.length);
  const [markBusy, setMarkBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [coinCorrect, setCoinCorrect] = useState(false);
  const [coinFixHint, setCoinFixHint] = useState("");
  const [taped, setTaped] = useState(s.coinTaped);

  /** Manual radius matches measure()'s circleRef radius (gate-derived, or a
   * 3.5% fallback when the gate missed) so the ring shows what gets measured. */
  const manualCoinRadius = () => {
    const photo = s.photo;
    if (!photo) return 12;
    return s.gateCoin
      ? Math.max(3, (s.gateCoin.rr / s.gateCoin.fw) * (photo.width / s.gateCoin.sw))
      : Math.max(10, photo.width * 0.035);
  };

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
    if (s.gateCoin && !s.coinManualPt) {
      const kx = photo.width / s.gateCoin.sw;
      const ky = photo.height / s.gateCoin.sh;
      const cx = (s.gateCoin.cx / s.gateCoin.fw) * s.gateCoin.sw * kx;
      const cy = (s.gateCoin.cy / s.gateCoin.fh) * s.gateCoin.sh * ky;
      const r = (s.gateCoin.rr / s.gateCoin.fw) * s.gateCoin.sw * kx;
      g.strokeStyle = s.coinTaped ? "#e6a700" : "#0e8a4d";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    if (s.coinManualPt) {
      // Same tap-to-outline as the crack: the traced coin fills green.
      // Before the trace lands (model still loading) fall back to the
      // estimated circle so the tap still shows something.
      if (s.coinMask) {
        const img = g.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < s.coinMask.length; i++) {
          if (!s.coinMask[i]) continue;
          const o = i * 4;
          img.data[o] = (img.data[o] ?? 0) * 0.55 + 14 * 0.45;
          img.data[o + 1] = (img.data[o + 1] ?? 0) * 0.55 + 138 * 0.45;
          img.data[o + 2] = (img.data[o + 2] ?? 0) * 0.55 + 77 * 0.45;
        }
        g.putImageData(img, 0, 0);
      } else {
        g.strokeStyle = "#c81e2b";
        g.lineWidth = 3;
        g.beginPath();
        g.arc(s.coinManualPt[0], s.coinManualPt[1], manualCoinRadius(), 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = "#c81e2b";
      g.beginPath();
      g.arc(s.coinManualPt[0], s.coinManualPt[1], 4, 0, Math.PI * 2);
      g.fill();
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
    setTapCount(s.dmg.points.length);
  }, [s]);

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
      // Tape halo inflates the mask (coin + tape strip) — allow 2.5× and a
      // looser centroid when taped, matching the vanilla PWA.
      const taped = s.coinTaped;
      if (area < circle * 0.4 || area > circle * (taped ? 2.5 : 1.6)) return null;
      if (Math.hypot(sx / area - cx, sy / area - cy) > r * (taped ? 0.75 : 0.5)) return null;
      return out;
    },
    [embeddings, sam, s],
  );

  /** Auto coin hunt: Hough proposes centres, SAM disposes. The first verified
      outline becomes the coin tap, same as a manual one — the user only picks
      the size. Runs only when the gate missed the coin entirely. */
  const huntCoin = useCallback(async (
    found: { x: number; y: number; r: number }[],
    photo: HTMLCanvasElement,
  ) => {
    const still = s.stillDataUrl;
    setCoinFixHint("Looking for the coin…");
    const ready = await sam.ensureEmbedded(photo);
    if (!ready || s.photoFor !== still || s.gateCoin || s.coinManualPt) {
      if (s.photoFor === still && !s.coinManualPt) setCoinFixHint("");
      return;
    }
    for (const c of found.slice(0, 3)) {
      if (s.photoFor !== still || s.coinManualPt) return;
      let traced: SamMask | null = null;
      try {
        traced = await traceCoin(c.x, c.y, Math.max(3, Math.round(c.r)), photo.width, photo.height);
      } catch {
        traced = null;
      }
      if (traced) {
        s.coinManualPt = [Math.round(c.x), Math.round(c.y)];
        s.coinMask = traced.mask;
        s.coinIou = traced.iou;
        setCoinFixHint(`Coin found (${Math.round(traced.iou * 100)}% sure) — pick its size`);
        drawMark();
        return;
      }
    }
    if (s.photoFor === still && !s.coinManualPt) setCoinFixHint("");
  }, [drawMark, s, sam, traceCoin]);

  /* build the marking photo; the on-device model embeds only on demand
     (coin outline, cloud fallback, cross-check) — never on entry */
  useEffect(() => {
    sam.onProgress = ({ percent }) => setTfState(`Downloading the outlining model… ${percent}%`);
    sam.onReady = (device, embedMs) => {
      embeddings.current = true;
      setTfState("");
      console.info(`[sam] embedded on ${device} in ${embedMs} ms`);
    };
    sam.onError = (message) => {
      setTfState("");
      setStatus(navigator.onLine === false
        ? "On-device outlining model not available offline yet — reconnect once to download it, then it works offline."
        : `Outlining unavailable (${message}). Check the connection and retry.`);
    };
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
      // A manual coin tap is pixel coords of the previous photo — never reuse it.
      s.coinManualPt = null;
      s.coinMask = null;
      s.coinIou = 0;
      embeddings.current = false;
      setReady(true);
      drawMark();
      // The gate missed the coin: hunt it on the still. Hough proposes
      // centres (contrast-stretched, so dull rims count), SAM verifies.
      if (!s.gateCoin && !s.coinManualPt) {
        try {
          const px = photo.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, photo.width, photo.height);
          const found = px ? findCoins({ data: px.data, width: px.width, height: px.height }) : [];
          if (found.length) void huntCoin(found, photo);
        } catch { /* hunt is best-effort; the tap button remains */ }
      }
    };
    img.src = s.stillDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Manual coin tap wins over the gate — taped coin or missed detection.
    const coinCxCyR = (() => {
      if (s.coinManualPt) {
        const estR = Math.max(10, w * 0.035);
        return {
          cx: s.coinManualPt[0],
          cy: s.coinManualPt[1],
          r: s.gateCoin ? Math.max(3, (s.gateCoin.rr / s.gateCoin.fw) * (w / s.gateCoin.sw)) : estR,
        };
      }
      if (!s.gateCoin) return null;
      const kx = w / s.gateCoin.sw;
      const ky = h / s.gateCoin.sh;
      return {
        cx: (s.gateCoin.cx / s.gateCoin.fw) * s.gateCoin.sw * kx,
        cy: (s.gateCoin.cy / s.gateCoin.fh) * s.gateCoin.sh * ky,
        r: Math.max(3, (s.gateCoin.rr / s.gateCoin.fw) * s.gateCoin.sw * kx),
      };
    })();
    if (coinCxCyR) {
      const { cx, cy, r } = coinCxCyR;
      circleRef = { id: "coin", rle: circleRle(cx, cy, r, w, h), knownMm: s.coinKindMm, confidence: s.coinManualPt ? 0.9 : 0.85 };
      // Tap-to-outline, same as the crack: the tap already traced the coin,
      // so measure exactly the green fill shown. Otherwise trace now (gate
      // circle or a tap that landed before the model loaded).
      const stored = s.coinManualPt && s.coinMask ? { mask: s.coinMask, iou: s.coinIou } : null;
      const traced = stored ?? await traceCoin(cx, cy, r, w, h);
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
    if (!s.photo || !ready || markBusy) return;
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const x = Math.round((ev.clientX - r.left) * (c.width / r.width));
    const y = Math.round((ev.clientY - r.top) * (c.height / r.height));
    if (coinCorrect) {
      s.coinManualPt = [x, y];
      s.coinMask = null;
      s.coinIou = 0;
      setCoinCorrect(false);
      setCoinFixHint("Outlining coin…");
      setMarkBusy(true);
      drawMark();
      // Same mechanism as the crack: trace now so the green fill shown is
      // exactly what gets measured. The model downloads on this first need,
      // not on entry. Falls back to the estimated circle when it fails.
      setCoinFixHint("Loading the coin model…");
      if (s.photo) {
        const ok = await sam.ensureEmbedded(s.photo);
        if (!ok) {
          embeddings.current = false;
          setCoinFixHint("Coin model failed to load — using the circle; pick its size");
          setMarkBusy(false);
          drawMark();
          return;
        }
      }
      if (embeddings.current && s.photo) {
        const w = s.photo.width;
        const h = s.photo.height;
        const rr = s.gateCoin ? Math.max(3, (s.gateCoin.rr / s.gateCoin.fw) * (w / s.gateCoin.sw)) : Math.max(10, w * 0.035);
        try {
          const traced = await traceCoin(x, y, rr, w, h);
          if (traced) {
            s.coinMask = traced.mask;
            s.coinIou = traced.iou;
            setCoinFixHint(`Coin outlined (${Math.round(traced.iou * 100)}% sure) — pick its size`);
          } else {
            setCoinFixHint("Coin outline unclear — using the circle; pick its size");
          }
        } catch {
          setCoinFixHint("Coin outline unclear — using the circle; pick its size");
        }
      } else {
        setCoinFixHint("Coin marked — outlines when the model loads; pick its size");
      }
      setMarkBusy(false);
      drawMark();
      return;
    }
    s.dmg.points.push([x, y]);
    setStatus("Outlining…");
    setMarkBusy(true);
    // SAM 3.1 API first; the on-device model only when the API call fails.
    let out: SamMask | null = null;
    let source: "api" | "device" = "api";
    try {
      out = await segmentViaApi(base, s.photo, s.dmg.points);
    } catch (e) {
      console.info("[sam] API failed, using on-device", e);
      source = "device";
      if (!embeddings.current) {
        setStatus("Loading the on-device outlining model…");
        const ready = s.photo ? await sam.ensureEmbedded(s.photo) : false;
        if (!ready) {
          s.dmg.points.pop();
          setStatus(sam.lastError
            ? `Outlining model failed to load (${sam.lastError}) — retry.`
            : navigator.onLine === false
              ? "On-device outlining model not available offline yet — reconnect once to download it, then it works offline."
              : "Outlining model failed to load — check the connection and retry.");
          setMarkBusy(false);
          drawMark();
          return;
        }
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
      // Warm the on-device model quietly for the coin outline and cross-check.
      if (source === "api" && s.photo && !embeddings.current) void sam.ensureEmbedded(s.photo, true);
    } else {
      s.dmg.mask = null;
      s.dmg.source = null;
      setStatus("No mask there. Tap the middle of it.");
    }
    setMarkBusy(false);
    drawMark();
  };

  const undo = useCallback(async () => {
    if (!s.photo || markBusy) return;
    if (coinCorrect) {
      setCoinCorrect(false);
      setCoinFixHint("");
      drawMark();
      return;
    }
    if (s.dmg.points.length) {
      s.dmg.points.pop();
      s.dmg.pointMasks.pop();
      if (!s.dmg.points.length) {
        s.dmg.mask = null;
        s.dmg.iou = 0;
        s.dmg.source = null;
        setStatus("Tap the crack, then Measure.");
        drawMark();
        return;
      }
      setMarkBusy(true);
      setStatus("Outlining… (undo)");
      let out: SamMask | null = null;
      const source = s.dmg.source ?? "api";
      if (source === "device") {
        const found = s.dmg.pointMasks.filter((m): m is SamMask => !!m);
        if (found.length) {
          const union = new Uint8Array((found[0] as SamMask).mask.length);
          for (const { mask } of found) for (let i = 0; i < union.length; i++) union[i] = (union[i] ?? 0) | (mask[i] ?? 0);
          out = { mask: union, iou: Math.min(...found.map((f) => f.iou)) } as SamMask;
        }
      } else {
        try {
          out = await segmentViaApi(base, s.photo, s.dmg.points);
        } catch (e) {
          console.info("[sam] undo re-segment failed, trying on-device", e);
          if (embeddings.current) {
            s.dmg.pointMasks = [];
            try {
              out = await segmentOnDevice(sam, s);
            } catch {
              out = null;
            }
          }
        }
      }
      if (out) {
        s.dmg.mask = closeMask(out.mask, s.photo.width, s.photo.height, 2);
        s.dmg.iou = out.iou;
        setStatus(`Outlined (${Math.round(s.dmg.iou * 100)}% sure). ${s.dmg.points.length} tap${s.dmg.points.length > 1 ? "s" : ""} left.`);
      } else {
        s.dmg.mask = null;
        s.dmg.source = null;
        setStatus("Undo done — remaining taps found nothing. Tap again.");
      }
      setMarkBusy(false);
      drawMark();
      return;
    }
    if (s.coinManualPt) {
      s.coinManualPt = null;
      s.coinMask = null;
      s.coinIou = 0;
      setCoinFixHint("");
      drawMark();
    }
  }, [base, coinCorrect, drawMark, embeddings, markBusy, s, sam]);

  const coinState = s.coinManualPt ? (s.coinMask ? "manual-ok" : "manual") : s.gateCoin ? "auto" : "none";
  const coinStateText =
    coinState === "auto" ? "Coin auto-detected — confirm its size."
    : coinState === "manual-ok" ? "Coin outlined from your tap — confirm its size."
    : coinState === "manual" ? "Coin tap saved — confirm its size below."
    : "No coin yet — add one, or measure percent-only.";
  const needSize = Boolean(s.gateCoin || s.coinManualPt) && s.coinKindMm <= 0;

  return (
    <section className="screen on" aria-labelledby="h-mark">
      <div className="wrap">
        <BackButton label="Camera" onClick={() => go("capture")} />
        <Stepper step={2} />
        <h1 id="h-mark">Tap the damage.</h1>
        <p className="sub">One tap on the crack. The coin is already outlined from the gate.</p>
        <div className="card evcard">
          <div className="evframe">
            <canvas id="markCanvas" ref={canvasRef} onPointerDown={onTap} />
            {tapCount > 0 && (
              <span className="evbadge" aria-hidden="true">{tapCount} tap{tapCount === 1 ? "" : "s"}</span>
            )}
          </div>
          <div className="evrow">
            <button
              id="undoBtn"
              className="btn-quiet"
              type="button"
              disabled={markBusy || (tapCount === 0 && !s.coinManualPt && !coinCorrect)}
              onClick={undo}
            >
              ↩ Undo
            </button>
            <span id="status" className="evstatus" role="status">{status}</span>
          </div>
          <div className="seg seg-quad" role="group" aria-label="Damage type">
            {CHIPS.map((chip) => (
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
        </div>
        <div className="card scalecard">
          <div className="scalehead">
            <span className={`scaledot is-${coinState}`} aria-hidden="true" />
            <div className="scalehead-tx">
              <b>Scale reference</b>
              <small>{coinStateText}</small>
            </div>
          </div>
          <label className="field">
            Coin size
            <select
              id="coinKind"
              value={coinCustom ? 0 : coinKind}
              onChange={(e) => {
                const v = Number(e.target.value);
                const text = e.target.selectedOptions[0]?.text ?? "";
                setCoinKind(v);
                setCoinCustom("");
                s.coinKindMm = v;
                s.coinLabel = v > 0 ? text.replace(/ · (\d+(?:\.\d+)?) mm$/, " · $1 mm dia") : "";
              }}
            >
              <option value={0}>Choose the reference size…</option>
              {s.coinKindMm > 0 && !COIN_OPTIONS.some((o) => o.value === s.coinKindMm) && !coinCustom ? (
                <option value={s.coinKindMm}>{s.coinLabel || `${s.coinKindMm} mm reference`}</option>
              ) : null}
              {COIN_GROUPS.map((g) => (
                <optgroup key={g.name} label={g.name}>
                  {g.options.map((o) => (
                    <option key={o.label} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="field">
            Or type the diameter <small className="fieldex">any coin, ruler, card</small>
            <input
              id="coinCustomMm"
              className="field-input"
              type="number"
              inputMode="decimal"
              min={5}
              max={100}
              step="0.01"
              placeholder="e.g. 24.26"
              value={coinCustom}
              onChange={(e) => {
                const raw = e.target.value;
                setCoinCustom(raw);
                const mm = Number(raw);
                if (mm > 0) {
                  setCoinKind(0);
                  s.coinKindMm = mm;
                  s.coinLabel = `Custom · ${mm} mm dia`;
                } else {
                  s.coinKindMm = coinKind;
                  s.coinLabel = "";
                }
              }}
            />
          </label>
          <div className="coinrow">
            <button
              id="coinFixBtn"
              className={coinCorrect ? "btn-dark btn-sm" : "btn-quiet"}
              type="button"
              onClick={() => {
                if (!s.photo) return;
                setCoinCorrect((v) => {
                  setCoinFixHint(v ? "" : "Tap the coin center on the photo");
                  return !v;
                });
              }}
            >
              {coinCorrect ? "Cancel" : s.coinManualPt ? "Re-tap coin" : "Tap coin to correct"}
            </button>
            <span id="coinFixHint" className="coinhint">{coinFixHint}</span>
          </div>
          <label className="switchcard">
            <input
              id="coinTaped"
              type="checkbox"
              checked={taped}
              onChange={(e) => {
                setTaped(e.target.checked);
                s.coinTaped = e.target.checked;
                drawMark();
              }}
            />
            <span>Coin has tape<small>Lenient outline — allows the tape halo</small></span>
          </label>
        </div>
        {photoNotes ? <div id="photoNotes" className="hint">{photoNotes}</div> : null}
        {tfState ? (
          <div className="modelline" role="status">
            <span className="modelbar" aria-hidden="true"><i /></span>
            <span id="tfState">{tfState}</span>
          </div>
        ) : null}
        <button id="measureBtn" className="btn-primary" type="button" disabled={!hasMask || needSize} onClick={measure}>
          Measure damage
        </button>
        {!hasMask ? (
          <p className="ctahint">Tap the damage on the photo to enable measuring.</p>
        ) : needSize ? (
          <p className="ctahint">Pick the coin size above to enable measuring.</p>
        ) : null}
      </div>
    </section>
  );
}
