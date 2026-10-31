import { useCallback, useEffect, useRef, useState } from "react";
import { useApp, type CheckPhase } from "../App";
import { apiPost, backendError } from "../lib/api";
import { encodeRle } from "../lib/rle";
import { segmentViaApi, type SamClient } from "../lib/sam";
import type { SamMask, Session } from "../lib/session";
import { BackButton, Badge, Stepper } from "../lib/ui";

/** Dilated bounding box of a mask (photo pixels): constrains a re-prompt to the damage region. */
function damageBox(mask: Uint8Array, w: number, h: number): { left: number; top: number; right: number; bottom: number } | null {
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
  if (maxX < 0) return null;
  const m = 24;
  return {
    left: Math.max(0, minX - m),
    top: Math.max(0, minY - m),
    right: Math.min(w, maxX + 1 + m),
    bottom: Math.min(h, maxY + 1 + m),
  };
}

async function segmentOnDevice(sam: SamClient, s: Session): Promise<SamMask | null> {
  while (s.dmg.pointMasks.length < s.dmg.points.length) {
    s.dmg.pointMasks.push(await sam.decodeDamage(s.dmg.points[s.dmg.pointMasks.length] as [number, number]));
  }
  const found = s.dmg.pointMasks.filter((m): m is SamMask => !!m);
  if (!found.length) return null;
  const union = new Uint8Array((found[0] as SamMask).mask.length);
  for (const { mask } of found) for (let i = 0; i < union.length; i++) union[i] = (union[i] ?? 0) | (mask[i] ?? 0);
  let n = 0;
  for (let i = 0; i < union.length; i++) if (union[i]) n++;
  if (n > union.length * 0.5) return null;
  return { mask: union, iou: Math.min(...found.map((f) => f.iou)) } as SamMask;
}

function verdictBadge(verdict: string) {
  if (verdict === "AGREED") return <Badge kind="ok">AGREED</Badge>;
  if (verdict === "DISPUTED") return <Badge kind="fail">DISPUTED</Badge>;
  return <Badge kind="wait">PENDING</Badge>;
}

