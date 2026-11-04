/**
 * Measured damage report PDF (A4 portrait, 2 pages): native selectable text,
 * brand header band, stat cards, side-by-side figures, native annexure tables.
 *
 * No dependencies: JPEGs pass through as DCTDecode. Text is WinAnsi-encoded
 * so en dashes, middots, ² and × survive (unlike the old ASCII sanitiser).
 * Flow layout with a y-cursor guarantees figures can never overlap body copy.
 */

export interface PdfPhoto {
  /** Raw JPEG bytes (DCTDecode passthrough, no re-encode). */
  jpeg: Uint8Array;
  width: number;
  height: number;
  caption: string;
  alt?: string;
}

export interface PdfFinding {
  label: string;
  percent: number;
  lengthMm: number | null;
  widthMm: number | null;
  areaCm2: number | null;
  severity: string;
  receiptIds: {
    ratio?: string | null;
    length?: string | null;
    area?: string | null;
    width?: string | null;
    severity?: string | null;
  };
  widthStatus?: "confirmed" | "unverified";
  widthNote?: string;
  statement?: string;
}

export interface PdfReceipt {
  id: string;
  measure: string;
  value: string;
  formula: string;
  unverified?: boolean;
}

export interface PdfChecks {
  gate: "passed" | "pending" | "failed";
  skeptic: "passed" | "failed" | "not-run" | "checking";
  xcheck: "passed" | "failed" | "not-run" | "checking";
}

export interface PdfReport {
  brand: string;
  ref: string;
  /** e.g. "4 Nov 2026 · 1 finding" (right side of the header, under the ref). */
  dateLine: string;
  quote: string;
  findings?: PdfFinding[];
  receipts?: PdfReceipt[];
  /** Annexure meta. Defaults: v0.3.0, absolute, generatedUtc. */
  version?: string;
  mode?: "absolute" | "percent-only";
  generatedUtc?: string;
  coinLabel?: string;
  coinMm?: number;
  checks: PdfChecks | string;
  photos: PdfPhoto[];
  headerLogo?: PdfPhoto;
  /** Legacy flat rows (converted to a single finding when findings absent). */
  rows?: { item: string; value: string; evidence: string; status: string }[];
  method?: string;
}

/* ------------------------------------------------------------------ */
/* Page geometry + palette                                             */
/* ------------------------------------------------------------------ */

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 57; // ~20mm side margins
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 68;
const HEADER_GREEN_H = 4;
const FOOTER_RULE_Y = 44;
const FOOTER_TEXT_Y = 32;
const CONTENT_BOTTOM = 60;
const CONTENT_TOP1 = PAGE_H - HEADER_H - HEADER_GREEN_H - 20;
const CONTENT_TOPN = PAGE_H - HEADER_H - HEADER_GREEN_H - 18;

type RGB = [number, number, number];
const NAVY: RGB = [0.043, 0.122, 0.267];
const GREEN: RGB = [0.055, 0.478, 0.212];
const DARK: RGB = [0.09, 0.14, 0.25];
const GREY: RGB = [0.42, 0.447, 0.502];
const FOOTER_GREY: RGB = [0.294, 0.333, 0.388];
const LIGHT_LINE: RGB = [0.886, 0.867, 0.816];
const WARM_BG: RGB = [0.969, 0.953, 0.925];
const ZEBRA_BG: RGB = [0.98, 0.965, 0.937];
const CARD_BORDER: RGB = [0.906, 0.878, 0.824];
const SEV_CARD_BG: RGB = [1, 0.969, 0.902];
const SEV_PILL: RGB = [0.573, 0.251, 0.055];
const AMBER_BORDER: RGB = [0.753, 0.478, 0.102];
const AMBER_TEXT: RGB = [0.573, 0.282, 0.055];
const CHIP_GREEN_BG: RGB = [0.902, 0.957, 0.918];
const CHIP_AMBER_BG: RGB = [0.992, 0.941, 0.835];
const RED: RGB = [0.753, 0.227, 0.169];
const WHITE: RGB = [1, 1, 1];
const BLACK: RGB = [0, 0, 0];
const HEADER_LIGHT: RGB = [0.82, 0.86, 0.93];

const fmt3 = (n: number): string => String(Math.round(n * 1000) / 1000);
const rg = (c: RGB): string => `${fmt3(c[0])} ${fmt3(c[1])} ${fmt3(c[2])} rg`;
const RG = (c: RGB): string => `${fmt3(c[0])} ${fmt3(c[1])} ${fmt3(c[2])} RG`;

/* ------------------------------------------------------------------ */
/* WinAnsi encoding (keeps –, ·, ², ×, quotes)                         */
/* ------------------------------------------------------------------ */

const WINANSI: Record<string, number> = {
  "“": 0x93, "”": 0x94, "‘": 0x91, "’": 0x92, "‚": 0x82, "„": 0x84,
  "…": 0x85, "•": 0x95, "–": 0x96, "—": 0x97, "·": 0xb7,
  "²": 0xb2, "³": 0xb3, "°": 0xb0, "±": 0xb1, "×": 0xd7, "÷": 0xf7,
  "€": 0x80, "£": 0xa3,
};
const ASCII_FALLBACK: Record<string, string> = {
  "✓": "v", "→": "->", "←": "<-", "↑": "^", "↓": "v", "―": "-",
  "₹": "Rs. ", " ": " ",
};

