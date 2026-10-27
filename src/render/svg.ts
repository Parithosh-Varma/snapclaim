import type { MeasuredFinding } from "../engine/types.ts";
import type { Receipt } from "../receipts/types.ts";
import type { FindingDraft } from "../findings/evidence-gate.ts";

export interface AnnexureInput {
  findings: MeasuredFinding[];
  receipts: Receipt[];
  mode: "absolute" | "percent-only";
  statements?: FindingDraft[];
  transcript?: string;
  version?: string;
  generatedAt?: string;
}

function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function severityColor(severity: string): string {
  if (severity === "significant") return "#c0392b";
  if (severity === "moderate") return "#e67e22";
  return "#27ae60";
}

export function renderAnnexureSvg(input: AnnexureInput): string {
  const version = input.version ?? "0.2.0";
  const generatedAt = input.generatedAt ?? "unspecified";
  const transcript = input.transcript ?? "";
  const findings = input.findings;
  const receipts = input.receipts;

  const findingRows = findings
    .map((f, i) => {
      const y = 150 + i * 38;
      const mm = f.crackLengthMm === null ? "percent-only" : `${f.crackLengthMm} mm`;
      const statement = input.statements?.[i]?.statement ?? "";
      return (
        `<rect x="24" y="${y}" width="14" height="14" fill="${severityColor(f.severity)}"/>` +
        `<text x="46" y="${y + 12}" font-size="13" font-family="monospace">${esc(f.label)} ${esc(f.percent)}% · ${esc(mm)} · ${esc(f.severity)}</text>` +
        (statement === ""
          ? ""
          : `<text x="46" y="${y + 27}" font-size="11" font-family="monospace" fill="#555">${esc(statement.slice(0, 110))}</text>`)
      );
    })
    .join("");

  const receiptStartY = 150 + findings.length * 38 + 24;
  const receiptRows = receipts
    .map((r, i) => {
      const y = receiptStartY + 22 + i * 22;
      const value = typeof r.output.value === "number" ? String(r.output.value) : r.output.value;
      return `<text x="24" y="${y}" font-size="11" font-family="monospace">${esc(r.id)} ${esc(r.method)} ${esc(value)} ${esc(r.output.unit)} — ${esc(r.formula)}</text>`;
    })
    .join("");

  const height = receiptStartY + 22 + receipts.length * 22 + 72;
  const modeLabel = input.mode === "absolute" ? "ABSOLUTE (calibrated)" : "PERCENT-ONLY (no scale)";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}" role="img">` +
    `<rect x="0" y="0" width="800" height="${height}" fill="#ffffff"/>` +
    `<text x="24" y="36" font-size="20" font-family="sans-serif" font-weight="bold">SnapClaim annexure v${esc(version)}</text>` +
    `<text x="24" y="58" font-size="12" font-family="monospace">mode: ${esc(modeLabel)} · generated: ${esc(generatedAt)}</text>` +
    (transcript === ""
      ? ""
      : `<text x="24" y="78" font-size="12" font-family="monospace">transcript: ${esc(transcript.slice(0, 120))}</text>`) +
    `<text x="24" y="104" font-size="14" font-family="sans-serif" font-weight="bold">Findings (${findings.length})</text>` +
    `<text x="24" y="122" font-size="11" font-family="monospace" fill="#555">bars are proportional schematics from receipts, not photo overlays</text>` +
    findingRows +
    `<text x="24" y="${receiptStartY}" font-size="14" font-family="sans-serif" font-weight="bold">Receipts (${receipts.length})</text>` +
    receiptRows +
    `<text x="24" y="${height - 34}" font-size="11" font-family="monospace" fill="#555">Computed, not generated. Replay from request + receipts.</text>` +
    `<text x="24" y="${height - 16}" font-size="11" font-family="monospace" fill="#555">Every number must cite a receipt id or the gate fails.</text>` +
    `</svg>`
  );
}
