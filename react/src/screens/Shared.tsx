import { useState } from "react";
import { useApp } from "../App";
import { BackButton, Badge, Stepper } from "../lib/ui";
import { buildReportPdf, dataUrlToJpegBytes, type PdfPhoto } from "../lib/pdf";
import { downloadFile } from "../lib/ui";
import type { SharedReport } from "../lib/share";

/**
 * Read-only landlord view for a `#/s/...` share link. Nothing here measures
 * or edits: the photo, numbers and quote render from the link itself.
 */
export default function Shared({ rep }: { rep: SharedReport }) {
  const { go } = useApp();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const home = () => {
    try {
      history.replaceState(null, "", window.location.pathname);
    } catch { /* hash stays; the home screen still loads */ }
    go("tHome");
  };

  const download = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("shared photo would not decode"));
        img.src = rep.img;
      });
      const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
      const photo: PdfPhoto = {
        jpeg: dataUrlToJpegBytes(rep.img),
        width: Math.max(1, Math.round(img.naturalWidth * scale)),
        height: Math.max(1, Math.round(img.naturalHeight * scale)),
        caption: "Figure 1 - shared report photograph",
      };
      let logo: PdfPhoto | undefined;
      try {
        logo = await ((): Promise<PdfPhoto> => new Promise((resolve, reject) => {
          const li = new Image();
          li.onload = () => {
            const lc = document.createElement("canvas");
            lc.width = 120;
            lc.height = Math.max(1, Math.round((120 * li.naturalHeight) / Math.max(1, li.naturalWidth)));
            const lg = lc.getContext("2d");
            if (!lg) throw new Error("no 2d context");
            lg.fillStyle = "#0b1e46";
            lg.fillRect(0, 0, lc.width, lc.height);
            lg.drawImage(li, 0, 0, lc.width, lc.height);
            resolve({
              jpeg: dataUrlToJpegBytes(lc.toDataURL("image/jpeg", 0.85)),
              width: lc.width,
              height: lc.height,
              caption: "",
            });
          };
          li.onerror = () => reject(new Error("logo would not decode"));
          li.src = "./snapclaim-mark-dark.png";
        }))();
      } catch {
        logo = undefined;
      }
      const row = (item: string, value: string | null, status = "Confirmed"): { item: string; value: string; evidence: string; status: string } => ({
        item,
        value: value ?? "-",
        evidence: "-",
        status,
      });
      let locFig: PdfPhoto | null = null;
      if (rep.locationImg) {
        try {
          const li = await new Promise<HTMLImageElement>((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error("shared location photo would not decode"));
            im.src = rep.locationImg as string;
          });
          const lscale = Math.min(1, 1000 / Math.max(li.naturalWidth, li.naturalHeight));
          locFig = {
            jpeg: dataUrlToJpegBytes(rep.locationImg as string),
            width: Math.max(1, Math.round(li.naturalWidth * lscale)),
            height: Math.max(1, Math.round(li.naturalHeight * lscale)),
            caption: "Figure 2 - wider view showing where the damage is. Context only, not measured.",
          };
        } catch {
          locFig = null;
        }
      }
      const bytes = buildReportPdf({
        brand: "SnapClaim",
        ref: rep.ref,
        dateLine: rep.date,
        quote: rep.transcript,
        headerLogo: logo,
        rows: [
          ...(rep.lengthMm != null ? [row("Crack length", `${rep.lengthMm} mm`)] : []),
          ...(rep.widthMm != null ? [row("Crack width", `${rep.widthMm} mm`, "Unverified — no width ground truth")] : []),
          row("Surface affected", `${rep.percent} %`),
          ...(rep.areaCm2 != null ? [row("Area", `${rep.areaCm2} cm2`)] : []),
          row("Severity", rep.severity),
        ],
        method: rep.mode === "absolute"
          ? "Outlines measured from photo pixels, scaled by a coin reference. Every number cites its evidence receipt in the original report."
          : "Percent-only report: no coin scale was available. Every number cites its evidence receipt in the original report.",
        checks: rep.checks,
        photos: locFig ? [photo, locFig] : [photo],
      });
      downloadFile(`snapclaim-${rep.ref}.pdf`, new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }));
      setMsg("PDF downloaded.");
    } catch (e) {
      setMsg(`PDF failed (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <section className="screen on" aria-labelledby="h-shared">
      <div className="wrap wide">
        <BackButton label="Home" onClick={home} />
        <Stepper step={6} />
        <h1 id="h-shared">Shared damage report.</h1>
        <p className="sub">Sent by the reporter - read-only, nothing here measures or edits.</p>
        <p className="stateline" role="note">UNVERIFIED sender — link carries the report with no signature. Confirm by phone before paying. {rep.sig ? "Signature present but not checked on this device." : "No signature present."}</p>

        <div className="split">
        <div className="split-main">
        <article className="doc" id="reportDoc" aria-label="Shared damage report">
          <header className="doc-head">
            <div>
              <span className="doc-brand">SnapClaim</span>
              <b>Damage report</b>
              <small className="doc-ref">Ref {rep.ref}</small>
              <small id="docMeta">Shared {rep.date}</small>
            </div>
            <Badge kind="ok">Shared</Badge>
          </header>

          <h2>1 · Observed damage</h2>
          <figure className="doc-annex">
            <img id="annexImg" alt="Shared damage photo with measured outlines" src={rep.img} />
            <figcaption>Figure 1 - the full photograph, with the measured outlines drawn from the evidence.</figcaption>
          </figure>
          {rep.locationImg && (
            <figure className="doc-annex">
              <img id="locSharedFig" alt="Shared wider view showing where the damage is" src={rep.locationImg} />
              <figcaption>Figure 2 - wider view showing where the damage is. Context only, not measured.</figcaption>
            </figure>
          )}
          {rep.transcript.trim() && <blockquote id="docQuote">“{rep.transcript.trim()}”</blockquote>}

          <h2>2 · Measurements</h2>
          <table>
            <tbody id="docRows">
              <tr><th scope="row">Surface affected</th><td>{rep.percent} %</td></tr>
              {rep.lengthMm != null && (
                <tr><th scope="row">Crack length</th><td>{rep.lengthMm} mm</td></tr>
              )}
              {rep.widthMm != null && (
                <tr><th scope="row">Crack width</th><td>{rep.widthMm} mm</td></tr>
              )}
              {rep.areaCm2 != null && (
                <tr><th scope="row">Area</th><td>{rep.areaCm2} cm²</td></tr>
              )}
              <tr><th scope="row">Severity</th><td>{rep.severity}</td></tr>
            </tbody>
          </table>

          <h2>3 · Verification</h2>
          <p className="doc-checks">{rep.checks}</p>
          <p className="doc-foot">Shared SnapClaim report · Ref {rep.ref} · the link itself carries this report - nothing was uploaded</p>
        </article>
        </div>

        <div className="split-side">
        <div className="card">
          <button id="sharedPdfBtn" className={`btn-primary${pdfBusy ? " busy" : ""}`} type="button" disabled={pdfBusy} aria-busy={pdfBusy} onClick={() => void download()}>
            {pdfBusy ? "Preparing PDF…" : "Download PDF"}
          </button>
          {msg ? <div id="sharedState" role="status" className="stateline">{msg}</div> : null}
          <button id="sharedHomeBtn" className="btn-ghostline" type="button" style={{ marginTop: 10 }} onClick={home}>
            Make your own report
          </button>
        </div>
        </div>
        </div>
      </div>
    </section>
  );
}