function escPdf(s: string): string {
  let out = "";
  for (const ch of String(s)) {
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (ch >= " " && ch <= "~") out += ch;
    else if (ch === "\n" || ch === "\t" || ch === "\r") out += " ";
    else if (WINANSI[ch] !== undefined) out += `\\${(WINANSI[ch] as number).toString(8).padStart(3, "0")}`;
    else if (ASCII_FALLBACK[ch] !== undefined) out += ASCII_FALLBACK[ch];
    else {
      const code = ch.charCodeAt(0);
      if (code >= 0xa0 && code <= 0xff) out += `\\${code.toString(8).padStart(3, "0")}`;
      // else: drop (no tofu boxes in Helvetica)
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Formatting (consistent decimals, no space before %)                  */
/* ------------------------------------------------------------------ */

export function fmtLength(mm: number | null): string {
  if (mm === null || !Number.isFinite(mm)) return "–";
  return `${mm.toFixed(1)} mm`;
}
export function fmtArea(cm2: number | null): string {
  if (cm2 === null || !Number.isFinite(cm2)) return "–";
  return `${cm2.toFixed(2)} cm²`;
}
export function fmtPercent(p: number): string {
  return `${p.toFixed(2)}%`;
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function capSev(s: string): string {
  const l = s.toLowerCase();
  if (l === "significant") return "Significant";
  if (l === "moderate") return "Moderate";
  return "Cosmetic";
}

/* ------------------------------------------------------------------ */
/* Writer                                                                */
/* ------------------------------------------------------------------ */

class Writer {
  parts: (string | Uint8Array)[] = [];
  offsets: number[] = [];
  length = 0;
  str(s: string): void {
    const b = new TextEncoder().encode(s);
    this.parts.push(s);
    this.length += b.length;
  }
  raw(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      const b = typeof p === "string" ? new TextEncoder().encode(p) : p;
      out.set(b, at);
      at += b.length;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Layout builder                                                        */
/* ------------------------------------------------------------------ */

interface PageState {
  stream: string[];
  y: number;
}

function wrapWords(text: string, maxChars: number): string[] {
  const words = String(text).split(/\s+/).filter((w) => w.length > 0);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (w.length > maxChars && !line) {
      // hard-break a single over-long token (e.g. a formula id)
      for (let i = 0; i < w.length; i += maxChars) lines.push(w.slice(i, i + maxChars));
      continue;
    }
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function estWidth(text: string, size: number, mono = false, bold = false): number {
  return text.length * size * (mono ? 0.6 : bold ? 0.53 : 0.5);
}

function rrPath(x: number, y: number, w: number, h: number, r: number): string {
  const k = 0.5523 * r;
  const f = (n: number): string => n.toFixed(1);
  return (
    `${f(x + r)} ${f(y)} m ` +
    `${f(x + w - r)} ${f(y)} l ` +
    `${f(x + w - r + k)} ${f(y)} ${f(x + w)} ${f(y + r - k)} ${f(x + w)} ${f(y + r)} c ` +
    `${f(x + w)} ${f(y + h - r)} l ` +
    `${f(x + w)} ${f(y + h - r + k)} ${f(x + w - r + k)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} c ` +
    `${f(x + r)} ${f(y + h)} l ` +
    `${f(x + r - k)} ${f(y + h)} ${f(x)} ${f(y + h - r + k)} ${f(x)} ${f(y + h - r)} c ` +
    `${f(x)} ${f(y + r)} l ` +
    `${f(x)} ${f(y + r - k)} ${f(x + r - k)} ${f(y)} ${f(x + r)} ${f(y)} c h`
  );
}

class Builder {
  pages: PageState[] = [{ stream: [], y: CONTENT_TOP1 }];
  cur(): PageState {
    return this.pages[this.pages.length - 1]!;
  }
  ensure(h: number): PageState {
    if (this.cur().y - h < CONTENT_BOTTOM) {
      this.pages.push({ stream: [], y: CONTENT_TOPN });
      this.drawShortHeader();
    }
    return this.cur();
  }
  forcePage(): PageState {
    this.pages.push({ stream: [], y: CONTENT_TOPN });
    this.drawShortHeader();
    return this.cur();
  }
  emit(s: string): void {
    this.cur().stream.push(s);
  }
  text(x: number, yBase: number, font: string, size: number, color: RGB, t: string): void {
    const c = color === BLACK ? "" : `${rg(color)}\n`;
    const reset = color === BLACK ? "" : "\n0 0 0 rg";
    this.emit(`${c}BT /${font} ${size} Tf ${fmt3(size * 1.2)} TL ${x.toFixed(1)} ${yBase.toFixed(1)} Td (${escPdf(t)}) Tj ET${reset}`);
  }
  textRight(xRight: number, yBase: number, font: string, size: number, color: RGB, t: string, mono = false, bold = false): void {
    const x = xRight - estWidth(t, size, mono, bold);
    this.text(x, yBase, font, size, color, t);
  }
  para(x: number, yTop: number, width: number, font: string, size: number, color: RGB, t: string, leading?: number): number {
    const ld = leading ?? size * 1.35;
    const maxChars = Math.max(8, Math.floor(width / (size * (font === "F4" ? 0.6 : 0.5))));
    const lines = wrapWords(t, maxChars);
    let y = yTop;
    for (const ln of lines) {
      y -= ld;
      this.text(x, y, font, size, color, ln);
    }
    return y;
  }
  paraHeight(width: number, size: number, t: string, leading?: number, mono = false): number {
    const ld = leading ?? size * 1.35;
    const maxChars = Math.max(8, Math.floor(width / (size * (mono ? 0.6 : 0.5))));
    return wrapWords(t, maxChars).length * ld;
  }
  rect(x: number, y: number, w: number, h: number, fill: RGB | null, stroke: RGB | null, lw = 0.7): void {
    let s = "";
    if (fill) s += `${rg(fill)}\n`;
    if (stroke) s += `${RG(stroke)}\n${fmt3(lw)} w\n`;
    s += `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re `;
    s += fill && stroke ? "B" : fill ? "f" : "S";
    if (fill) s += "\n0 0 0 rg";
    if (stroke) s += "\n0 0 0 RG";
    this.emit(s);
  }
  rrect(x: number, y: number, w: number, h: number, r: number, fill: RGB | null, stroke: RGB | null, lw = 0.7): void {
    let s = "";
    if (fill) s += `${rg(fill)}\n`;
    if (stroke) s += `${RG(stroke)}\n${fmt3(lw)} w\n`;
    s += `${rrPath(x, y, w, h, r)} `;
    s += fill && stroke ? "B" : fill ? "f" : "S";
    if (fill) s += "\n0 0 0 rg";
    if (stroke) s += "\n0 0 0 RG";
    this.emit(s);
  }
  line(x1: number, y1: number, x2: number, y2: number, color: RGB, lw = 0.5): void {
    this.emit(`${RG(color)}\n${fmt3(lw)} w\n${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S\n0 0 0 RG`);
  }
  circle(x: number, y: number, r: number, fill: RGB): void {
    const k = 0.5523 * r;
    const f = (n: number): string => n.toFixed(1);
    this.emit(
      `${rg(fill)}\n${f(x - r)} ${f(y)} m ` +
        `${f(x - r)} ${f(y + k)} ${f(x - k)} ${f(y + r)} ${f(x)} ${f(y + r)} c ` +
        `${f(x + k)} ${f(y + r)} ${f(x + r)} ${f(y + k)} ${f(x + r)} ${f(y)} c ` +
        `${f(x + r)} ${f(y - k)} ${f(x + k)} ${f(y - r)} ${f(x)} ${f(y - r)} c ` +
        `${f(x - k)} ${f(y - r)} ${f(x - r)} ${f(y - k)} ${f(x - r)} ${f(y)} c h f\n0 0 0 rg`,
    );
  }
  image(x: number, y: number, w: number, h: number, name: string): void {
    this.emit(`q ${w.toFixed(1)} 0 0 ${h.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)} cm /${name} Do Q`);
  }
  clippedImage(x: number, y: number, w: number, h: number, r: number, name: string, border: RGB): void {
    this.emit(`q ${rrPath(x, y, w, h, r)} W n ${w.toFixed(1)} 0 0 ${h.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)} cm /${name} Do Q`);
    let s = `${RG(border)}\n0.7 w\n${rrPath(x, y, w, h, r)} S\n0 0 0 RG`;
    this.emit(s);
  }

  shortRef = "";
  shortLogo: string | null = null;
  shortBrand = "SnapClaim";
  setShortHeader(ref: string, logoName: string | null, brand: string): void {
    this.shortRef = ref;
    this.shortLogo = logoName;
    this.shortBrand = brand;
  }
  drawShortHeader(): void {
    const top = PAGE_H - HEADER_H - HEADER_GREEN_H;
    this.emit(`q ${rg(NAVY)} 0 ${top} ${PAGE_W} ${HEADER_H + HEADER_GREEN_H} re f Q`);
    this.emit(`q ${rg(GREEN)} 0 ${top} ${PAGE_W} ${HEADER_GREEN_H} re f Q`);
    const cy = top + HEADER_GREEN_H + (HEADER_H - 40) / 2;
    if (this.shortLogo) {
      this.emit(`q 40 0 0 40 ${MARGIN} ${cy.toFixed(1)} cm /${this.shortLogo} Do Q`);
    }
    this.text(this.shortLogo ? MARGIN + 48 : MARGIN, cy + 12, "F2", 15, WHITE, this.shortBrand);
    const xr = PAGE_W - MARGIN;
    this.textRight(xr, top + HEADER_GREEN_H + 36, "F2", 13, WHITE, "Measured damage report", false, true);
    this.textRight(xr, top + HEADER_GREEN_H + 20, "F1", 9, HEADER_LIGHT, `Ref ${this.shortRef}`);
  }
}

/* ------------------------------------------------------------------ */
/* Normalise legacy inputs                                             */
/* ------------------------------------------------------------------ */

function parseChecks(c: PdfChecks | string): PdfChecks {
  if (typeof c !== "string") return c;
  const s = c.toLowerCase();
  const gate = s.includes("gate: passed") || s.includes("gate pass") ? "passed" : s.includes("gate") && s.includes("fail") ? "failed" : "pending";
  const sk = (key: string): PdfChecks["skeptic"] => {
    const i = s.indexOf(key);
    const seg = i >= 0 ? s.slice(i, i + 60) : "";
    if (seg.includes("passed") || seg.includes("verified") || seg.includes("agreed")) return "passed";
    if (seg.includes("fail") || seg.includes("retry") || seg.includes("disput")) return "failed";
    if (seg.includes("check")) return "checking";
    return "not-run";
  };
  return {
    gate: gate as PdfChecks["gate"],
    skeptic: sk("skeptic"),
    xcheck: sk("cross-check") === "not-run" ? sk("xcheck") : sk("cross-check"),
  };
}

function legacyFinding(rows: { item: string; value: string; evidence: string; status: string }[]): PdfFinding {
  const get = (re: RegExp): { v: string; e: string; s: string } | null => {
    const r = rows.find((x) => re.test(x.item.toLowerCase()));
    return r ? { v: r.value, e: r.evidence, s: r.status } : null;
  };
  const num = (v: string | undefined): number | null => {
    if (!v) return null;
    const m = v.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  };
  const L = get(/length/);
  const W = get(/width/);
  const A = get(/area/);
  const P = get(/surface|percent|affected/);
  const S = get(/severity/);
  const conf = (s: string | undefined): boolean => /confirm|pass|verif|ok/i.test(s ?? "");
  return {
    label: "crack",
    percent: num(P?.v) ?? 0,
    lengthMm: num(L?.v),
    widthMm: num(W?.v),
    areaCm2: num(A?.v),
    severity: (S?.v ?? "moderate").toLowerCase(),
    receiptIds: {
      ratio: P?.e && P.e !== "-" ? P.e : null,
      length: L?.e && L.e !== "-" ? L.e : null,
      area: A?.e && A.e !== "-" ? A.e : null,
      width: W?.e && W.e !== "-" ? W.e : null,
      severity: S?.e && S.e !== "-" ? S.e : null,
    },
    widthStatus: W ? (conf(W.s) ? "confirmed" : "unverified") : "unverified",
    widthNote: "No reference to verify width against",
  };
}

/* ------------------------------------------------------------------ */
/* Small widgets                                                       */
/* ------------------------------------------------------------------ */

function drawStatusChip(b: Builder, x: number, y: number, w: number, status: "confirmed" | "unverified"): void {
  const h = 16;
  const bg = status === "confirmed" ? CHIP_GREEN_BG : CHIP_AMBER_BG;
  const fg = status === "confirmed" ? GREEN : AMBER_TEXT;
  b.rrect(x, y, w, h, 8, bg, null);
  const label = status === "confirmed" ? "Confirmed" : "Unverified";
  if (status === "confirmed") {
    b.circle(x + 9, y + 8, 5.5, GREEN);
    b.emit(`${rg(WHITE)}\n1.4 w\n${(x + 6.4).toFixed(1)} ${(y + 7.6).toFixed(1)} m ${(x + 8.2).toFixed(1)} ${(y + 5.6).toFixed(1)} l ${(x + 11.8).toFixed(1)} ${(y + 10.2).toFixed(1)} l S\n0 0 0 RG\n0 0 0 rg`);
  } else {
    const cx = x + 9;
    const cy = y + 8;
    b.emit(
      `${rg(AMBER_TEXT)}\n${cx.toFixed(1)} ${(cy + 5).toFixed(1)} m ${(cx - 5).toFixed(1)} ${(cy - 4).toFixed(1)} l ${(cx + 5).toFixed(1)} ${(cy - 4).toFixed(1)} l h f\n0 0 0 rg`,
    );
    b.emit(`${rg(WHITE)}\n1.2 w\n${cx.toFixed(1)} ${(cy + 2.2).toFixed(1)} m ${cx.toFixed(1)} ${(cy - 0.6).toFixed(1)} l S\n${rg(WHITE)}\n${cx.toFixed(1)} ${(cy - 2.4).toFixed(1)} m ${(cx + 0.1).toFixed(1)} ${(cy - 2.4).toFixed(1)} l S\n0 0 0 RG\n0 0 0 rg`);
  }
  b.text(x + 17, y + 5, "F2", 8, fg, label);
}

function drawCheckIcon(b: Builder, x: number, y: number, kind: "pass" | "idle"): void {
  if (kind === "pass") {
    b.circle(x, y, 8, GREEN);
    b.emit(`${rg(WHITE)}\n1.6 w\n${(x - 3.6).toFixed(1)} ${(y - 0.4).toFixed(1)} m ${(x - 1).toFixed(1)} ${(y - 3).toFixed(1)} l ${(x + 4).toFixed(1)} ${(y + 3.4).toFixed(1)} l S\n0 0 0 RG\n0 0 0 rg`);
  } else {
    b.circle(x, y, 8, GREY);
    b.emit(`${rg(WHITE)}\n1.6 w\n${(x - 3.4).toFixed(1)} ${y.toFixed(1)} m ${(x + 3.4).toFixed(1)} ${y.toFixed(1)} l S\n0 0 0 RG\n0 0 0 rg`);
  }
}

/* ------------------------------------------------------------------ */
/* Main builder                                                        */
/* ------------------------------------------------------------------ */

export function buildReportPdf(r: PdfReport): Uint8Array {
  const checks = parseChecks(r.checks);
  const findings: PdfFinding[] =
    r.findings && r.findings.length > 0 ? r.findings : [legacyFinding(r.rows ?? [])];
  const primary = findings[0]!;
  const version = r.version ?? "0.3.0";
  const mode = r.mode ?? "absolute";
  const modeLabel = mode === "absolute" ? "ABSOLUTE (calibrated)" : "PERCENT-ONLY (no scale)";
  const generatedUtc = r.generatedUtc ?? "unspecified";
  const countLine = `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
  const dateLine = r.dateLine.includes("·") ? r.dateLine : `${r.dateLine} · ${countLine}`;

  // Receipts: caller list, else derived honestly from legacy rows (no
  // invented values: only ids and values the caller actually cited).
  let receipts: PdfReceipt[] = r.receipts ?? [];
  if (!receipts.length && r.rows && r.rows.length > 0) {
    receipts = r.rows
      .filter((row) => row.evidence && row.evidence !== "-")
      .map((row) => ({ id: row.evidence, measure: row.item, value: row.value, formula: "cited in original report" }));
  }

  const b = new Builder();

  // image names (assigned up-front so streams can reference them)
  const imgNames: string[] = r.photos.map((_, i) => `Im${i}`);
  const logoName = r.headerLogo ? "Logo" : null;
  b.setShortHeader(r.ref, logoName, r.brand || "SnapClaim");

  /* ---------------- Page 1 ---------------- */
  // header band on page 1 (drawn into pages[0])
  {
    const top = PAGE_H - HEADER_H - HEADER_GREEN_H;
    b.pages[0]!.stream.push(`q ${rg(NAVY)} 0 ${top} ${PAGE_W} ${HEADER_H + HEADER_GREEN_H} re f Q`);
    b.pages[0]!.stream.push(`q ${rg(GREEN)} 0 ${top} ${PAGE_W} ${HEADER_GREEN_H} re f Q`);
  }
  // header content (need builder emit to target page 0 explicitly)
  {
    const top = PAGE_H - HEADER_H - HEADER_GREEN_H;
    const cy = top + HEADER_GREEN_H + (HEADER_H - 40) / 2;
    const push0 = (s: string): void => {
      b.pages[0]!.stream.push(s);
    };
    const t0 = (x: number, yBase: number, font: string, size: number, color: RGB, t: string): void => {
      const c = color === BLACK ? "" : `${rg(color)}\n`;
      const reset = color === BLACK ? "" : "\n0 0 0 rg";
      push0(`${c}BT /${font} ${size} Tf ${fmt3(size * 1.2)} TL ${x.toFixed(1)} ${yBase.toFixed(1)} Td (${escPdf(t)}) Tj ET${reset}`);
    };
    const t0r = (xRight: number, yBase: number, font: string, size: number, color: RGB, t: string, bold = false): void => {
      t0(xRight - estWidth(t, size, false, bold), yBase, font, size, color, t);
    };
    if (logoName) push0(`q 40 0 0 40 ${MARGIN} ${cy.toFixed(1)} cm /${logoName} Do Q`);
    t0(logoName ? MARGIN + 48 : MARGIN, cy + 12, "F2", 15, WHITE, r.brand || "SnapClaim");
    const xr = PAGE_W - MARGIN;
    t0r(xr, top + HEADER_GREEN_H + 44, "F2", 13, WHITE, "Measured damage report", true);
    t0r(xr, top + HEADER_GREEN_H + 30, "F1", 9, HEADER_LIGHT, `Ref ${r.ref}`);
    t0r(xr, top + HEADER_GREEN_H + 17, "F1", 9, HEADER_LIGHT, dateLine);
  }

  let y = b.cur().y;
  const gap = (h: number): void => {
    y -= h;
    b.cur().y = y;
  };
  const ensure = (h: number): void => {
    if (y - h < CONTENT_BOTTOM) {
      b.forcePage();
      y = b.cur().y;
    }
  };

  // Claimant's description
  ensure(70);
  b.text(MARGIN, y - 12, "F2", 9, GREY, "CLAIMANT'S DESCRIPTION");
  y -= 20;
  b.cur().y = y;
  const quote = `“${r.quote.trim()}”`;
  const qIndent = MARGIN + 12;
  const qWidth = CONTENT_W - 12;
  const qH = b.paraHeight(qWidth, 14, quote, 19);
  ensure(qH + 26);
  const qTop = y;
  b.para(qIndent, y, qWidth, "F3", 14, DARK, quote, 19);
  y -= qH;
  b.cur().y = y;
  // green left rule
  b.line(MARGIN + 2, qTop - 2, MARGIN + 2, y - 2, GREEN, 3);
  b.text(qIndent, y - 14, "F1", 9, GREY, "Claimant's own words, recorded as entered");
  y -= 24;
  b.cur().y = y;

  // Stat cards (5 across, severity as 5th card)
  const nCards = 5;
  const cardGap = 8;
  const cardW = (CONTENT_W - cardGap * (nCards - 1)) / nCards;
  const cardH = 112;
  ensure(cardH + 8);
  y = b.cur().y;
  gap(4);
  y = b.cur().y;
  const cardY = y - cardH;
  const widthUnverified = (primary.widthStatus ?? "unverified") === "unverified" && primary.widthMm !== null;
  const cards: { label: string; value: string; unit: string; status: "confirmed" | "unverified" | null; receipt: string; sev?: boolean }[] = [
    { label: "LENGTH", value: primary.lengthMm !== null ? primary.lengthMm.toFixed(1) : "–", unit: "mm", status: primary.receiptIds.length ? "confirmed" : null, receipt: primary.receiptIds.length ?? "" },
    { label: "WIDTH", value: primary.widthMm !== null ? primary.widthMm.toFixed(1) : "–", unit: "mm", status: primary.widthMm !== null ? (widthUnverified ? "unverified" : "confirmed") : null, receipt: primary.receiptIds.width ?? "" },
    { label: "AREA", value: primary.areaCm2 !== null ? primary.areaCm2.toFixed(2) : "–", unit: "cm²", status: primary.receiptIds.area ? "confirmed" : null, receipt: primary.receiptIds.area ?? "" },
    { label: "SURFACE AFFECTED", value: primary.percent.toFixed(2) + "%", unit: "of component", status: primary.receiptIds.ratio ? "confirmed" : null, receipt: primary.receiptIds.ratio ?? "" },
    { label: "SEVERITY", value: "", unit: "", status: primary.receiptIds.severity ? "confirmed" : null, receipt: primary.receiptIds.severity ?? "", sev: true },
  ];
  cards.forEach((c, i) => {
    const x = MARGIN + i * (cardW + cardGap);
    const isWidth = i === 1;
    const bg = c.sev ? SEV_CARD_BG : WHITE;
    const border = isWidth && widthUnverified ? AMBER_BORDER : CARD_BORDER;
    b.rrect(x, cardY, cardW, cardH, 8, bg, border, isWidth && widthUnverified ? 1.4 : 0.7);
    const px = x + 10;
    // label (may wrap to 2 lines)
    const labelLines = wrapWords(c.label, Math.floor((cardW - 20) / 4.2));
    let ly = cardY + cardH - 18;
    for (const ln of labelLines.slice(0, 2)) {
      b.text(px, ly, "F2", 8, c.sev ? AMBER_TEXT : GREY, ln);
      ly -= 11;
    }
    if (c.sev) {
      // severity pill
      const pillW = cardW - 20;
      b.rrect(px, cardY + 62, pillW, 20, 10, SEV_PILL, null);
      const sevTxt = primary.severity.toUpperCase();
      b.text(px + (pillW - estWidth(sevTxt, 8.5, false, true)) / 2, cardY + 68, "F2", 8.5, WHITE, sevTxt);
      b.text(px, cardY + 48, "F1", 8, AMBER_TEXT, "area · length · regions");
      if (c.status) drawStatusChip(b, px, cardY + 28, Math.min(72, cardW - 20), c.status);
      if (c.receipt) b.text(px, cardY + 13, "F1", 8, AMBER_TEXT, c.receipt);
    } else {
      const isSurface = i === 3;
      const vSize = isSurface ? 19 : 21;
      b.text(px, cardY + 72, "F2", vSize, NAVY, c.value);
      b.text(px, cardY + 58, "F1", 9, GREY, c.unit);
      if (c.status) drawStatusChip(b, px, cardY + 30, Math.min(72, cardW - 20), c.status);
      if (c.receipt) b.text(px, cardY + 14, "F1", 8, GREY, c.receipt);
    }
  });
  y = cardY;
  b.cur().y = y;
  gap(8);

  // Width caveat (never hidden)
  if (widthUnverified && primary.widthMm !== null) {
    ensure(20);
    y = b.cur().y;
    const wx = MARGIN + 18;
    // amber warning triangle
    b.emit(`${rg(AMBER_TEXT)}\n${(MARGIN + 9).toFixed(1)} ${(y - 4).toFixed(1)} m ${(MARGIN + 1).toFixed(1)} ${(y - 16).toFixed(1)} l ${(MARGIN + 17).toFixed(1)} ${(y - 16).toFixed(1)} l h f\n0 0 0 rg`);
    b.text(MARGIN + 6.4, y - 14, "F2", 10, WHITE, "!");
    const lead = "Width is unverified:";
    b.text(wx, y - 12, "F2", 9.5, AMBER_TEXT, lead);
    const rest = ` no reference width to check it against, so read ${fmtLength(primary.widthMm)} as indicative.`;
    b.text(wx + estWidth(lead, 9.5, false, true), y - 12, "F1", 9.5, GREY, rest);
    gap(20);
    y = b.cur().y;
  }

  // Photo evidence
  ensure(60);
  y = b.cur().y;
  b.text(MARGIN, y - 12, "F2", 12, GREEN, "Photo evidence");
  y -= 22;
  b.cur().y = y;
  const photos = r.photos.slice(0, 2);
  if (photos.length === 2) {
    const figGap = 12;
    const figW = (CONTENT_W - figGap) / 2;
    const maxH = 140;
    const hs = photos.map((p) => {
      const s = Math.min(figW / p.width, maxH / p.height);
      return { w: p.width * s, h: p.height * s };
    });
    const rowH = Math.max(hs[0]!.h, hs[1]!.h);
    ensure(rowH + 46);
    y = b.cur().y;
    const yImg = y - rowH;
    photos.forEach((p, i) => {
      const x = MARGIN + i * (figW + figGap);
      const { w, h } = hs[i]!;
      const ox = x + (figW - w) / 2;
      const oy = yImg + (rowH - h);
      b.clippedImage(ox, oy, w, h, 4, imgNames[i]!, CARD_BORDER);
      const fig = i === 0 ? "Figure 1a" : "Figure 1b";
      const cap = i === 0 ? "Captured photo, full frame" : "Measured outlines";
      b.text(x, oy - 13, "F2", 8.5, DARK, fig);
      b.text(x + estWidth(fig, 8.5, false, true) + 4, oy - 13, "F1", 8.5, GREY, `· ${cap}`);
    });
    y = yImg - 20;
    b.cur().y = y;
    // legend below the captions (red = damage, green = coin)
    const legY = y - 14;
    const lx = MARGIN + figW + figGap;
    b.rect(lx, legY - 2, 10, 10, RED, null);
    b.text(lx + 14, legY, "F1", 8.5, GREY, "Damage");
    const cx2 = lx + 78;
    b.circle(cx2 + 5, legY + 5, 6, GREEN);
    b.text(cx2 + 15, legY, "F1", 8.5, GREY, "Coin scale reference");
    y = legY - 12;
    b.cur().y = y;
    gap(8);
  } else if (photos.length === 1) {
    const p = photos[0]!;
    const figW = CONTENT_W;
    const s = Math.min(figW / p.width, 240 / p.height);
    const w = p.width * s;
    const h = p.height * s;
    ensure(h + 40);
    y = b.cur().y;
    const ox = MARGIN + (figW - w) / 2;
    b.clippedImage(ox, y - h, w, h, 4, imgNames[0]!, CARD_BORDER);
    b.text(MARGIN, y - h - 13, "F2", 8.5, DARK, "Figure 1");
    b.text(MARGIN + estWidth("Figure 1", 8.5, false, true) + 4, y - h - 13, "F1", 8.5, GREY, `· ${p.caption || "Captured photo"}`);
    y -= h + 20;
    b.cur().y = y;
    gap(8);
    y = b.cur().y;
  }

  // Method callout (2 sentences, plain language, coin + tilt)
  ensure(70);
  y = b.cur().y;
  b.text(MARGIN, y - 12, "F2", 12, GREEN, "Method");
  y -= 20;
  b.cur().y = y;
  const coinBit =
    r.coinLabel && r.coinMm
      ? `Reference: ${r.coinLabel} · ${r.coinMm} mm diameter.`
      : r.coinMm
        ? `Reference coin diameter: ${r.coinMm} mm.`
        : "";
  const methodText =
    r.method && !r.coinMm && !r.coinLabel
      ? r.method
      : mode === "percent-only"
        ? "No coin scale was in frame, so this report gives the damaged share as a percentage only, measured from photo pixels. Every number cites its evidence receipt."
        : "Outlines are measured from photo pixels and scaled using the coin as a reference of known diameter, with perspective tilt corrected from the coin’s elliptical shape. Every number cites its evidence receipt.";
  const mWidth = CONTENT_W - 24;
  const mH = b.paraHeight(mWidth, 10, methodText, 14);
  const refH = coinBit ? b.paraHeight(mWidth, 9, coinBit, 12) + 6 : 0;
  ensure(mH + refH + 26);
  y = b.cur().y;
  b.rrect(MARGIN, y - mH - refH - 20, CONTENT_W, mH + refH + 20, 6, WARM_BG, null);
  b.para(MARGIN + 12, y - 6, mWidth, "F1", 10, DARK, methodText, 14);
  if (coinBit) b.para(MARGIN + 12, y - 6 - mH - 2, mWidth, "F1", 9, GREY, coinBit, 12);
  y -= mH + refH + 20;
  b.cur().y = y;
  gap(8);

  // Verification checklist table
  ensure(110);
  y = b.cur().y;
  b.text(MARGIN, y - 12, "F2", 12, GREEN, "Verification");
  y -= 22;
  b.cur().y = y;
  const vx0 = MARGIN;
  const vx1 = PAGE_W - MARGIN;
  b.text(vx0, y - 10, "F2", 8.5, GREY, "CHECK");
  b.textRight(vx1, y - 10, "F2", 8.5, GREY, "RESULT", false, true);
  y -= 16;
  b.line(vx0, y, vx1, y, LIGHT_LINE, 0.7);
  y -= 8;
  b.cur().y = y;
  const vrows: { name: string; st: string; pass: boolean }[] = [
    { name: "Evidence gate", st: checks.gate === "passed" ? "Passed" : checks.gate === "failed" ? "Failed" : "Pending", pass: checks.gate === "passed" },
    {
      name: "Independent skeptic",
      st: checks.skeptic === "passed" ? "Passed" : checks.skeptic === "failed" ? "Failed" : checks.skeptic === "checking" ? "Checking…" : "Not run",
      pass: checks.skeptic === "passed",
    },
    {
      name: "Mask cross-check",
      st: checks.xcheck === "passed" ? "Passed" : checks.xcheck === "failed" ? "Failed" : checks.xcheck === "checking" ? "Checking…" : "Not run",
      pass: checks.xcheck === "passed",
    },
  ];
  for (const row of vrows) {
    ensure(26);
    drawCheckIcon(b, vx0 + 9, y - 9, row.pass ? "pass" : "idle");
    b.text(vx0 + 26, y - 13, "F1", 10, DARK, row.name);
    const rc: RGB = row.pass ? GREEN : row.st === "Failed" ? RED : GREY;
    const fnt = row.pass || row.st === "Failed" ? "F2" : "F1";
    b.textRight(vx1, y - 13, fnt, 10, rc, row.st, false, fnt === "F2");
    y -= 24;
    b.cur().y = y;
  }

  /* ---------------- Page 2: annexure ---------------- */
  b.forcePage();
  y = b.cur().y;
  b.text(MARGIN, y - 24, "F2", 22, NAVY, "Annexure: evidence receipts");
  y -= 30;
  b.text(MARGIN, y - 8, "F1", 8.5, GREY, `annexure v${version}  ·  mode ${modeLabel}  ·  generated ${generatedUtc}`);
  y -= 20;
  b.cur().y = y;

  // Findings table
  b.text(MARGIN, y - 12, "F2", 12, GREEN, `Findings (${findings.length})`);
  y -= 22;
  b.cur().y = y;
  const fx = [MARGIN, MARGIN + 118, MARGIN + 208, MARGIN + 298, MARGIN + 388];
  const fxR = PAGE_W - MARGIN;
  const fHead = ["FINDING", "AREA", "LENGTH", "WIDTH", "SEVERITY"];
  fHead.forEach((h, i) => b.text(fx[i]!, y - 10, "F2", 8.5, GREY, h));
  y -= 16;
  b.line(MARGIN, y, fxR, y, GREY, 0.5);
  y -= 6;
  b.cur().y = y;
  findings.forEach((f, fi) => {
    const wUnver = (f.widthStatus ?? (f.widthMm !== null ? "unverified" : "confirmed")) === "unverified" && f.widthMm !== null;
    const rowH = wUnver ? 28 : 24;
    ensure(rowH + 4);
    y = b.cur().y;
    if (fi % 2 === 0) b.rect(MARGIN, y - rowH, CONTENT_W, rowH, ZEBRA_BG, null);
    b.rect(fx[0]! + 2, y - 20, 10, 10, RED, null);
    b.text(fx[0]! + 20, y - 18, "F2", 10, DARK, cap(f.label));
    b.text(fx[1]!, y - 18, "F1", 10, DARK, fmtArea(f.areaCm2));
    b.text(fx[2]!, y - 18, "F1", 10, DARK, fmtLength(f.lengthMm));
    b.text(fx[3]!, y - 18, "F1", 10, DARK, fmtLength(f.widthMm));
    if (wUnver) b.text(fx[3]!, y - 28, "F2", 8, AMBER_TEXT, "Unverified");
    b.text(fx[4]!, y - 18, "F2", 10, DARK, capSev(f.severity));
    y -= rowH;
    b.cur().y = y;
  });
  b.line(MARGIN, y, fxR, y, LIGHT_LINE, 0.5);
  // finding sentence (italic, grey)
  const sent =
    primary.statement ??
    `A ${primary.severity.toLowerCase()} ${primary.label} covering ${fmtPercent(primary.percent)} of the component` +
      (primary.lengthMm !== null ? `, extending ${fmtLength(primary.lengthMm)}` : "") +
      ".";
  const sH = b.paraHeight(CONTENT_W, 9.5, sent, 13);
  ensure(sH + 8);
  y = b.cur().y;
  b.para(MARGIN, y - 2, CONTENT_W, "F3", 9.5, GREY, sent, 13);
  y -= sH + 6;
  b.cur().y = y;
  gap(10);
  y = b.cur().y;

  // Receipts table
  ensure(60);
  y = b.cur().y;
  b.text(MARGIN, y - 12, "F2", 12, GREEN, `Receipts (${receipts.length})`);
  y -= 24;
  b.cur().y = y;
  const cx0 = MARGIN;
  const cx1 = MARGIN + 46;
  const cx2 = MARGIN + 178;
  const cx3 = MARGIN + 290;
  const cxR = PAGE_W - MARGIN;
  const drawReceiptHead = (): void => {
    const yy = b.cur().y;
    b.text(cx0, yy - 10, "F2", 8.5, GREY, "ID");
    b.text(cx1, yy - 10, "F2", 8.5, GREY, "MEASURE");
    b.text(cx2, yy - 10, "F2", 8.5, GREY, "VALUE");
    b.text(cx3, yy - 10, "F2", 8.5, GREY, "FORMULA");
    b.line(cx0, yy - 16, cxR, yy - 16, GREY, 0.5);
    b.cur().y = yy - 22;
  };
  drawReceiptHead();
  if (!receipts.length) {
    ensure(26);
    const ny = b.cur().y;
    b.text(cx0, ny - 13, "F1", 10, DARK, "No receipts attached to this copy – see the original report for citations.");
    b.cur().y = ny - 22;
  }
  receipts.forEach((rcpt, i) => {
    const fW = cxR - cx3 - 4;
    const fLines = wrapWords(rcpt.formula, Math.max(8, Math.floor(fW / 5.4)));
    const mLines = wrapWords(rcpt.measure, 22);
    const vLines = rcpt.unverified ? 2 : 1;
    const rowH = Math.max(18, Math.max(fLines.length, mLines.length, vLines) * 11 + 7);
    if (b.cur().y - rowH < CONTENT_BOTTOM) {
      b.forcePage();
      drawReceiptHead();
    }
    y = b.cur().y;
    if (i % 2 === 0) b.rect(MARGIN, y - rowH, CONTENT_W, rowH, ZEBRA_BG, null);
    b.text(cx0, y - 12, "F2", 9, GREEN, rcpt.id);
    // measure may wrap
    mLines.slice(0, 2).forEach((ln, li) => b.text(cx1, y - 12 - li * 10, "F1", 10, DARK, ln));
    b.text(cx2, y - 12, "F2", 10, DARK, rcpt.value);
    if (rcpt.unverified) b.text(cx2, y - 22, "F2", 8, AMBER_TEXT, "Unverified");
    fLines.slice(0, 3).forEach((ln, li) => b.text(cx3, y - 12 - li * 10, "F4", 9, DARK, ln));
    // hairline divider
    b.line(MARGIN, y - rowH, cxR, y - rowH, LIGHT_LINE, 0.5);
    b.cur().y = y - rowH;
  });
  y = b.cur().y;
  gap(10);

  // Closing callout
  const closeText = "Computed, not generated. Every number in this report cites a receipt above; if one is missing, the report fails its evidence check. Any receipt can be replayed from the original request to reproduce the same result.";
  const cW = CONTENT_W - 28;
  const cH = b.paraHeight(cW, 10, closeText, 14);
  ensure(cH + 20);
  y = b.cur().y;
  const cBot = y - cH - 16;
  b.rrect(MARGIN + 4, cBot, CONTENT_W - 4, cH + 16, 6, WARM_BG, null);
  b.emit(`${rg(GREEN)}\n${MARGIN.toFixed(1)} ${cBot.toFixed(1)} ${(4).toFixed(1)} ${(cH + 24).toFixed(1)} re f\n0 0 0 rg`);
  // bold lead: draw first 3 words bold by splitting (approx: draw whole in regular, overdraw lead bold)
  b.para(MARGIN + 16, y - 4, cW, "F1", 10, DARK, closeText, 14);
  b.text(MARGIN + 16, y - 4 - 14 + 14, "F2", 10, DARK, "Computed,");
  b.text(MARGIN + 16 + estWidth("Computed, ", 10, false, true), y - 4 - 14 + 14, "F2", 10, DARK, "not generated.");
  y = cBot;
  b.cur().y = y;

  /* ---------------- Emit PDF ---------------- */
  const of = b.pages.length;
  // footers (identical, slim, readable grey)
  b.pages.forEach((pg, i) => {
    pg.stream.push(`${RG(LIGHT_LINE)}\n0.5 w\n${MARGIN} ${FOOTER_RULE_Y} m ${PAGE_W - MARGIN} ${FOOTER_RULE_Y} l S\n0 0 0 RG`);
    pg.stream.push(`BT /F1 8.5 Tf 10 TL ${MARGIN} ${FOOTER_TEXT_Y} Td (${escPdf(`${r.ref} · Generated on this device by SnapClaim`)}) Tj ET`);
    const pr = `Page ${i + 1} of ${of}`;
    pg.stream.push(`BT /F1 8.5 Tf 10 TL ${(PAGE_W - MARGIN - estWidth(pr, 8.5)).toFixed(1)} ${FOOTER_TEXT_Y} Td (${escPdf(pr)}) Tj ET`);
  });

  const w = new Writer();
  w.str("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  let next = 3 + b.pages.length * 2;
  const fontReg = next++;
  const fontBold = next++;
  const fontIt = next++;
  const fontMono = next++;
  const pageNums: number[] = [];
  const contentNums: number[] = [];
  for (let i = 0; i < b.pages.length; i++) {
    pageNums.push(3 + i * 2);
    contentNums.push(4 + i * 2);
  }
  const imgNums: number[] = [];
  for (let k = 0; k < r.photos.length; k++) imgNums.push(next++);
  let logoNum = -1;
  if (r.headerLogo) logoNum = next++;

  // images (binary passthrough)
  r.photos.forEach((photo, k) => {
    const n = imgNums[k]!;
    w.offsets[n] = w.length;
    const alt = photo.alt ? ` /Alt (${escPdf(photo.alt)})` : "";
    w.str(
      `${n} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${photo.width} /Height ${photo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode${alt} /Length ${photo.jpeg.length} >>\nstream\n`,
    );
    w.raw(photo.jpeg);
    w.str("\nendstream\nendobj\n");
  });
  if (r.headerLogo && logoNum >= 0) {
    const logo = r.headerLogo;
    w.offsets[logoNum] = w.length;
    w.str(
      `${logoNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.jpeg.length} >>\nstream\n`,
    );
    w.raw(logo.jpeg);
    w.str("\nendstream\nendobj\n");
  }

  const title = `SnapClaim · Measured damage report ${r.ref}`;
  const infoNum = next++;
  w.offsets[1] = w.length;
  w.str(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Lang (en-GB) /MarkInfo << /Marked true >> >>\nendobj\n`);
  w.offsets[2] = w.length;
  w.str(`2 0 obj\n<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${b.pages.length} >>\nendobj\n`);
  w.offsets[fontReg] = w.length;
  w.str(`${fontReg} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);
  w.offsets[fontBold] = w.length;
  w.str(`${fontBold} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`);
  w.offsets[fontIt] = w.length;
  w.str(`${fontIt} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>\nendobj\n`);
  w.offsets[fontMono] = w.length;
  w.str(`${fontMono} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\nendobj\n`);
  w.offsets[infoNum] = w.length;
  w.str(`infoNum 0 obj\n<< /Title (${escPdf(title)}) /Creator (SnapClaim on-device) /Producer (SnapClaim report writer) /Language (en-GB) >>\nendobj\n`.replace("infoNum", String(infoNum)));

  b.pages.forEach((pg, i) => {
    const names: string[] = [];
    r.photos.forEach((_, k) => {
      if (pg.stream.join("\n").includes(`/Im${k} Do`)) names.push(`/Im${k} ${imgNums[k]} 0 R`);
    });
    // simpler: include all images referenced anywhere on this page by name scan
    const streamSoFar = pg.stream.join("\n");
    const xobjs: string[] = [];
    imgNames.forEach((nm, k) => {
      if (streamSoFar.includes(`/${nm} Do`)) xobjs.push(`/${nm} ${imgNums[k]} 0 R`);
    });
    if (logoNum >= 0 && streamSoFar.includes("/Logo Do")) xobjs.push(`/Logo ${logoNum} 0 R`);
    const res = `<< /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R /F3 ${fontIt} 0 R /F4 ${fontMono} 0 R >>${xobjs.length ? ` /XObject << ${xobjs.join(" ")} >>` : ""} >>`;
    const stream = pg.stream.join("\n") + "\n";
    const bytes = new TextEncoder().encode(stream);
    w.offsets[contentNums[i]!] = w.length;
    w.str(`${contentNums[i]} 0 obj\n<< /Length ${bytes.length} >>\nstream\n`);
    w.raw(bytes);
    w.str("\nendstream\nendobj\n");
    w.offsets[pageNums[i]!] = w.length;
    w.str(`${pageNums[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${res} /Contents ${contentNums[i]} 0 R >>\nendobj\n`);
  });

  const xrefAt = w.length;
  const maxObj = next - 1;
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxObj; n++) xref += `${String(w.offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`;
  w.str(xref);
  w.str(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
  return w.bytes();
}

/** JPEG data-URL (or any image URL the browser decoded) to raw JPEG bytes. */
export function dataUrlToJpegBytes(url: string): Uint8Array {
  if (!url.startsWith("data:image/jpeg;base64,")) throw new Error("photo must be data:image/jpeg;base64");
  const comma = url.indexOf(",");
  const b64 = comma >= 0 ? url.slice(comma + 1) : url;
  if (b64.length > 2_000_000) throw new Error("photo too large");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (out.length < 2 || out[0] !== 0xff || out[1] !== 0xd8) throw new Error("photo is not a JPEG");
  return out;
}
