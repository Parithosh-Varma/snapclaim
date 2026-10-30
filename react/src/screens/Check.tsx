import { useCallback, useEffect, useRef, useState } from "react";
import { useApp, type CheckPhase } from "../App";
import { apiPost } from "../lib/api";
import { encodeRle } from "../lib/rle";
import { segmentViaApi, type SamClient } from "../lib/sam";
import type { SamMask, Session } from "../lib/session";
import { BackButton, Badge, Stepper } from "../lib/ui";

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
  const [skError, setSkError] = useState<string | null>(null);
  const [xBadge, setXBadge] = useState<{ verdict: string; iou: unknown } | null>(null);
  const [xError, setXError] = useState<string | null>(null);
  const [xNote, setXNote] = useState("");
  const checksRef = useRef(checks);
  checksRef.current = checks;
  const setPhase = (which: "skeptic" | "xcheck", phase: CheckPhase) =>
    setChecks({ ...checksRef.current, [which]: phase });

  const runSkeptic = useCallback(async (auto: boolean) => {
    if (checksRef.current.skeptic === "loading") return;
    if (!s.measurement) {
      if (!auto) setSkStatus("The findings load from the Numbers step — measure first.");
      return;
    }
    setPhase("skeptic", "loading");
    setSkError(null);
    setSkRows(null);
    setSkStatus("Asking the skeptic model…");
    try {
      const { res, j } = await apiPost(base, "/v1/skeptic", {
        ...(s.payload ?? {}),
        transcript: s.transcript,
        findings: s.measurement.findings,
        receipts: s.measurement.receipts,
      });
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const rows = ((j.result as { findings?: { statement?: string; citations?: string[] }[] } | undefined)?.findings ?? []).map((f) => ({
        disputed: /disputed/i.test(f.statement || ""),
        statement: f.statement ?? "",
        citations: (f.citations ?? []).join(", "),
      }));
      setSkRows(rows);
      setSkStatus(`skeptic ok ${j.requestId ?? ""}`.trim());
      setPhase("skeptic", "ok");
    } catch (e) {
      setSkError(e instanceof Error ? e.message : String(e));
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
        if (!embeddings.current) throw new Error("On-device model still loading — retry in a moment.");
        const dev = await segmentOnDevice(sam, s);
        if (!dev) throw new Error("The on-device model found nothing at those taps.");
        other = encodeRle(dev.mask, s.photo.width, s.photo.height);
      } else {
        other = (await segmentViaApi(base, s.photo, s.dmg.points)).rle;
      }
      const { res, j } = await apiPost(base, "/v1/crosscheck", {
        a: encodeRle(s.dmg.mask, s.photo.width, s.photo.height),
        b: other,
        threshold: 0.5,
      });
      if (!res.ok || !j.ok) throw new Error(j.error ?? "cross-check failed");
      const result = j.result as unknown as { verdict: string; iou: unknown };
      setXBadge({ verdict: result.verdict, iou: result.iou });
      setPhase("xcheck", "ok");
    } catch (e) {
      setXError(e instanceof Error ? e.message : String(e));
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
                <b>Skeptic check failed.</b>
                <p style={{ margin: "8px 0 12px", color: "#5b6b8c" }}>{skError}</p>
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
                <b>Cross-check failed.</b>
                <p style={{ margin: "8px 0 12px", color: "#5b6b8c" }}>{xError}</p>
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