export default function Check() {
  const ctx = useApp();
  const { session: s, go, base, sam, embeddings, checks, setChecks } = ctx;
  const [skStatus, setSkStatus] = useState("");
  const [skRows, setSkRows] = useState<{ disputed: boolean; statement: string; citations: string }[] | null>(null);
  const [skError, setSkError] = useState<{ title: string; message: string; details: string[] } | null>(null);
  const [xBadge, setXBadge] = useState<{ verdict: string; iou: unknown } | null>(null);
  const [xError, setXError] = useState<{ title: string; message: string; details: string[] } | null>(null);
  const [xNote, setXNote] = useState("");
  const checksRef = useRef(checks);
  checksRef.current = checks;
  const setPhase = (which: "skeptic" | "xcheck", phase: CheckPhase) =>
    setChecks({ ...checksRef.current, [which]: phase });

  const runSkeptic = useCallback(async (auto: boolean, retried = false) => {
    if (checksRef.current.skeptic === "loading" && !retried) return;
    // Never send an empty request: without a measurement there is nothing to check.
    if (!s.payload || !s.measurement) {
      if (!auto) setSkStatus("Run the measurement first");
      return;
    }
    setPhase("skeptic", "loading");
    setSkError(null);
    if (!retried) {
      setSkRows(null);
      setSkStatus("Asking the skeptic model…");
    } else {
      setSkStatus("First draft failed the gate — retrying once…");
    }
    try {
      // /v1/skeptic re-measures server-side: it needs the same measure inputs
      // /v1/report used, not just findings/receipts. No overlay (SVG paths are large).
      const p = (s.payload ?? {}) as Record<string, unknown>;
      const { res, j } = await apiPost(base, "/v1/skeptic", {
        component: p.component,
        masks: p.masks,
        ...(p.scaleReference !== undefined ? { scaleReference: p.scaleReference } : {}),
        ...(p.thresholds !== undefined ? { thresholds: p.thresholds } : {}),
        ...(p.minReferenceConfidence !== undefined ? { minReferenceConfidence: p.minReferenceConfidence } : {}),
        transcript: s.transcript,
        findings: s.measurement.findings,
        receipts: s.measurement.receipts,
      });
      if (!res.ok || !j.ok) throw backendError(res, j, "skeptic failed");
      const rows = ((j.result as { findings?: { statement?: string; citations?: string[] }[] } | undefined)?.findings ?? []).map((f) => ({
        disputed: /disputed/i.test(f.statement || ""),
        statement: f.statement ?? "",
        citations: (f.citations ?? []).join(", "),
      }));
      setSkRows(rows);
      setSkStatus(`skeptic ok ${j.requestId ?? ""}`.trim());
      setPhase("skeptic", "ok");
    } catch (e) {
      // The model is nondeterministic: one automatic retry on gate failure only.
      if (!retried && /Evidence gate failed/.test(e instanceof Error ? e.message : String(e))) {
        return runSkeptic(auto, true);
      }
      const err = e as { message?: string; status?: unknown; details?: string[] };
      const status = typeof err.status === "number" ? err.status : NaN;
      console.error(`[skeptic] HTTP ${Number.isNaN(status) ? "?" : status}: ${err.message ?? e}`, err.details ?? "");
      const unavailable = !Number.isNaN(status) && status >= 400 && status < 500;
      setSkError({
        title: unavailable ? `Skeptic unavailable (HTTP ${status})` : "Skeptic check failed.",
        message: err.message ?? String(e),
        details: err.details ?? [],
      });
      setSkStatus("");
      setPhase("skeptic", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, s]);

  const runXcheck = useCallback(async (auto: boolean) => {
    if (checksRef.current.xcheck === "loading") return;
    if (!s.dmg.mask || !s.photo) {
      if (!auto) setXNote("Mark the damage first.");
      return;
    }
    setPhase("xcheck", "loading");
    setXError(null);
    setXBadge(null);
    try {
      // Cross-check against the model that did NOT draw the mask.
      let other;
      if (s.dmg.source === "api") {
        if (!embeddings.current) throw new Error(navigator.onLine === false
          ? "On-device outlining model not available offline yet — reconnect once to download it, then it works offline."
          : "On-device model still loading — retry in a moment.");
        const dev = await segmentOnDevice(sam, s);
        if (!dev) throw new Error("The on-device model found nothing at those taps.");
        other = encodeRle(dev.mask, s.photo.width, s.photo.height);
      } else {
        // The measured mask's own bounding box constrains the re-prompt, so a
        // thin crack comes back as the crack — not the whole wall again.
        const box = s.dmg.mask ? damageBox(s.dmg.mask, s.photo.width, s.photo.height) : null;
        other = (await segmentViaApi(base, s.photo, s.dmg.points, box ?? undefined)).rle;
      }
      const { res, j } = await apiPost(base, "/v1/crosscheck", {
        a: encodeRle(s.dmg.mask, s.photo.width, s.photo.height),
        b: other,
        threshold: 0.5,
      });
      if (!res.ok || !j.ok) throw backendError(res, j, "cross-check failed");
      const result = j.result as unknown as { verdict: string; iou: unknown };
      setXBadge({ verdict: result.verdict, iou: result.iou });
      setPhase("xcheck", "ok");
    } catch (e) {
      const err = e as { message?: string; status?: unknown; details?: string[] };
      const msg = err.message ?? String(e);
      const status = typeof err.status === "number" ? err.status : NaN;
      console.error(`[xcheck] HTTP ${Number.isNaN(status) ? "?" : status}: ${msg}`, err.details ?? "");
      // /v1/segment is unavailable in mock mode, so a mask drawn by the API
      // path has nothing to cross-check against — say so, not "failed".
      const noSam = /mock segment|not wired|HTTP 501/.test(msg);
      const unavailable = !Number.isNaN(status) && status >= 400 && status < 500;
      setXError({
        title: noSam
          ? "Cross-check unavailable — SAM 3.1 is unavailable in mock mode"
          : unavailable
            ? `Cross-check unavailable (HTTP ${status})`
            : "Cross-check failed.",
        message: msg,
        details: err.details ?? [],
      });
      setPhase("xcheck", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, embeddings, s, sam]);

  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (checksRef.current.skeptic !== "idle" || checksRef.current.xcheck !== "idle") return;
    void runSkeptic(true);
    void runXcheck(true);
  }, [runSkeptic, runXcheck]);

  const done = (p: CheckPhase) => p === "ok" || p === "error";
  const canReport = done(checks.skeptic) && done(checks.xcheck);

  return (
    <section className="screen on" aria-labelledby="h-check">
      <div className="wrap">
        <BackButton label="Numbers" onClick={() => go("sNum")} />
        <Stepper step={5} />
        <h1 id="h-check">Checked twice.</h1>
        <p className="sub">A second check has to agree. Disagreements print red, never hidden.</p>

        <div className="checkcard">
          <h3>Independent skeptic</h3>
          <p>Spark Open re-derives every number from the receipts. Anything it cannot reproduce is marked disputed.</p>
          <button
            id="skepticBtn"
            className="btn btn-dark"
            type="button"
            style={{ width: "100%" }}
            onClick={() => {
              setPhase("skeptic", "idle");
              void runSkeptic(false);
            }}
          >
            Ask skeptic
          </button>
          <span id="skStatus" role="status">{skStatus}</span>
          <div id="skOut" aria-live="polite">
            {checks.skeptic === "loading" && <div className="skel" role="status" aria-label="Skeptic is checking" />}
            {skError && (
              <div className="statecard err" role="alert">
                <b>{skError.title}</b>
                <p style={{ margin: "8px 0 12px", color: "#5b6b8c" }}>{skError.message}</p>
                {skError.details.length > 0 && (
                  <ul>
                    {skError.details.map((d, i) => (
                      <li key={i}><small>{d}</small></li>
                    ))}
                  </ul>
                )}
                <button className="btn-dark" type="button" style={{ width: "100%" }} onClick={() => void runSkeptic(false)}>
                  Retry skeptic
                </button>
              </div>
            )}
            {skRows && (
              <ul>
                {skRows.map((f, i) => (
                  <li key={i}>
                    {verdictBadge(f.disputed ? "DISPUTED" : "AGREED")} {f.statement}
                    <br />
                    <small>cites: {f.citations}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="checkcard">
          <h3>Mask cross-check</h3>
          <p>Sends this photo once to SAM 3.1 and compares its outline with the one measured on this device.</p>
          <button
            id="xcheckBtn"
            className="btn btn-ghostline"
            type="button"
            style={{ width: "100%" }}
            onClick={() => {
              setPhase("xcheck", "idle");
              void runXcheck(false);
            }}
          >
            Cross-check masks
          </button>
          <span id="xStatus" role="status" style={{ display: "block", fontSize: 13, color: "#5b6b8c", marginTop: 8, minHeight: "1.2em" }}>
            {checks.xcheck === "loading" ? "Asking SAM 3.1…" : xNote}
            {xBadge && (
              <span className={`badge ${xBadge.verdict === "AGREED" ? "ok" : "fail"}`}>
                {xBadge.verdict} · IoU {String(xBadge.iou)}
              </span>
            )}
            {xError && (
              <span className="statecard err" role="alert" style={{ display: "block" }}>
                <b>{xError.title}</b>
                <p style={{ margin: "8px 0 12px", color: "#5b6b8c" }}>{xError.message}</p>
                {xError.details.length > 0 && (
                  <ul>
                    {xError.details.map((d, i) => (
                      <li key={i}><small>{d}</small></li>
                    ))}
                  </ul>
                )}
                <button className="btn-ghostline" type="button" style={{ width: "100%" }} onClick={() => void runXcheck(false)}>
                  Retry cross-check
                </button>
              </span>
            )}
          </span>
        </div>

        <div className="stickycta">
          <button
            id="toReport"
            className="btn-primary"
            type="button"
            style={{ width: "100%" }}
            disabled={!canReport}
            onClick={() => {
              if (canReport) go("sReport");
              else setSkStatus("Run both checks to continue — retry any failed one.");
            }}
          >
            {canReport ? "Make the report →" : "Run both checks to continue"}
          </button>
        </div>
      </div>
    </section>
  );
}
