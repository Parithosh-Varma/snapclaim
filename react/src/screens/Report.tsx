import { useEffect, useState } from "react";
import { useApp } from "../App";
import { apiGet, apiPost } from "../lib/api";
import { createSession } from "../lib/session";
import { BackButton, Badge, Stepper, downloadFile } from "../lib/ui";
import { buildReportPdf, dataUrlToJpegBytes, type PdfPhoto } from "../lib/pdf";
import { shareUrl } from "../lib/share";

/** Mirror of sanitizeSvg in pwa/app.js: the downloaded .svg opens as a
 * document, so strip scripts, foreign objects (incl. self-closing) and
 * src/data-based script vectors before creating the Blob. */
export function sanitizeSvg(svg: string): string {
  return String(svg)
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/<\s*(iframe|embed|object|link|style|meta|base|form|handler|set|animate|animateTransform)[\s>]/gi, "<!--$1-blocked-->")
    .replace(/<\s*foreignObject\b[^>]*\/>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:xlink:href|href|src|data|background|poster|srcdoc|action|formaction)\s*=\s*("\s*(?:javascript|data\s*:\s*text\/html)[^"]*"|'\s*(?:javascript|data\s*:\s*text\/html)[^']*'|(?:javascript|data\s*:)[^\s>]*)/gi, "");
}

