import { useMemo, useState } from "react";
import { useApp } from "../App";
import { MASK_COLORS, type Session } from "../lib/session";
import { BackButton, Badge, MetricCards, Scheme, Stepper, receiptChips } from "../lib/ui";

/** Bounding box of the on pixels, or null when the mask is empty. */
function maskBox(mask: Uint8Array, w: number, h: number) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/**
 * The measured mask outlined on the photo, tagged with its own numbers.
 * Port of drawNumOverlay: the tag sits above the damage, else below it,
 * else beside a full-height crack, with a connector to the mask edge.
 */
function NumOverlay({ s }: { s: Session }) {
  const parts = useMemo(() => {
    const ov = s.payload?.overlay;
    const first = s.measurement?.findings[0];
    if (!ov || !s.stillDataUrl || !(ov.width > 0) || !(ov.height > 0) || !first) return null;
    const W = ov.width;
    const H = ov.height;
    const colorFor = (label: string) => MASK_COLORS[label] ?? "#7f8c8d";
    const paths = ov.masks.map((m, i) => (
      <path
        key={i}
        d={m.path}
        fill={colorFor(m.label)}
        fillOpacity="0.18"
        stroke={colorFor(m.label)}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        fillRule="evenodd"
      />
    ));
    const target = ov.masks.find((m) => m.label !== "coin");
    const box = target && s.dmg.mask ? maskBox(s.dmg.mask, W, H) : null;
    if (!target || !box || !s.dmg.mask) return <>{paths}</>;
    const color = colorFor(target.label);
    const label = String(first.label);
    const number = `${String(first.percent)}%${first.crackLengthMm == null ? "" : ` · ${String(first.crackLengthMm)} mm`}`;
    const text = `${label.charAt(0).toUpperCase() + label.slice(1)} · ${number}`;
    const fs = Math.max(11, W * 0.036);
    const tagW = text.length * fs * 0.6 + fs * 1.2;
    const tagH = fs * 1.75;
    const gap = fs * 0.8;
    const edge = fs * 0.4;
    const cx = (box.minX + box.maxX) / 2;
    let x = cx - tagW / 2;
    let y: number;
    let place: "above" | "below" | "right" | "left";
    if (box.minY - gap - tagH >= edge) { y = box.minY - gap - tagH; place = "above"; }
    else if (box.maxY + gap + tagH <= H - edge) { y = box.maxY + gap; place = "below"; }
    else if (box.maxX + gap + tagW <= W - edge) { x = box.maxX + gap; y = box.minY; place = "right"; }
    else { x = box.minX - gap - tagW; y = box.minY; place = "left"; }
    x = Math.min(Math.max(x, edge), Math.max(edge, W - tagW - edge));
    y = Math.min(Math.max(y, edge), Math.max(edge, H - tagH - edge));
    const midY = Math.min(Math.max(y + tagH / 2, box.minY), box.maxY);
    let sideX: number | null = null;
    if (place === "left" || place === "right") {
      const row = Math.min(H - 1, Math.max(0, Math.round(midY)));
      const base = row * W;
      if (place === "right") {
        for (let px = W - 1; px >= 0; px--) if (s.dmg.mask[base + px]) { sideX = px; break; }
      } else {
        for (let px = 0; px < W; px++) if (s.dmg.mask[base + px]) { sideX = px; break; }
      }
    }
    let line: { x1: number; y1: number; x2: number; y2: number } | null = null;
    if (place === "right" && sideX !== null) line = { x1: x, y1: midY, x2: sideX, y2: midY };
    else if (place === "left" && sideX !== null) line = { x1: x + tagW, y1: midY, x2: sideX, y2: midY };
    else if (place === "below") line = { x1: Math.min(Math.max(cx, x + fs * 0.6), x + tagW - fs * 0.6), y1: y, x2: cx, y2: box.maxY };
    else if (place === "above") line = { x1: Math.min(Math.max(cx, x + fs * 0.6), x + tagW - fs * 0.6), y1: y + tagH, x2: cx, y2: box.minY };
    return (
      <>
        {paths}
        {line && <line {...line} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        <rect x={x} y={y} width={tagW} height={tagH} rx={tagH / 2} fill="#fffdf8" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <text
          x={x + tagW / 2}
          y={y + tagH / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Archivo, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          fontWeight={700}
          fontSize={fs}
          fill="#0b1e46"
        >
          {text}
        </text>
      </>
    );
  }, [s]);

  const ov = s.payload?.overlay;
  if (!parts || !ov) return null;
  return (
    <svg id="numPhotoOverlay" aria-hidden="true" focusable="false" viewBox={`0 0 ${ov.width} ${ov.height}`} preserveAspectRatio="xMidYMid meet">
      {parts}
    </svg>
  );
}

export default function Numbers() {
  const ctx = useApp();
  const { session: s, go, measuring, numError } = ctx;
  const [maskOn, setMaskOn] = useState(true);
  const m = s.measurement;
  const first = m?.findings[0];

  return (
    <section className="screen on" aria-labelledby="h-num">
      <div className="wrap">
        <BackButton label="Say" onClick={() => go("sSay")} />
        <Stepper step={4} />
        <h1 id="h-num">Get the numbers.</h1>
        <p className="sub">Outlined and measured, not guessed.</p>

        {s.stillDataUrl && (
          <div className="photocard" id="numPhotoCard">
            <img id="numPhoto" alt="Your captured damage photo" src={s.stillDataUrl} />
            {maskOn && <NumOverlay s={s} />}
            <span className="chip">
              <i aria-hidden="true" />
              <span id="numChip">
                {s.coinLabel ? `${s.coinLabel} · measured` : s.noScaleMode ? "Percent only · no coin" : "Measured"}
              </span>
            </span>
          </div>
        )}
        {s.stillDataUrl && (
          <div className="rowbtns" style={{ marginBottom: 12 }}>
            <button id="sc-mask-toggle-num" className="btn btn-ghostline" type="button" onClick={() => setMaskOn((v) => !v)}>
              Mask {maskOn ? "on" : "off"}
            </button>
          </div>
        )}

        <div id="measured" aria-live="polite">
          {numError ? (
            <div className="statecard err" role="alert">
              <b>{numError.title}</b>
              <p style={{ margin: "8px 0 12px", color: "#5b6b8c" }}>{numError.detail}</p>
              <button className="btn-dark" type="button" style={{ width: "100%" }} onClick={() => ctx.measureRef.current?.()}>
                Try again
              </button>
            </div>
          ) : m ? (
            <>
              <Badge kind="ok">MEASURED{m.mode === "absolute" ? "" : " · percent only (no coin)"}</Badge>
              {first && <MetricCards f={first} />}
              {m.findings.length > 1 && (
                <ul>
                  {m.findings.slice(1).map((f, i) => {
                    const label = String(f.label);
                    return (
                      <li key={i}>
                        <p className="found">{label.charAt(0).toUpperCase() + label.slice(1)} found</p>
                        <b>{String(f.percent)}%</b> <small>of the wall</small> ·{" "}
                        <b>{f.crackLengthMm === null ? "—" : `${String(f.crackLengthMm)} mm`}</b> <small>length</small> ·{" "}
                        {String(f.regionCount ?? 1)} region{(f.regionCount ?? 1) === 1 ? "" : "s"} ·{" "}
                        <Badge kind="ok">{String(f.severity)}</Badge>
                        {f.statement ? (
                          <>
                            <br />
                            <small>{String(f.statement)}</small>
                          </>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="receipts" aria-label="Receipts">{receiptChips(m.receipts)}</div>
            </>
          ) : null}
        </div>

        {measuring && (
          <div id="numLoading">
            <div className="skel" />
            <div className="skel" />
          </div>
        )}

        <Scheme findings={m?.findings ?? []} />

        <div id="findings" aria-live="polite">
          {s.reportFail ? (
            <>
              <Badge kind="fail">{s.reportFail.split("\n")[0]}</Badge>
              <pre>{s.reportFail.split("\n").slice(1).join("\n")}</pre>
            </>
          ) : s.reportStatement ? (
            <>
              <Badge kind="ok">GATE PASS</Badge>
              <p style={{ margin: "10px 0 0", fontWeight: 600 }}>{s.reportStatement}</p>
              <div className="receipts" aria-label="Receipts">{receiptChips(m?.receipts)}</div>
            </>
          ) : null}
        </div>

        <div className="stickycta">
          <button
            id="toCheck"
            className="btn-dark"
            type="button"
            style={{ width: "100%" }}
            onClick={() => {
              // The auto checks already ran once for this report; going forward only shows them.
              go("sCheck");
            }}
          >
            Check it twice →
          </button>
        </div>
      </div>
    </section>
  );
}
