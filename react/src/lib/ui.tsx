import { useState, type ReactNode } from "react";
import type { Finding, Receipt } from "./session";

/** Severity allowlist (mirrors escSeverity in pwa/app.js): attacker-shaped
 * values degrade to a junk-free default instead of a junk class. */
export function escSeverity(s: string): string {
  return s === "significant" || s === "moderate" || s === "cosmetic" ? s : "cosmetic";
}

/** Step progress: "02 / 06" tag + dashes, one component for all six steps. */
export function Stepper({ step }: { step: number }) {
  return (
    <div className="eyebrow">
      {String(step).padStart(2, "0")} / 06{" "}
      <span className="dashes" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <i key={i} className={i <= step ? "on" : undefined} />
        ))}
      </span>
    </div>
  );
}

export function Badge({ kind, children }: { kind: "ok" | "fail" | "wait"; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

/** Consistent back link for the stepped flow. Renders the app-wide navrow pattern. */
export function BackButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <div className="navrow">
      <button type="button" aria-label={`Back to ${label}`} onClick={onClick}>
        ‹ {label}
      </button>
    </div>
  );
}

export function receiptChips(receipts: Receipt[] | undefined) {
  return (receipts ?? []).slice(0, 12).map((r) => (
    <code key={r.id}>
      {r.id} · {String(r.output?.value ?? "")} {r.output?.unit ?? ""}
    </code>
  ));
}

export function MetricCards({ f }: { f: Finding }) {
  const label = String(f.label);
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  return (
    <>
      <p className="found">{cap} found</p>
      <div className="metrics">
        <div className="metric">
          <b>{String(f.percent)}%</b>
          <span>Of the wall</span>
        </div>
        <div className="metric">
          <b>{f.crackLengthMm == null ? "—" : `${String(f.crackLengthMm)} mm`}</b>
          <span>Length</span>
        </div>
        <div className="metric">
          <b>{String(f.regionCount ?? 1)}</b>
          <span>Region{(f.regionCount ?? 1) === 1 ? "" : "s"}</span>
        </div>
        {f.areaCm2 != null && (
          <div className="metric">
            <b>{String(f.areaCm2)} cm²</b>
            <span>Area</span>
          </div>
        )}
        {f.crackWidthMm != null && (
          <div className="metric">
            <b>{String(f.crackWidthMm)} mm</b>
            <span>Width</span>
          </div>
        )}
      </div>
      <div className={`sevbar sev-${escSeverity(String(f.severity))}`}>
        <span>{String(f.severity).toUpperCase()}</span>
        <small>severity band</small>
      </div>
    </>
  );
}

/** Image with a shimmer placeholder until it decodes — no empty boxes. */
export function LoadImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className={`imgph${done ? " done" : ""}${className ? ` ${className}` : ""}`} aria-hidden={alt === "" ? true : undefined}>
      <img src={src} alt={alt} loading="lazy" onLoad={() => setDone(true)} onError={() => setDone(true)} />
    </span>
  );
}

export function downloadFile(name: string, data: string | Blob, type = "application/json"): void {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