export default function Report() {
  const ctx = useApp();
  const { session: s, go, base, store, toast, bumpCases } = ctx;
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
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
  const refNo = s.currentCaseId ? `SC-${s.currentCaseId.slice(0, 8).toUpperCase()}` : "DRAFT";
  const refs = (f?.receiptIds ?? {}) as Record<string, string>;
  const checkText = (p: string) =>
    p === "ok" ? "verified" : p === "error" ? "needs a retry" : p === "loading" ? "checking…" : "not run";

  const saveCaseFromReport = () => {
    if (!f) return;
    const saved = store.save({
      id: s.currentCaseId ?? undefined,
      name: `${String(f.label).charAt(0).toUpperCase() + String(f.label).slice(1)} - ${dateStr}`,
      transcript: s.transcript.trim(),
      label: String(f.label),
      percent: f.percent,
      severity: String(f.severity),
      crackLengthMm: f.crackLengthMm ?? null,
      areaCm2: f.areaCm2 ?? null,
      mode: s.measurement?.mode ?? "",
      photo: s.stillDataUrl || null,
      locationPhoto: s.locationPhoto,
    });
    s.currentCaseId = saved.id;
    bumpCases();
    toast(saved.photoDropped || saved.locationDropped ? "Case saved without photo (device storage full)" : "Case saved on this device");
  };

  const render = async () => {
    if (!s.payload || !f) {
      setRenderError("Nothing to render yet - go back and measure the damage first.");
      return;
    }
    setRendering(true);
    setRenderError(null);
    setState("Generating report…");
    const body = JSON.parse(JSON.stringify(s.payload)) as Record<string, unknown>;
    body.transcript = s.transcript;
    const overlay = body.overlay as { photoHref?: string } | undefined;
    // Downscale for the annexure: the SVG panel renders at most 752 px wide,
    // and a full-size href risks the server's length cap (silent grey panel).
    if (overlay && s.photo) {
      const scale = Math.min(1, 768 / Math.max(s.photo.width, s.photo.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(s.photo.width * scale));
      c.height = Math.max(1, Math.round(s.photo.height * scale));
      const g = c.getContext("2d");
      if (!g) throw new Error("photo would not decode");
      g.drawImage(s.photo, 0, 0, c.width, c.height);
      overlay.photoHref = c.toDataURL("image/jpeg", 0.72);
    }
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
      // A photo-less annexure renders as outlines on grey with a footer and
      // no photo - never accept that silently.
      if (overlay?.photoHref && !rawSvg.includes("<image")) {
        throw new Error("annexure came back without the photo - tap Generate report to retry");
      }
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

  /** Downscale any displayable image URL to a capped JPEG data URL. */
  const dataUrlOf = (url: string, maxSide: number): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.naturalWidth * scale));
          c.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const g = c.getContext("2d");
          if (!g) throw new Error("no 2d context");
          g.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.8));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      };
      img.onerror = () => reject(new Error("figure would not decode"));
      img.src = url;
    });

  /** Rasterize a displayable image URL to capped JPEG bytes + dimensions. */
  const rasterizeToJpeg = (url: string, maxSide: number, bg = "#fff"): Promise<PdfPhoto> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.naturalWidth * scale));
          c.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const g = c.getContext("2d", { willReadFrequently: true });
          if (!g) throw new Error("no 2d context");
          g.fillStyle = bg;
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          // A blank raster (failed SVG paint, dead blob URL) must never
          // become a blank PDF page - check before accepting it.
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let sum = 0;
          let n = 0;
          for (let i = 0; i < d.length; i += 401 * 4) {
            sum += (d[i] as number) + (d[i + 1] as number) + (d[i + 2] as number);
            n += 3;
          }
          if (n > 0 && sum / n / 255 < 0.02) throw new Error("figure rendered blank");
          resolve({ jpeg: dataUrlToJpegBytes(c.toDataURL("image/jpeg", 0.85)), width: c.width, height: c.height, caption: "" });
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      };
      img.onerror = () => reject(new Error("photo would not decode"));
      img.src = url;
    });

  /** Real PDF download: a file the OS saves, with no reliance on the browser's
      print dialog (which is a silent no-op in installed iOS PWAs). Photo +
      outlined annexure embedded as JPEG. */
  const downloadPdf = async () => {
    if (!f || pdfBusy || !gateOk) return;
    setPdfBusy(true);
    try {
      const photos: PdfPhoto[] = [];
      if (s.stillDataUrl) {
        const p = await rasterizeToJpeg(s.stillDataUrl, 1000);
        p.caption = "Figure 1 - captured photo, full frame";
        photos.push(p);
      }
      if (s.locationPhoto) {
        try {
          const p = await rasterizeToJpeg(s.locationPhoto, 1000);
          p.caption = "Figure 2 - wider view showing where on the property the damage is. Context only, not measured.";
          photos.push(p);
        } catch {
          setState("Location photo came out blank and was skipped - the numbers below are unaffected.");
        }
      }
      if (annexSrc) {
        try {
          const p = await rasterizeToJpeg(annexSrc, 1000);
          p.caption = `Figure ${photos.length + 1} - measured outlines (red damage, green coin scale, from the evidence)`;
          photos.push(p);
        } catch {
          setState("Annexure came out blank and was skipped - the numbers below are unaffected.");
        }
      }
      if (!photos.length) throw new Error("no figures rendered - retake or reselect the photo");
      const row = (item: string, value: string | null, ev: string | undefined): { item: string; value: string; evidence: string; status: string } => ({
        item,
        value: value ?? "-",
        evidence: ev ?? "-",
        status: "Confirmed",
      });
      const bytes = buildReportPdf({
        brand: "SnapClaim",
        ref: refNo,
        dateLine: gateOk ? String(document.querySelector("#docMeta")?.textContent ?? dateStr) : dateStr,
        headerLogo: await rasterizeToJpeg("./snapclaim-mark-dark.png", 160, "#0b1e46").catch(() => undefined),
        quote: s.transcript.trim(),
        rows: [
          ...(f.crackLengthMm != null ? [row("Crack length", `${String(f.crackLengthMm)} mm`, refs.length)] : []),
          ...(f.crackWidthMm != null ? [row("Crack width", `${String(f.crackWidthMm)} mm`, refs.width)] : []),
          row("Surface affected", `${String(f.percent)} %`, refs.ratio),
          ...(f.areaCm2 != null ? [row("Area", `${String(f.areaCm2)} cm2`, refs.area)] : []),
          row("Severity", String(f.severity), refs.severity),
        ],
        method: s.measurement?.mode === "absolute"
          ? "Outlines measured from photo pixels, scaled by the coin diameter (tilt-corrected from its ellipse). Every number cites its evidence receipt."
          : "Percent-only report: no coin scale was available, so lengths stay unmeasured. Every number cites its evidence receipt.",
        checks: `Evidence gate: ${gateOk ? "passed" : "pending"} - Independent skeptic: ${checkText(ctx.checks.skeptic)} - Mask cross-check: ${checkText(ctx.checks.xcheck)}`,
        photos,
      });
      downloadFile(`snapclaim-${refNo}.pdf`, new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }));
      setState("PDF downloaded.");
    } catch (e) {
      setState(`PDF failed (${e instanceof Error ? e.message : String(e)}) - use Share or Copy instead.`);
    } finally {
      setPdfBusy(false);
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
        setState("Copied - no share sheet on this device.");
      } catch {
        setState("Sharing unavailable here - use Download SVG.");
      }
    }
  };

  const waUrl = `https://wa.me/?text=${encodeURIComponent(`${summaryText()} ${window.location.origin}${window.location.pathname}`)}`;
  const mailUrl = `mailto:?subject=${encodeURIComponent(`SnapClaim damage report ${refNo}`)}&body=${encodeURIComponent(summaryText())}`;
  const copy = async () => {
    const text = summaryText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setState("Summary copied to clipboard.");
    } catch {
      setState("Copy failed in this browser - select the summary manually.");
    }
  };

  /* Landlord link: the whole report rides in the URL hash, so nothing is
     uploaded anywhere. Anyone opening it sees the read-only report view. */
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkFallback, setLinkFallback] = useState<string | null>(null);
  const copyShareLink = async () => {
    if (!f || !gateOk || linkBusy) return;
    setLinkBusy(true);
    setLinkFallback(null);
    let url = "";
    try {
      const figure = async (): Promise<string> => {
        if (annexSrc) return dataUrlOf(annexSrc, 900);
        if (!s.stillDataUrl) throw new Error("no photo");
        return dataUrlOf(s.stillDataUrl, 900);
      };
      url = shareUrl({
        v: 1,
        ref: refNo,
        date: dateStr,
        label: String(f.label),
        percent: f.percent,
        lengthMm: f.crackLengthMm ?? null,
        widthMm: f.crackWidthMm ?? null,
        areaCm2: f.areaCm2 ?? null,
        severity: String(f.severity),
        mode: s.measurement?.mode === "absolute" ? "absolute" : "percent-only",
        transcript: s.transcript.trim().slice(0, 500),
        checks: `Evidence gate: passed - Independent skeptic: ${checkText(ctx.checks.skeptic)} - Mask cross-check: ${checkText(ctx.checks.xcheck)}`,
        img: await figure(),
        locationImg: s.locationPhoto ? await dataUrlOf(s.locationPhoto, 900).catch(() => null) : null,
      });
      await navigator.clipboard.writeText(url);
      setState("Share link copied - anyone opening it sees this report. Nothing was uploaded.");
    } catch (e) {
      // Headless/background tabs refuse clipboard writes; hand over the raw
      // link in a selectable field instead of failing silently.
      if (url) {
        setLinkFallback(url);
        setState("Clipboard blocked here - long-press the link below to copy it manually.");
      } else {
        setState(`Share link failed (${e instanceof Error ? e.message : String(e)}) - use Download PDF instead.`);
      }
    } finally {
      setLinkBusy(false);
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
        <BackButton label="Checks" onClick={() => go("sCheck")} />
        <Stepper step={6} />
        <h1 id="h-send">Send the report.</h1>
        <p className="sub">To your landlord or insurer, in one tap.</p>

        <article className="doc" id="reportDoc" aria-label="Damage report preview">
          <header className="doc-head">
            <div>
              <span className="doc-brand">SnapClaim</span>
              <b>Damage report</b>
              <small className="doc-ref">Ref {refNo}</small>
              <small id="docMeta">
                {gateOk
                  ? `Generated ${dateStr} · ${s.measurement?.findings.length ?? 0} finding${s.measurement?.findings.length === 1 ? "" : "s"}`
                  : "Not generated yet"}
              </small>
              {gateOk && <small className="doc-note">Device-clock time, not verified evidence time.</small>}
            </div>
            {gateOk ? <Badge kind="ok">Gate pass</Badge> : <Badge kind="wait">Pending</Badge>}
          </header>

          <h2>1 · Observed damage</h2>
          {(s.stillDataUrl || annexSrc) && (
            <figure className="doc-annex">
              <img
                id="annexImg"
                alt={annexSrc ? "Measured damage outlines over the captured photo" : "Captured damage photo, full frame"}
                src={annexSrc ?? s.stillDataUrl ?? ""}
              />
              <figcaption>
                {annexSrc
                  ? "Figure 1 - the full photograph, with the measured outlines drawn from the evidence: red for damage, green for the coin scale reference. Nothing is traced by hand."
                  : "Figure 1 - the full photograph, as captured. Generating the report draws the measured outlines onto it."}
              </figcaption>
            </figure>
          )}
          {s.extendedTranscript?.trim() ? (
            <>
              <blockquote id="docQuote">{s.extendedTranscript.trim()}</blockquote>
              <p className="doc-note">AI-extended from your one line (“{s.transcript.trim()}”).</p>
            </>
          ) : s.transcript.trim() ? (
            <blockquote id="docQuote">“{s.transcript.trim()}”</blockquote>
          ) : null}
          {s.locationPhoto && (
            <figure className="doc-annex">
              <img id="locPhotoFig" alt="Wider view showing where the damage is" src={s.locationPhoto} />
              <figcaption>Figure 2 - wider view showing where on the property the damage is. Context only, not measured.</figcaption>
            </figure>
          )}

          <h2>2 · Measurements</h2>
          <div className="doctable">
          <table>
            <thead>
              <tr><th scope="col">Item</th><th scope="col">Value</th><th scope="col">Evidence</th><th scope="col">Status</th></tr>
            </thead>
            <tbody id="docRows">
              {f ? (
                <>
                  {f.crackLengthMm != null && (
                    <tr>
                      <th scope="row">Crack length</th>
                      <td data-h="Value">{String(f.crackLengthMm)} mm</td>
                      <td data-h="Evidence" className="mono">{refs.length ?? "-"}</td>
                      <td data-h="Status"><Badge kind="ok">Confirmed</Badge></td>
                    </tr>
                  )}
                  {f.crackWidthMm != null && (
                    <tr>
                      <th scope="row">Crack width</th>
                      <td data-h="Value">{String(f.crackWidthMm)} mm</td>
                      <td data-h="Evidence" className="mono">{refs.width ?? "-"}</td>
                      <td data-h="Status"><Badge kind="ok">Confirmed</Badge></td>
                    </tr>
                  )}
                  <tr>
                    <th scope="row">Surface affected</th>
                    <td data-h="Value">{String(f.percent)} %</td>
                    <td data-h="Evidence" className="mono">{refs.ratio ?? "-"}</td>
                    <td data-h="Status"><Badge kind="ok">Confirmed</Badge></td>
                  </tr>
                  {f.areaCm2 != null && (
                    <tr>
                      <th scope="row">Area</th>
                      <td data-h="Value">{String(f.areaCm2)} cm²</td>
                      <td data-h="Evidence" className="mono">{refs.area ?? "-"}</td>
                      <td data-h="Status"><Badge kind="ok">Confirmed</Badge></td>
                    </tr>
                  )}
                  <tr>
                    <th scope="row">Severity</th>
                    <td data-h="Value">{String(f.severity)}</td>
                    <td data-h="Evidence" className="mono">{refs.severity ?? "-"}</td>
                    <td data-h="Status"><Badge kind="ok">Confirmed</Badge></td>
                  </tr>
                </>
              ) : (
                <tr>
                  <th>Measurement</th>
                  <td data-h="Value">Generate the report to fill this in.</td>
                  <td data-h="Evidence">-</td>
                  <td data-h="Status"><Badge kind="wait">Pending</Badge></td>
                </tr>
              )}
            </tbody>
          </table>
          </div>

          <h2>3 · Method</h2>
          <p className="doc-method">
            {s.measurement?.mode === "absolute"
              ? "Outlines measured from photo pixels, scaled by the coin diameter (tilt-corrected from its ellipse). Every number cites its evidence receipt."
              : "Percent-only report: no coin scale was available, so lengths stay unmeasured. Every number cites its evidence receipt."}
          </p>

          <h2>4 · Verification</h2>
          <p className="doc-checks">
            Evidence gate: {gateOk ? "passed" : "pending"} · Independent skeptic: {checkText(ctx.checks.skeptic)} · Mask cross-check: {checkText(ctx.checks.xcheck)}
          </p>

          <p className="doc-foot">Generated on this device by SnapClaim · Ref {refNo}</p>
        </article>

        <div className="card">
          <button id="renderBtn" className={`btn-primary${rendering ? " busy" : ""}`} type="button" onClick={render} disabled={rendering} aria-busy={rendering}>
            {rendering ? "Generating…" : "Generate report"}
          </button>
          {state ? <div id="reportState" className="stateline" aria-live="polite">{state}</div> : null}
          <div className="rowbtns">
            <button id="pdfBtn" className={`btn-dark${pdfBusy ? " busy" : ""}`} type="button" disabled={!gateOk || pdfBusy} aria-busy={pdfBusy} onClick={() => void downloadPdf()}>{pdfBusy ? "Preparing PDF…" : "Download PDF"}</button>
          </div>
          <div className="rowbtns">
            <button id="shareBtn" className="btn-ghostline" type="button" disabled={!gateOk} onClick={share}>Share</button>
            <a id="emailBtn" className="btn-ghostline" href={gateOk ? mailUrl : undefined} aria-disabled={!gateOk} onClick={(e) => { if (!gateOk) e.preventDefault(); }}>Email</a>
          </div>
          <div className="rowbtns">
            <button id="copyBtn" className="btn-ghostline" type="button" disabled={!gateOk} onClick={copy}>Copy summary</button>
            <a id="waBtn" className="btn-ghostline" href={gateOk ? waUrl : undefined} target="_blank" rel="noreferrer noopener" aria-disabled={!gateOk} onClick={(e) => { if (!gateOk) e.preventDefault(); }}>WhatsApp</a>
          </div>
          <button
            id="linkBtn"
            className={`btn-dark${linkBusy ? " busy" : ""}`}
            type="button"
            style={{ width: "100%", marginTop: 10 }}
            disabled={!gateOk || linkBusy}
            aria-busy={linkBusy}
            onClick={() => void copyShareLink()}
          >
            {linkBusy ? "Making link…" : "Copy landlord link"}
          </button>
          <p className="fineprint" style={{ margin: "6px 2px 0" }}>The link itself carries the report - photo and numbers open for anyone, nothing is uploaded.</p>
          {linkFallback && (
            <textarea
              id="linkFallback"
              readOnly
              rows={3}
              value={linkFallback}
              onFocus={(e) => e.currentTarget.select()}
              style={{ width: "100%", marginTop: 8, fontSize: 12, wordBreak: "break-all" }}
              aria-label="Share link, select and copy manually"
            />
          )}
          <div className="rowbtns">
            {annexSrc && (
              <a
                id="dl"
                href={annexSrc}
                download="snapclaim-annexure.svg"
                style={{ flex: 1, textAlign: "center", padding: 12, border: "1px solid #e2ddd0", borderRadius: 0 }}
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
            New report for another damage
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
          </div>
        </div>

        <details className="dev">
          <summary>Developer - backend, payload &amp; raw output</summary>
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
