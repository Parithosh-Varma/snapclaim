import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { apiGet, apiPost } from "../lib/api";
import { checkPhoto } from "../lib/photo-check";
import { findCoins } from "../../../src/vision/coin-detect.js";
import { closeMask } from "../lib/mask";
import { segmentCoinViaApi, segmentViaApi, type SamClient } from "../lib/sam";
import { buildObserveBody, completeMeasureJob, failMeasureJob, invalidateMeasure, startMeasureJob } from "../lib/measure-job";
import { COIN_GROUPS, COIN_OPTIONS, customCoinError, freshAngleSlot, loadLastCustomCoin, parseCustomCoinMm, pickWinnerAngle, resetDmg, saveLastCoin, saveLastCustomCoin, type AngleSlot, type SamMask, type Session } from "../lib/session";
import {TopBar} from "../lib/ui";

/** Custom coin-size dropdown: the native select cannot be styled square or
    themed, so this listbox renders the same presets (plus the gate's
    auto-detected coin) with full keyboard support. */
function CoinDrop(props: {
  dropRef: { current: HTMLDivElement | null };
  btnRef: { current: HTMLButtonElement | null };
  open: boolean;
  setOpen: (v: boolean) => void;
  active: number | null;
  setActive: (v: number | null) => void;
  selected: number;
  gateValue: number;
  gateLabel: string;
  gateCustom: boolean;
  onPick: (v: number, label: string) => void;
}) {
  const { dropRef, btnRef, open, setOpen, active, setActive, selected, gateValue, gateLabel, gateCustom, onPick } = props;
  const listRef = useRef<HTMLUListElement>(null);
  type Row = { kind: "opt"; value: number; label: string } | { kind: "head"; label: string };
  const rows: Row[] = [{ kind: "opt", value: 0, label: "Choose the reference size…" }];
  if (gateValue > 0 && !COIN_OPTIONS.some((o) => o.value === gateValue) && !gateCustom) {
    rows.push({ kind: "opt", value: gateValue, label: gateLabel || `${gateValue} mm reference` });
  }
  for (const g of COIN_GROUPS) {
    rows.push({ kind: "head", label: g.name });
    for (const o of g.options) rows.push({ kind: "opt", value: o.value, label: o.label });
  }
  const order = rows.map((r, i) => (r.kind === "opt" ? i : -1)).filter((i) => i >= 0);
  const selectedIdx = rows.findIndex((r) => r.kind === "opt" && r.value === selected);
  const currentLabel = (selectedIdx >= 0 ? (rows[selectedIdx] as { label: string }).label : null) ?? "Choose the reference size…";

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!dropRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, dropRef, setOpen]);

  const pick = (idx: number) => {
    const r = rows[idx];
    if (!r || r.kind !== "opt") return;
    onPick(r.value, r.label);
    setOpen(false);
    btnRef.current?.focus();
  };
  const step = (dir: 1 | -1) => {
    const at = active === null ? order.indexOf(selectedIdx) : order.indexOf(active);
    const nextIdx = order[(at + dir + order.length) % order.length];
    if (nextIdx === undefined) return;
    setActive(nextIdx);
    document.getElementById(`coinopt-${nextIdx}`)?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="coindrop" ref={dropRef}>
      <button
        ref={btnRef}
        id="coinKind"
        type="button"
        className="coindrop-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            setActive(selectedIdx >= 0 ? selectedIdx : (order[0] ?? null));
            setOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setActive(selectedIdx >= 0 ? selectedIdx : (order[0] ?? null));
            setOpen(true);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive(order[order.length - 1] ?? null);
            setOpen(true);
          } else if (e.key === "Escape" && open) {
            setOpen(false);
          }
        }}
      >
        <span>{currentLabel}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ul
          className="coindrop-list"
          ref={listRef}
          role="listbox"
          aria-label="Coin size"
          aria-activedescendant={active !== null ? `coinopt-${active}` : undefined}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              step(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              step(-1);
            } else if (e.key === "Home") {
              e.preventDefault();
              setActive(order[0] ?? null);
            } else if (e.key === "End") {
              e.preventDefault();
              setActive(order[order.length - 1] ?? null);
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (active !== null) pick(active);
            } else if (e.key === "Escape") {
              setOpen(false);
              btnRef.current?.focus();
            } else if (e.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          {rows.map((r, i) =>
            r.kind === "head" ? (
              <li key={`h-${r.label}`} className="coindrop-group" aria-hidden="true">
                {r.label}
              </li>
            ) : (
              <li
                key={`${r.value}-${r.label}`}
                id={`coinopt-${i}`}
                role="option"
                aria-selected={r.value === selected}
                className={i === active ? "active" : undefined}
                onClick={() => pick(i)}
                onMouseEnter={() => {
                  if (active !== i) setActive(i);
                }}
              >
                <span>{r.label}</span>
                {r.value === selected && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l4 4 10-10" /></svg>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

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
  // Wall-sized union is the room, not the damage - reject so the tap retries.
  let n = 0;
  for (let i = 0; i < union.length; i++) if (union[i]) n++;
  if (n > union.length * 0.5) return null;
  return { mask: union, iou: Math.min(...found.map((f) => f.iou)) } as SamMask;
}

export default function Mark() {
  const ctx = useApp();
  const { session: s, go, base, sam, embeddings } = ctx;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Select crack to continue.");
  const [tfState, setTfState] = useState("");
  const [photoNotes, setPhotoNotes] = useState("");
  const [label, setLabel] = useState(s.dmgLabel);
  const [coinKind, setCoinKind] = useState(s.coinKindMm);
  const [coinCustom, setCoinCustom] = useState(() => {
    const last = loadLastCustomCoin();
    if (last !== null && !(s.coinKindMm > 0)) {
      s.coinKindMm = last;
      s.coinLabel = `Custom · ${last} mm dia`;
      return String(last);
    }
    if (last !== null && s.coinKindMm === last) return String(last);
    return "";
  });
  const coinCustomErr = customCoinError(coinCustom);
  const [hasMask, setHasMask] = useState(!!s.dmg.mask);
  const [tapCount, setTapCount] = useState(s.dmg.points.length);
  const [markBusy, setMarkBusy] = useState(false);
  const [measureBusy, setMeasureBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [coinCorrect, setCoinCorrect] = useState(false);
  const [coinFixHint, setCoinFixHint] = useState("");
  const [taped, setTaped] = useState(s.coinTaped);
  const [angle, setAngle] = useState<1 | 2>(() => s.resumeAngle ?? 1);
  const [coinOpen, setCoinOpen] = useState(false);
  const [coinActive, setCoinActive] = useState<number | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const dropBtnRef = useRef<HTMLButtonElement>(null);
  // Background-job staleness lives on the session (measureSeq + snapshot),
  // not on this mount: the job overlaps the Describe step, so Mark unmounts
  // while it runs and a component ref would discard every landing. Input
  // edits bump the seq via touchInputs() so a late landing is discarded.
  const touchInputs = () => {
    invalidateMeasure(s);
  };

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
    // Mirror undo order for the draft snapshotter; it reads this, not the ref.
    s.workingHist = histRef.current.slice();
    if (!c || !photo) return;
    c.width = photo.width;
    c.height = photo.height;
    // Aspect ratio for the CSS height cap (short and wide viewports).
    c.style.setProperty("--ar", String(photo.width / photo.height));
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
      // Tape halo inflates the mask (coin + tape strip) - allow 2.5× and a
      // looser centroid when taped, matching the vanilla PWA.
      const taped = s.coinTaped;
      if (area < circle * 0.4 || area > circle * (taped ? 2.5 : 1.6)) return null;
      if (Math.hypot(sx / area - cx, sy / area - cy) > r * (taped ? 0.75 : 0.5)) return null;
      return out;
    },
    [embeddings, sam, s],
  );

  /** Auto coin hunt: Hough proposes centres, SAM disposes. The first verified
      outline becomes the coin tap, same as a manual one - the user only picks
      the size. Runs only when the gate missed the coin entirely, and only
      after a crack is selected - never a download before first tap. */
  const huntCoin = useCallback(async (
    found: { x: number; y: number; r: number }[],
    photo: HTMLCanvasElement,
  ) => {
    const still = s.stillDataUrl;
    huntRef.current = null;
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
        setCoinFixHint(`Coin found (${Math.round(traced.iou * 100)}% sure) - pick its size`);
        drawMark();
        return;
      }
    }
    if (s.photoFor === still && !s.coinManualPt) setCoinFixHint("");
  }, [drawMark, s, sam, traceCoin]);

  const huntRef = useRef<{ points: { x: number; y: number; r: number }[]; photo: HTMLCanvasElement } | null>(null);
  /* Undo order: the last tap undone first, crack or coin. Entries land when
     a tap takes effect; a fresh photo clears the slate with the taps. */
  const histRef = useRef<("crack" | "coin")[]>([]);
  /* Two angles, one screen: angle tabs swap the working fields with the
     per-angle bundle, so every tap/undo/measure below keeps working on the
     visible photo. The other angle's canvas, mask and coin wait in its slot. */

  const stillFor = (k: 1 | 2): string => (k === 1 ? s.stillA || s.stillDataUrl : s.still2DataUrl);

  const saveBundle = (k: 1 | 2): void => {
    const b: AngleSlot = {
      photo: s.photo,
      photoFor: s.photoFor,
      dmg: s.dmg,
      coinManualPt: s.coinManualPt,
      coinMask: s.coinMask,
      coinIou: s.coinIou,
      gateCoin: s.gateCoin,
      taped,
      hist: histRef.current.slice(),
    };
    if (k === 1) s.bundleA = b;
    else s.bundleB = b;
  };

  /* Rebuild the marking photo from its still. `restore` re-applies a draft
     (or stashed bundle) after the canvas lands: masks are kept only when
     their dimensions still match the rebuilt photo. */
  const buildPhoto = useCallback((still: string, restore?: AngleSlot) => {
    resetDmg(s);
    histRef.current = [];
    s.coinManualPt = null;
    s.coinMask = null;
    s.coinIou = 0;
    embeddings.current = false;
    setHasMask(false);
    setTapCount(0);
    setTfState("");
    setCoinFixHint("");
    huntRef.current = null;
    setStatus("Select crack to continue.");
    drawMark();
    const img = new Image();
    if (!still) {
      setReady(false);
      setStatus("Take the second photo first - back up to capture.");
      return;
    }
    // A stalled decode (huge image, throttled phone) fires neither onload
    // nor onerror - stop the silent skeleton after 12 s with a real message.
    const stall = setTimeout(() => {
      if (s.photoFor !== still) {
        setReady(false);
        setStatus("Photo is taking too long to load - try a smaller sample or retake.");
      }
    }, 12000);
    img.onload = () => {
      clearTimeout(stall);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const photo = document.createElement("canvas");
      photo.width = Math.round(img.width * scale);
      photo.height = Math.round(img.height * scale);
      photo.getContext("2d", { willReadFrequently: true })?.drawImage(img, 0, 0, photo.width, photo.height);
      // Never bank a silent black canvas: if a decoded image paints nothing,
      // say so instead of showing a black photo.
      try {
        const px = photo.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, photo.width, photo.height);
        if (px) {
          let sum = 0;
          let n = 0;
          const d = px.data;
          for (let i = 0; i < d.length; i += 401 * 4) {
            sum += (d[i] as number) + (d[i + 1] as number) + (d[i + 2] as number);
            n += 3;
          }
          if (n > 0 && sum / n / 255 < 0.02) {
            setStatus("That photo came out black - try another sample or retake.");
          }
        }
      } catch { /* validation is best-effort; the photo still shows */ }
      s.photo = photo;
      s.photoFor = still;
      resetDmg(s);
      // A manual coin tap is pixel coords of the previous photo - never reuse it.
      s.coinManualPt = null;
      s.coinMask = null;
      s.coinIou = 0;
      embeddings.current = false;
      // A draft restore re-applies here, once the canvas dimensions are
      // known: anything that no longer fits the rebuilt photo is dropped.
      if (restore) {
        const fits = (m: Uint8Array | null) => !!m && m.length === photo.width * photo.height;
        s.dmg = {
          points: restore.dmg.points.filter(
            (p): p is [number, number] =>
              Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number"),
          ),
          pointMasks: [],
          mask: fits(restore.dmg.mask) ? (restore.dmg.mask as Uint8Array) : null,
          iou: fits(restore.dmg.mask) ? restore.dmg.iou : 0,
          source: fits(restore.dmg.mask) ? restore.dmg.source : (restore.dmg.points.length ? "api" : null),
        };
        s.coinManualPt = restore.coinManualPt;
        s.coinMask = fits(restore.coinMask) ? restore.coinMask : null;
        s.coinIou = fits(restore.coinMask) ? restore.coinIou : 0;
        s.gateCoin = restore.gateCoin;
        setTaped(restore.taped);
        histRef.current = restore.hist.filter((x) => x === "crack" || x === "coin");
        setTapCount(s.dmg.points.length);
        setHasMask(!!s.dmg.mask);
        setCoinFixHint(
          s.coinManualPt && !s.coinMask ? "Coin tap restored - confirm its size below." : "",
        );
        if (s.dmg.mask) {
          setStatus(`Outlined (${Math.round(s.dmg.iou * 100)}% sure) - restored from draft.`);
        }
      }
      setReady(true);
      drawMark();
      // The gate missed the coin: propose centres now (free, same thread),
      // verify with SAM only after a crack is selected - never a download
      // before first tap.
      if (!s.gateCoin && !s.coinManualPt) {
        try {
          const px = photo.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, photo.width, photo.height);
          const found = px ? findCoins({ data: px.data, width: px.width, height: px.height }) : [];
          huntRef.current = found.length ? { points: found.slice(0, 3), photo } : null;
        } catch { huntRef.current = null; /* hunt is best-effort; the tap button remains */ }
      }
    };
    img.onerror = () => {
      clearTimeout(stall);
      setReady(false);
      setStatus("That photo could not be read - go back and take it again.");
    };
    img.src = still;
  }, [drawMark, s]);

  const loadAngle = useCallback((k: 1 | 2) => {
    let still = k === 1 ? s.stillA || s.stillDataUrl : s.still2DataUrl;
    if (k === 1 && !s.stillA && still) s.stillA = still;
    s.stillDataUrl = still;
    s.activeAngle = k;
    const slot = (k === 1 ? s.bundleA : s.bundleB) ?? freshAngleSlot();
    s.photo = slot.photo;
    s.photoFor = slot.photoFor;
    s.dmg = slot.dmg;
    s.coinManualPt = slot.coinManualPt;
    s.coinMask = slot.coinMask;
    s.coinIou = slot.coinIou;
    s.gateCoin = slot.gateCoin;
    setTaped(slot.taped);
    histRef.current = slot.hist.filter((x) => x === "crack" || x === "coin");
    setTapCount(slot.dmg.points.length);
    setHasMask(!!slot.dmg.mask);
    setCoinCorrect(false);
    setCoinFixHint(slot.coinManualPt && !slot.coinMask ? "Coin tap saved - confirm its size below." : "");
    setTfState("");
    huntRef.current = null;
    setMeasureBusy(false);
    if (slot.photo && slot.photoFor === still && still) {
      setReady(true);
      setStatus(slot.dmg.mask ? `Outlined (${Math.round(slot.dmg.iou)}% sure).` : "Select crack to continue.");
      drawMark();
      // Rebuild the free coin hunt a revisit lost: no download, just Hough.
      if (!s.gateCoin && !s.coinManualPt) {
        try {
          const px = slot.photo.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, slot.photo.width, slot.photo.height);
          const found = px ? findCoins({ data: px.data, width: px.width, height: px.height }) : [];
          huntRef.current = found.length ? { points: found.slice(0, 3), photo: slot.photo } : null;
        } catch { huntRef.current = null; }
      }
      return;
    }
    setReady(false);
    setStatus(still ? (slot.dmg.mask || slot.dmg.points.length ? "Restoring draft…" : "Select crack to continue.") : "Take the second photo first - back up to capture.");
    // No canvas (fresh reload after a draft restore) but stashed taps: the
    // still rebuilds the photo and the slot re-applies on top of it.
    if (still) buildPhoto(still, slot.photoFor === still &&
      (slot.dmg.points.length > 0 || !!slot.dmg.mask || !!slot.coinManualPt) ? slot : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildPhoto, drawMark, s]);

  /* Angle tabs: persist the working photo into its slot, then load the other. */
  const switchAngle = (next: 1 | 2) => {
    if (next === angle || markBusy || measureBusy) return;
    saveBundle(angle);
    setAngle(next);
    loadAngle(next);
    // A different angle is different inputs: drop any in-flight or landed
    // measurement so Say can never report the other angle's numbers.
    touchInputs();
  };

  /* Make an angle's bundle the working state (used for the winning angle
     before leaving for Say, and when re-opening an already-marked angle). */
  const applyWinner = (k: 1 | 2) => {
    const slot = (k === 1 ? s.bundleA : s.bundleB) ?? freshAngleSlot();
    const still = k === 1 ? s.stillA || s.stillDataUrl : s.still2DataUrl;
    s.stillDataUrl = still;
    s.photo = slot.photo;
    s.photoFor = slot.photoFor;
    s.dmg = slot.dmg;
    s.coinManualPt = slot.coinManualPt;
    s.coinMask = slot.coinMask;
    s.coinIou = slot.coinIou;
    s.gateCoin = slot.gateCoin;
    setTaped(slot.taped);
    histRef.current = slot.hist.filter((x) => x === "crack" || x === "coin");
    setTapCount(slot.dmg.points.length);
    setHasMask(!!slot.dmg.mask);
    drawMark();
  };

  /* build the marking photo; cloud-only, so no model ever loads on entry */
  useEffect(() => {    sam.onProgress = ({ percent }) => setTfState(`Downloading the outlining model… ${percent}%`);
    sam.onReady = (device, embedMs) => {
      embeddings.current = true;
      setTfState("");
      console.info(`[sam] embedded on ${device} in ${embedMs} ms`);
    };
    sam.onError = (message) => {
      setTfState("");
      setStatus(navigator.onLine === false
        ? "On-device outlining model not available offline yet - reconnect once to download it, then it works offline."
        : `Outlining unavailable (${message}). Check the connection and retry.`);
    };
    loadAngle(s.resumeAngle ?? 1);
    s.resumeAngle = null;
    // A background job that failed while the user was on Say returns here
    // (not Numbers) with the real message; taps and transcript are kept.
    if (s.measureJob?.state === "error") {
      setStatus(`Measuring failed (${s.measureJob.error ?? "unknown error"}).`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The build effect above calls drawMark() before setReady(true) paints the
     canvas into the DOM, so that first paint lands on nothing and the canvas
     keeps its default black until the next tap. Repaint once ready flips. */  useEffect(() => {
    if (ready) drawMark();
  }, [ready, drawMark]);

  const measure = useCallback(async () => {
    // Belt and braces with the disabled button: no mask, no empty mask, no photo - no report.
    // All synchronous validation runs BEFORE navigating, exactly as the old
    // sequential flow: nothing leaves Mark until the inputs are measurable.
    if (!s.dmg.mask || !s.photo) {
      setStatus("Tap the crack first - there is nothing outlined to measure.");
      return;
    }
    setStatus("Measuring - asking the backend for the numbers…");
    setMeasureBusy(true);
    let area = 0;
    for (let i = 0; i < s.dmg.mask.length; i++) if (s.dmg.mask[i]) area++;
    if (!area) {
      setStatus("Tap the crack first - there is nothing outlined to measure.");
      setMeasureBusy(false);
      return;
    }
    try {
      const px = s.photo.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, s.photo.width, s.photo.height);
      if (px) setPhotoNotes(checkPhoto({ width: px.width, height: px.height, data: px.data }, Math.max(s.photo.width, s.photo.height)).join(" "));
    } catch { /* advisory only */ }
    const w = s.photo.width;
    const h = s.photo.height;
    ctx.setNumError(null);
    // No mock measurements, ever: a mock backend invents numbers, so refuse
    // before leaving Mark. Unreachable health is not a refusal - the
    // background job surfaces the real connection error itself.
    try {
      const { j } = await apiGet(base, "/v1/health");
      if ((j as { mode?: unknown }).mode === "mock") {
        setStatus("Backend is in mock mode - measurements would be fake. Settings - Connection shows how to point at the live backend.");
        ctx.setNumError({ title: "Mock backend refused", detail: "This backend invents measurements. Open Settings - Connection and use the SnapClaim cloud URL, then measure again." });
        setMeasureBusy(false);
        go("sNum");
        return;
      }
    } catch { /* health failed: the job reports the real error below */ }
    // Scale needs a coin outline with a chosen size, or an explicit
    // percent-only choice - never a guessed circle.
    if ((s.coinManualPt || s.gateCoin) && !(s.coinKindMm > 0)) {
      setStatus("Choose the reference size first.");
      setMeasureBusy(false);
      return;
    }
    if (!s.coinManualPt && !s.gateCoin && !s.noScaleMode) {
      setStatus("Tap the coin to set the scale, or mark percent-only below.");
      setMeasureBusy(false);
      return;
    }
    // The coin is whatever SAM outlined at the user's tap - same as the crack.
    // No gate geometry, no guessed radius: without an outline there is no scale.
    // buildObserveBody carries the exact old maths; a missed outline refuses
    // here, before any navigation, so millimetres are never guessed.
    const { body, refused } = buildObserveBody(s, w, h);
    if (refused) {
      setStatus(refused);
      setMeasureBusy(false);
      return;
    }
    // Validation passed: start the observe+measure chain in the background
    // and move to Describe immediately. The measurement overlaps the user's
    // speak/type time - no artificial delay, no fake progress, and Say never
    // reports without a completed payload (it awaits the job first).
    s.payload = null;
    s.measurement = null;
    s.reportFail = null;
    s.reportStatement = null;
    s.autoListen = false;
    ctx.setMeasuring(true);
    setMeasureBusy(false);
    setStatus("");
    let resolveJob: () => void = () => {};
    const promise = new Promise<void>((resolve) => { resolveJob = resolve; });
    const job = startMeasureJob(s, promise);
    s.autoListen = true;
    go("sSay");
    try {
      let { res, j } = await apiPost(base, "/v1/observe", body);
      // The reference IS the traced outline now - no circle to fall back to.
      // A refusal means the outline was not coin-shaped: the user re-taps.
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const m = await apiPost(base, "/v1/measure", j.result);
      if (!m.res.ok || !m.j.ok) throw new Error(m.j.error ?? `HTTP ${m.res.status}`);
      completeMeasureJob(
        s,
        job,
        j.result as unknown as NonNullable<typeof s.payload>,
        m.j.result as unknown as NonNullable<typeof s.measurement>,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failMeasureJob(s, job, msg);
    } finally {
      // Notify the UI (Say re-renders on measuring flip) and unblock any
      // Say submit that is awaiting the job. Failure returns to Mark - not
      // Numbers - with the real message, keeping taps and transcript.
      if (s.measureJob === job) {
        const failed = job.state === "error";
        const errText = job.error ?? "unknown error";
        ctx.setMeasuring(false);
        resolveJob();
        if (failed) {
          ctx.setNumError(null);
          go("sMark");
          // Mark remounts and reads job.error for its status line; stash the
          // text on the session too in case the remount races the write.
          s.transcript = s.transcript ?? "";
          void errText;
        }
      } else {
        resolveJob();
      }
    }
  }, [base, ctx, go, s]);

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
      s.noScaleMode = false;
      touchInputs();
      histRef.current.push("coin");
      setCoinCorrect(false);
      setCoinFixHint("Outlining coin…");
      setMarkBusy(true);
      drawMark();
      // Same mechanism as the crack: the tap goes to SAM 3.1 and the traced
      // outline is what gets measured. No guessed radius, ever.
      try {
        if (!s.photo) throw new Error("Photo not ready - try again.");
        const traced = await segmentCoinViaApi(base, s.photo, [x, y]);
        s.coinMask = traced.mask;
        s.coinIou = traced.iou;
        setCoinFixHint(`Coin outlined (${Math.round(traced.iou * 100)}% sure) - pick its size`);
      } catch (e) {
        setCoinFixHint(e instanceof Error ? e.message : "Coin outline failed - tap again.");
      }
      setMarkBusy(false);
      drawMark();
      return;
    }
    s.dmg.points.push([x, y]);
    touchInputs();
    setStatus("Outlining…");
    setMarkBusy(true);
    // Cloud-only: SAM 3.1 API is the only outlining path. No on-device fallback,
    // so low-tier phones never download or load a model here.
    let out: SamMask | null = null;
    const source: "api" | "device" = "api";
    try {
      out = await segmentViaApi(base, s.photo, s.dmg.points);
    } catch (e) {
      console.info("[sam] API segment failed", e);
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(navigator.onLine === false
        ? "Outlining needs a connection - reconnect and retry."
        : `Outlining failed (${msg}). Check the connection and retry.`);
      setMarkBusy(false);
      drawMark();
      return;
    }
    if (out) {
      // Bridge hairline gaps (≤4 px) so one crack reads as one region, not
      // speckle. Done here so the outline shown is exactly what gets measured.
      s.dmg.mask = closeMask(out.mask, s.photo.width, s.photo.height, 2);
      s.dmg.iou = out.iou;
      s.dmg.source = source;
      histRef.current.push("crack");
      setStatus(`Outlined (${Math.round(out.iou * 100)}% sure) via SAM 3.1 API.`);
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
    const last = histRef.current[histRef.current.length - 1];
    // A pending correction mode cancels first without consuming history.
    if (coinCorrect && last !== "coin") {
      setCoinCorrect(false);
      setCoinFixHint("");
      drawMark();
      return;
    }
    // Otherwise the last tap undone first, crack or coin.
    if (last === "coin") {
      histRef.current.pop();
      if (coinCorrect) setCoinCorrect(false);
      s.coinManualPt = null;
      s.coinMask = null;
      s.coinIou = 0;
      touchInputs();
      setCoinFixHint("");
      drawMark();
      return;
    }
    if (last === "crack") histRef.current.pop();
    if (s.dmg.points.length) {
      s.dmg.points.pop();
      s.dmg.pointMasks.pop();
      touchInputs();
      if (!s.dmg.points.length) {
        s.dmg.mask = null;
        s.dmg.iou = 0;
        s.dmg.source = null;
        setStatus("Select crack to continue.");
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
          console.info("[sam] undo re-segment failed", e);
          out = null;
        }
      }
      if (out) {
        s.dmg.mask = closeMask(out.mask, s.photo.width, s.photo.height, 2);
        s.dmg.iou = out.iou;
        setStatus(`Outlined (${Math.round(s.dmg.iou * 100)}% sure). ${s.dmg.points.length} tap${s.dmg.points.length > 1 ? "s" : ""} left.`);
      } else {
        s.dmg.mask = null;
        s.dmg.source = null;
        setStatus("Undo done - remaining taps found nothing. Tap again.");
      }
      setMarkBusy(false);
      drawMark();
      return;
    }
    if (s.coinManualPt) {
      s.coinManualPt = null;
      s.coinMask = null;
      s.coinIou = 0;
      touchInputs();
      setCoinFixHint("");
      drawMark();
    }
  }, [base, coinCorrect, drawMark, embeddings, markBusy, s, sam]);

  const coinState = s.noScaleMode ? "none" : s.coinManualPt ? (s.coinMask ? "manual-ok" : "manual") : s.gateCoin ? "auto" : "none";
  const coinStateText =
    s.noScaleMode ? "Percent-only - no millimetres."
    : coinState === "auto" ? "Coin auto-detected - confirm its size."
    : coinState === "manual-ok" ? "Coin outlined from your tap - confirm its size."
    : coinState === "manual" ? "Coin tap saved - confirm its size below."
    : "No coin yet - tap it, or measure percent-only.";
  const needSize = Boolean(s.gateCoin || s.coinManualPt) && s.coinKindMm <= 0;

  return (
    <section className="screen on polish" aria-labelledby="h-mark">
      <div className="wrap wide">
        <TopBar step={2} total={6} backLabel="Camera" onBack={() => go("capture")} />
        <h1 id="h-mark">Tap the damage.</h1>
        <p className="sub">One tap on the crack, one tap on the coin.</p>
        <div className="split stick">
        <div className="split-main">
        {!ready ? (
          <>
            <div className="skel" role="status" aria-label="Loading photo" />
            <div className="skel" />
          </>
        ) : (
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
                  touchInputs();
                }}
              >
                {chip.text}
              </button>
            ))}
          </div>
        </div>
        )}
        </div>
        <div className="split-side">
        {ready && (
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
            <CoinDrop
              dropRef={dropRef}
              btnRef={dropBtnRef}
              open={coinOpen}
              setOpen={setCoinOpen}
              active={coinActive}
              setActive={setCoinActive}
              selected={coinCustom ? 0 : coinKind}
              gateValue={s.coinKindMm}
              gateLabel={s.coinLabel}
              gateCustom={!!coinCustom}
              onPick={(v, label) => {
                setCoinKind(v);
                setCoinCustom("");
                saveLastCustomCoin("");
                s.coinKindMm = v;
                s.coinLabel = v > 0 ? label.replace(/ · (\d+(?:\.\d+)?) mm$/, " · $1 mm dia") : "";
                touchInputs();
                saveLastCoin(s.coinKindMm, s.coinLabel);
              }}
            />
          </label>
          <label className="field">
            Or type the diameter (mm) <small className="fieldex">any coin, ruler, card · 15–40 mm</small>
            <input
              id="coinCustomMm"
              className="field-input"
              type="number"
              inputMode="decimal"
              min={15}
              max={40}
              step="0.1"
              placeholder="e.g. 24.3"
              value={coinCustom}
              onChange={(e) => {
                const raw = e.target.value;
                setCoinCustom(raw);
                const mm = parseCustomCoinMm(raw);
                if (mm !== null) {
                  setCoinKind(0);
                  s.coinKindMm = mm;
                  s.coinLabel = `Custom · ${mm} mm dia`;
                } else if (raw.trim() === "") {
                  s.coinKindMm = coinKind;
                  s.coinLabel = "";
                } else {
                  s.coinKindMm = 0;
                  s.coinLabel = "";
                }
                touchInputs();
                if (mm !== null) {
                  saveLastCoin(s.coinKindMm, s.coinLabel);
                  saveLastCustomCoin(raw);
                }
              }}
            />
            {coinCustomErr && (
              <span id="coinCustomErr" className="coinhint" role="alert">
                {coinCustomErr}
              </span>
            )}
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
          <div className="coinrow">
            <button
              id="markNoCoin"
              className="btn-quiet"
              type="button"
              disabled={markBusy || (!!s.coinManualPt && !s.noScaleMode)}
              onClick={() => {
                if (s.noScaleMode) {
                  // Untoggled: back to millimetres. The scale still needs a
                  // coin outline + size, the measure gate enforces that below.
                  s.noScaleMode = false;
                  setStatus("Scale needed - tap the coin, or mark percent-only again to skip millimetres.");
                } else {
                  s.noScaleMode = true;
                  s.coinManualPt = null;
                  s.coinMask = null;
                  s.coinIou = 0;
                  setCoinFixHint("");
                  setStatus("Percent-only - no millimetres.");
                }
                touchInputs();
                drawMark();
              }}
            >
              {s.noScaleMode ? "Percent-only ✓" : "No coin in frame - percent-only"}
            </button>
          </div>
          <label className="switchcard">
            <input
              id="coinTaped"
              type="checkbox"
              checked={taped}
              onChange={(e) => {
                setTaped(e.target.checked);
                s.coinTaped = e.target.checked;
                touchInputs();
                drawMark();
              }}
            />
            <span>Coin has tape<small>Lenient outline - allows the tape halo</small></span>
          </label>
        </div>
        )}
        {photoNotes ? <div id="photoNotes" className="hint">{photoNotes}</div> : null}
        {tfState ? (
          <div className="modelline" role="status">
            <span className="modelbar" aria-hidden="true"><i /></span>
            <span id="tfState">{tfState}</span>
          </div>
        ) : null}
        <div className="stickycta">
          <button id="measureBtn" className={`btn-primary${measureBusy ? " busy" : ""}`} type="button" disabled={measureBusy || !hasMask || needSize} aria-busy={measureBusy} onClick={measure}>
            {measureBusy ? "Measuring…" : "Measure damage"}
          </button>
        </div>
        {!hasMask ? (
          <p className="ctahint">Tap the damage on the photo to enable measuring.</p>
        ) : needSize ? (
          <p className="ctahint">Pick the coin size above to enable measuring.</p>
        ) : null}
        </div>
        </div>
      </div>
    </section>
  );
}
