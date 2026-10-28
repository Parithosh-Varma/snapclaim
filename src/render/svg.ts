import { MeasurementError } from "../engine/math.ts";
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
  /** Photo panel with mask outlines; `path` values are in source-pixel coordinates. */
  overlay?: AnnexureOverlay;
}

export interface AnnexureOverlay {
  width: number;
  height: number;
  photoHref?: string;
  masks: { id: string; label: string; path: string }[];
}

const OVERLAY_MAX_WIDTH = 752;
const OVERLAY_MAX_HEIGHT = 420;
const OVERLAY_TOP = 88;
const OVERLAY_COLORS = new Map<string, string>([
  ["crack", "#c0392b"],
  ["stain", "#f39c12"],
  ["peel", "#2980b9"],
  ["dent", "#8e44ad"],
]);

/** Round to 2 decimals for layout numbers. */
function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Only inline images and https URLs may be embedded as the photo. */
function safeHref(href: string | undefined): string | null {
  if (href === undefined) return null;
  return href.startsWith("data:image/") || href.startsWith("https://") ? href : null;
}

/** Render the photo panel; returns the svg fragment and the vertical space it takes. */
function renderOverlay(overlay: AnnexureOverlay): { svg: string; shift: number } {
  if (!(overlay.width > 0) || !(overlay.height > 0) || !Number.isFinite(overlay.width) || !Number.isFinite(overlay.height)) {
    throw new MeasurementError("overlay width and height must be positive numbers");
  }
  const scale = Math.min(OVERLAY_MAX_WIDTH / overlay.width, OVERLAY_MAX_HEIGHT / overlay.height);
  const w = r2(overlay.width * scale);
  const h = r2(overlay.height * scale);
  const href = safeHref(overlay.photoHref);
  const masks = overlay.masks
    .map((m) => {
      const color = OVERLAY_COLORS.get(m.label) ?? "#7f8c8d";
      return (
        `<g transform="translate(24 ${OVERLAY_TOP}) scale(${scale})" data-mask="${esc(m.id)}">` +
        `<title>${esc(m.label)}</title>` +
        `<path d="${esc(m.path)}" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke" fill-rule="evenodd"/>` +
        `</g>`
      );
    })
    .join("");
  const svg =
    `<rect x="24" y="${OVERLAY_TOP}" width="${w}" height="${h}" fill="#eeeeee"/>` +
    (href === null ? "" : `<image x="24" y="${OVERLAY_TOP}" width="${w}" height="${h}" href="${esc(href)}" preserveAspectRatio="none"/>`) +
    masks;
  return { svg, shift: r2(h + 16) };
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

  const overlay = input.overlay === undefined ? null : renderOverlay(input.overlay);
  const shift = overlay === null ? 0 : overlay.shift;

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

  const height = receiptStartY + 22 + receipts.length * 22 + 72 + shift;
  const wrapOpen = shift === 0 ? "" : `<g transform="translate(0 ${shift})">`;
  const wrapClose = shift === 0 ? "" : "</g>";
  const modeLabel = input.mode === "absolute" ? "ABSOLUTE (calibrated)" : "PERCENT-ONLY (no scale)";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}" role="img">` +
    `<rect x="0" y="0" width="800" height="${height}" fill="#ffffff"/>` +
    `<text x="24" y="36" font-size="20" font-family="sans-serif" font-weight="bold">SnapClaim annexure v${esc(version)}</text>` +
    `<text x="24" y="58" font-size="12" font-family="monospace">mode: ${esc(modeLabel)} · generated: ${esc(generatedAt)}</text>` +
    (transcript === ""
      ? ""
      : `<text x="24" y="78" font-size="12" font-family="monospace">transcript: ${esc(transcript.slice(0, 120))}</text>`) +
    (overlay === null ? "" : overlay.svg) +
    wrapOpen +
    `<text x="24" y="104" font-size="14" font-family="sans-serif" font-weight="bold">Findings (${findings.length})</text>` +
    `<text x="24" y="122" font-size="11" font-family="monospace" fill="#555">${
      overlay === null
        ? "bars are proportional schematics from receipts, not photo overlays"
        : "outlines traced from segmentation masks; bars are proportional schematics from receipts"
    }</text>` +
    findingRows +
    `<text x="24" y="${receiptStartY}" font-size="14" font-family="sans-serif" font-weight="bold">Receipts (${receipts.length})</text>` +
    receiptRows +
    wrapClose +
    `<text x="24" y="${height - 34}" font-size="11" font-family="monospace" fill="#555">Computed, not generated. Replay from request + receipts.</text>` +
    `<text x="24" y="${height - 16}" font-size="11" font-family="monospace" fill="#555">Every number must cite a receipt id or the gate fails.</text>` +
    `</svg>`
  );
}
