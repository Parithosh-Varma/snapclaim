import { useEffect, useState } from "react";
import { useApp } from "../App";
import { apiGet, apiPost } from "../lib/api";
import { createSession } from "../lib/session";
import { BackButton, Badge, Stepper, downloadFile } from "../lib/ui";

/** Mirror of sanitizeSvg in pwa/app.js: the downloaded .svg opens as a
 * document, so strip scripts, foreign objects (incl. self-closing) and
 * href-based script vectors before creating the Blob. */
export function sanitizeSvg(svg: string): string {
  return String(svg)
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/<foreignObject\b[^>]*\/>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:xlink:href|href)\s*=\s*("\s*(?:javascript|data\s*:\s*text\/html)[^"]*"|'\s*(?:javascript|data\s*:\s*text\/html)[^']*'|(?:javascript|data\s*:)[^\s>]*)/gi, "");
}

export default function Report() {
  const ctx = useApp();
  const { session: s, go, base, store, toast, bumpCases } = ctx;
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [state, setState] = useState("");
  const [gateOk, setGateOk] = useState(false);
  const [annexSrc, setAnnexSrc] = useState<string | null>(null);
  const [healthOut, setHealthOut] = useState("");
  const [installEvt, setInstallEvt] = useState<Event | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const f = s.measurement?.findings[0];
  const dateStr = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  const saveCaseFromReport = () => {
    if (!f) return;
    const saved = store.save({
      id: s.currentCaseId ?? undefined,
      name: `${String(f.label).charAt(0).toUpperCase() + String(f.label).slice(1)} — ${dateStr}`,
      transcript: s.transcript.trim(),
      label: String(f.label),
      percent: f.percent,
      severity: String(f.severity),
      crackLengthMm: f.crackLengthMm ?? null,
      areaCm2: f.areaCm2 ?? null,
      mode: s.measurement?.mode ?? "",
      photo: s.stillDataUrl || null,
    });
    s.currentCaseId = saved.id;
    bumpCases();
    toast(saved.photoDropped ? "Case saved without photo (device storage full)" : "Case saved on this device");
  };

  const render = async () => {
    if (!s.payload) return;
    setRendering(true);
    setRenderError(null);
    setState("Generating report…");
    const body = JSON.parse(JSON.stringify(s.payload)) as Record<string, unknown>;
    body.transcript = s.transcript;
    const overlay = body.overlay as { photoHref?: string } | undefined;
    if (overlay && s.photo) overlay.photoHref = s.photo.toDataURL("image/jpeg", 0.8);
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30000);
      let out: Awaited<ReturnType<typeof apiPost>>;
      try {
        out = await apiPost(base, "/v1/render", body, ctl.signal);
      } finally {
        clearTimeout(timer);
      }
      const { res, j } = out;
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const rawSvg = String((j.result as { svg?: unknown } | undefined)?.svg ?? "");
      // The annexure preview renders in <img> (script-inert), but the
      // downloaded .svg opens as a document and would run embedded scripts.
      // Strip scriptable content before creating the Blob.
      const svg = sanitizeSvg(rawSvg);
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      if (s.annexUrl) URL.revokeObjectURL(s.annexUrl);
      s.annexUrl = url;
      // Wait for the preview to actually paint before declaring success.
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("preview failed to render"));
        img.src = url;
      });
      setAnnexSrc(url);
      setGateOk(true);
      setState("");
      saveCaseFromReport();
    } catch (e) {
      const what = e instanceof Error && e.name === "AbortError" ? "timed out after 30 s" : e instanceof Error ? e.message : String(e);
      setRenderError(what);
      setState("");
    } finally {
      setRendering(false);
    }
  };

  const summaryText = () => {
    if (!f) return "";
    const bits = [`${String(f.label)} covers ${String(f.percent)}% of the wall`];
    if (f.crackLengthMm != null) bits.push(`measures ${String(f.crackLengthMm)} mm`);
    if (f.areaCm2 != null) bits.push(`covers ${String(f.areaCm2)} cm²`);
    bits.push(`classified ${String(f.severity)}`);
    return `SnapClaim: ${bits.join("; ")}. Every number cited by receipt.`;
  };

  const share = async () => {
    const text = summaryText();
    if (!text) return;
    try {
      if (navigator.share) await navigator.share({ title: "SnapClaim damage report", text });
      else throw new Error("no native share sheet");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setState("Copied — no share sheet on this device.");
      } catch {
        setState("Sharing unavailable here — use Download SVG.");
      }
    }
  };

  const copy = async () => {
    const text = summaryText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setState("Summary copied to clipboard.");
    } catch {
      setState("Copy failed in this browser — select the summary manually.");
    }
  };

  const newClaim = () => {
    Object.assign(s, createSession());
    setGateOk(false);
    setAnnexSrc(null);
    ctx.setChecks({ skeptic: "idle", xcheck: "idle" });
    ctx.setNumError(null);
    ctx.startCapture();
  };

  return (
    <section className="screen on" aria-labelledby="h-send">
      <div className="wrap">
        <BackButton label="Checked" onClick={() => go("sCheck")} />
        <Stepper step={6} />
        <h1 id="h-send">Send the report.</h1>
        <p className="sub">To your landlord or insurer, in one tap.</p>

        <article className="doc" id="reportDoc" aria-label="Damage report preview">
          <header className="doc-head">
            <div>
              <b>Damage report</b>
              <small id="docMeta">
                {gateOk
                  ? `Generated ${dateStr} · ${s.measurement?.findings.length ?? 0} finding${s.measurement?.findings.length === 1 ? "" : "s"} · device-clock date, not verified evidence time`
                  : "Not generated yet"}
              </small>
            </div>
            {gateOk ? <Badge kind="ok">Gate pass</Badge> : <Badge kind="wait">Pending</Badge>}
          </header>
          {s.stillDataUrl && (
            <img id="docPhoto" alt="Captured damage photo" src={s.stillDataUrl} style={{ width: "100%", height: 200, objectFit: "cover", display: "block" }} />
          )}
          {s.transcript.trim() && <blockquote id="docQuote">“{s.transcript.trim()}”</blockquote>}
          <table>
            <tbody id="docRows">
              {f ? (
                <>
                  {f.crackLengthMm != null && (
                    <tr>
                      <th scope="row">Crack length</th>
                      <td>{String(f.crackLengthMm)} mm</td>
                      <td><Badge kind="ok">Confirmed</Badge></td>
                    </tr>
                  )}
                  <tr>
                    <th scope="row">Surface affected</th>
                    <td>{String(f.percent)} %</td>
                    <td><Badge kind="ok">Confirmed</Badge></td>
                  </tr>
                  {f.areaCm2 != null && (
                    <tr>
                      <th scope="row">Area</th>
                      <td>{String(f.areaCm2)} cm²</td>
                      <td><Badge kind="ok">Confirmed</Badge></td>
                    </tr>
                  )}
                  <tr>
                    <th scope="row">Severity</th>
                    <td>{String(f.severity)}</td>
                    <td><Badge kind="ok">Confirmed</Badge></td>
                  </tr>
                </>
              ) : (
                <tr>
                  <th>Measurement</th>
                  <td>Generate the report to fill this in.</td>
                </tr>
              )}
            </tbody>
          </table>
        </article>

        <div id="reportState" aria-live="polite">{state}</div>

        <div className="card">
          <button id="renderBtn" className={`btn-primary${rendering ? " busy" : ""}`} type="button" onClick={render} disabled={rendering} aria-busy={rendering}>
            {rendering ? "Generating…" : "Generate report"}
          </button>
          <div className="rowbtns">
            <button id="shareBtn" className="btn-ghostline" type="button" disabled={!gateOk} onClick={share}>Share</button>
            <button id="copyBtn" className="btn-ghostline" type="button" disabled={!gateOk} onClick={copy}>Copy summary</button>
          </div>
          <div className="rowbtns">
            {annexSrc && (
              <a
                id="dl"
                href={annexSrc}
                download="snapclaim-annexure.svg"
                style={{ flex: 1, textAlign: "center", padding: 12, border: "1px solid #e2ddd0", borderRadius: 14 }}
              >
                Download SVG annexure
              </a>
            )}
            {installEvt && (
              <button
                id="installBtn"
                className="btn-ghostline"
                type="button"
                onClick={async () => {
                  const ev = installEvt as Event & { prompt(): void; userChoice: Promise<unknown> };
                  ev.prompt();
                  await ev.userChoice.catch(() => {});
                  setInstallEvt(null);
                }}
              >
                Install app
              </button>
            )}
          </div>
          <button id="newClaimBtn" className="btn-ghostline" type="button" style={{ marginTop: 10 }} onClick={newClaim}>
            Start a new claim
          </button>
          <button id="doneHome" className="btn-ghostline" type="button" style={{ marginTop: 10 }} onClick={() => go("tHome")}>
            Back to home
          </button>
          <div id="annexWrap" style={{ marginTop: 12 }}>
            {rendering && <div className="skel" role="status" aria-label="Generating report" />}
            {renderError && (
              <div className="statecard err" role="alert">
                <b>Report failed.</b>
                <p style={{ margin: "8px 0 12px", color: "#5b6b8c" }}>{renderError}</p>
                <button className="btn-dark" type="button" style={{ width: "100%" }} onClick={render}>Retry</button>
              </div>
            )}
            {annexSrc && <img id="annexImg" alt="Generated report annexure" src={annexSrc} />}
          </div>
        </div>

        <details className="dev">
          <summary>Developer — backend, payload &amp; raw output</summary>
          <div style={{ marginTop: 12 }}>
            <p className="fineprint" style={{ margin: "0 0 10px" }}>
              Backend: <span id="baseUrl">{base}</span> <span style={{ fontWeight: 400 }}>(change it in Settings → Connection → Advanced)</span>
            </p>
            <div className="rowbtns" style={{ marginTop: 0 }}>
              <button
                id="openAdminBtn"
                className="btn-ghostline"
                type="button"
                onClick={() => window.location.assign("/admin")}
              >
                Open admin panel
              </button>
              <button
                id="healthBtn"
                className="btn-ghostline"
                type="button"
                onClick={async () => {
                  try {
                    const { j } = await apiGet(base, "/v1/health");
                    setHealthOut(`ok v${String(j.version)} mode:${String(j.mode)}`);
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    setHealthOut(msg.includes("security policy") ? msg : "unreachable");
                  }
                }}
              >
                Check backend
              </button>
            </div>
            <span id="healthOut" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{healthOut}</span>
            <h3 style={{ margin: "12px 0 6px" }}>Raw report</h3>
            <pre id="raw">{s.raw}</pre>
          </div>
        </details>
      </div>
    </section>
  );
}
