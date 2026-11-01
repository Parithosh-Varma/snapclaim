/**
 * Minimal PDF 1.4 writer for the damage report: letterhead text in Helvetica
 * plus the report photos as embedded JPEGs. No dependencies, so the download
 * works where window.print() does nothing (notably installed iOS PWAs, where
 * print is silently a no-op). Text is WinAnsi-sanitised; photos pass through
 * as JPEG bytes untouched.
 */

export interface PdfPhoto {
  /** Raw JPEG bytes (DCTDecode passthrough, no re-encode). */
  jpeg: Uint8Array;
  width: number;
  height: number;
  caption: string;
}

export interface PdfReport {
  brand: string;
  ref: string;
  dateLine: string;
  quote: string;
  rows: { item: string; value: string; evidence: string; status: string }[];
  method: string;
  checks: string;
  photos: PdfPhoto[];
  /** Light logo (cream on transparent) for the navy header band. */
  headerLogo?: PdfPhoto;
}

/** SnapClaim brand palette as 0-1 PDF fill colors. */
const NAVY: [number, number, number] = [0.043, 0.118, 0.275];
const COIN: [number, number, number] = [0.055, 0.541, 0.302];
const SLATE: [number, number, number] = [0.239, 0.29, 0.408];
const WHITE: [number, number, number] = [1, 1, 1];
const fmt3 = (n: number): string => String(Math.round(n * 1000) / 1000);
const rg = (c: [number, number, number]): string => `${fmt3(c[0])} ${fmt3(c[1])} ${fmt3(c[2])} rg`;

const WIN_ANSI_FIX: Record<string, string> = {
  "—": "-", "–": "-", "―": "-", "…": "...", "“": '"', "”": '"',
  "‘": "'", "’": "'", "‚": ",", "„": '"', "•": "-", "·": "-",
  "✓": "v", "→": "->", "←": "<-", "↑": "^", "↓": "v",
  "²": "2", "³": "3", "°": "deg", "±": "+/-", "×": "x", "÷": "/",
  "€": "EUR", "£": "GBP", "₹": "Rs. ", " ": " ",
};

function pdfText(s: string): string {
  let out = "";
  for (const ch of String(s)) {
    if (ch >= " " && ch <= "~") out += ch;
    else if (ch === "\n" || ch === "\t" || ch === "\r") out += " ";
    else if (WIN_ANSI_FIX[ch] !== undefined) out += WIN_ANSI_FIX[ch];
    else if (ch === "😀") out += ":)";
  }
  return out.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(s: string, width: number): string[] {
  const words = pdfText(s).split(/ +/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > width && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

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

  obj(n: number, body: string): void {
    this.offsets[n] = this.length;
    this.str(`${n} 0 obj\n${body}\nendobj\n`);
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

export function buildReportPdf(r: PdfReport): Uint8Array {
  const w = new Writer();
  w.str("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");

  // Object numbers: 1 catalog, 2 pages, then per page (page, content),
  // then 2 fonts, then one object per photo (+1 for the header logo).
  type El =
    | { kind: "text"; font: string; size: number; line: string; color?: [number, number, number] }
    | { kind: "photo"; photo: PdfPhoto; w: number; h: number }
    | { kind: "header" }
    | { kind: "footer"; page: number; of: number };
  const pages: El[][] = [[{ kind: "header" }]];
  const HEADER_H = 108;
  let y = PAGE_H - HEADER_H - 16;

  const need = (h: number): El[] => {
    let cur = pages[pages.length - 1]!;
    if (y - h < MARGIN) {
      cur = [];
      pages.push(cur);
      y = PAGE_H - MARGIN;
    }
    return cur;
  };
  const text = (font: string, size: number, s: string, color?: [number, number, number]): void => {
    for (const line of wrap(s, font === "F2" ? 82 : 88)) {
      const cur = need(size + 4);
      cur.push({ kind: "text", font, size, line, color });
      y -= size + 4;
    }
  };
  const gap = (h: number): void => {
    need(h);
    y -= h;
  };

  if (r.quote.trim()) {
    text("F1", 11, `"${r.quote.trim()}"`, SLATE);
    gap(6);
  }
  text("F2", 12, "Measurements", COIN);
  for (const row of r.rows) {
    text("F1", 11, `${row.item}: ${row.value}   [${row.evidence}] (${row.status})`);
  }
  gap(8);
  text("F2", 12, "Method", COIN);
  text("F1", 11, r.method);
  gap(8);
  text("F2", 12, "Verification", COIN);
  text("F1", 11, r.checks);
  gap(4);
  for (const photo of r.photos) {
    const scale = Math.min(1, CONTENT_W / photo.width, 480 / photo.height);
    const pw = photo.width * scale;
    const ph = photo.height * scale;
    const cur = need(ph + 16);
    cur.push({ kind: "photo", photo, w: pw, h: ph });
    y -= ph;
    text("F1", 10, photo.caption);
    gap(10);
  }

  // Emit: fonts first so content streams can reference them.
  let next = 3 + pages.length * 2;
  const fontReg = next++;
  const fontBold = next++;

  const pageNums: number[] = [];
  const contentNums: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    pageNums.push(3 + i * 2);
    contentNums.push(4 + i * 2);
  }

  // Image objects (report photos + header logo).
  const imgNums: number[] = [];
  for (const photo of r.photos) {
    const n = next++;
    imgNums.push(n);
    w.offsets[n] = w.length;
    const head =
      `${n} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${photo.width} /Height ${photo.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${photo.jpeg.length} >>\nstream\n`;
    w.str(head);
    w.raw(photo.jpeg);
    w.str("\nendstream\nendobj\n");
  }

  w.obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  w.obj(2, `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  w.obj(fontReg, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  w.obj(fontBold, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  let logoNum = -1;
  if (r.headerLogo) {
    const logo = r.headerLogo;
    logoNum = next++;
    w.offsets[logoNum] = w.length;
    w.str(
      `${logoNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.jpeg.length} >>\nstream\n`,
    );
    w.raw(logo.jpeg);
    w.str("\nendstream\nendobj\n");
  }
  // Footers render at a fixed bottom strip on every page.
  for (const els of pages) {
    els.push({ kind: "footer", page: pages.indexOf(els) + 1, of: pages.length });
  }

  pages.forEach((els, i) => {
    const names = r.photos
      .map((_, k) => ({ k, on: els.some((e) => e.kind === "photo" && (e as { photo: PdfPhoto }).photo === r.photos[k]) }))
      .filter((e) => e.on)
      .map((e) => `/Im${e.k} ${imgNums[e.k]} 0 R`)
      .join(" ");
    const logoRef = logoNum >= 0 && els.some((e) => e.kind === "header") ? ` /Logo ${logoNum} 0 R` : "";
    const res = `<< /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >>${names ? ` /XObject << ${names}${logoRef} >>` : logoRef ? ` /XObject <<${logoRef} >>` : ""} >>`;
    // Lay out this page top-down, in planning order.
    let cy = PAGE_H - MARGIN;
    let stream = "";
    for (const el of els) {
      if (el.kind === "text") {
        cy -= el.size + 4;
        if (el.color) stream += `${rg(el.color)}\n`;
        stream += `BT /${el.font} ${el.size} Tf ${el.size + 3} TL ${MARGIN} ${Math.round(cy)} Td (${el.line}) Tj ET\n`;
        if (el.color) stream += `0 0 0 rg\n`;
      } else if (el.kind === "photo") {
        cy -= el.h;
        stream += `q ${el.w.toFixed(1)} 0 0 ${el.h.toFixed(1)} ${MARGIN} ${Math.round(cy)} cm /Im${r.photos.indexOf(el.photo)} Do Q\n`;
      } else if (el.kind === "header") {
        const top = PAGE_H - HEADER_H;
        stream += `q ${rg(NAVY)} 0 0 ${PAGE_W} ${HEADER_H} re f Q\n`;
        const lw = 56;
        const lh = r.headerLogo ? (56 * r.headerLogo.height) / r.headerLogo.width : 0;
        if (r.headerLogo && logoNum >= 0) {
          stream += `q ${lw.toFixed(1)} 0 0 ${lh.toFixed(1)} ${MARGIN} ${Math.round(top + (HEADER_H - lh) / 2)} cm /Logo Do Q\n`;
        }
        const tx = MARGIN + (r.headerLogo ? lw + 14 : 0);
        stream += `${rg(WHITE)}\nBT /F2 20 Tf 24 TL ${tx} ${Math.round(top + 62)} Td (${pdfText(r.brand)}) Tj ET\n`;
        stream += `BT /F1 11 Tf 14 TL ${tx} ${Math.round(top + 36)} Td (${pdfText(`Ref ${r.ref}  -  Measured damage report`)}) Tj ET\n`;
        stream += `BT /F1 11 Tf 14 TL ${tx} ${Math.round(top + 18)} Td (${pdfText(r.dateLine)}) Tj ET\n0 0 0 rg\n`;
        stream += `q ${rg(COIN)} 0 ${PAGE_H - 4} ${PAGE_W} 4 re f Q\n`;
        cy = top - 16;
      } else {
        stream += `${rg(SLATE)}\nBT /F1 9 Tf 12 TL ${MARGIN} 30 Td (${pdfText(`Generated on this device by SnapClaim  -  Ref ${r.ref}  -  Page ${el.page} of ${el.of}`)}) Tj ET\n0 0 0 rg\n`;
      }
    }
    w.offsets[contentNums[i]!] = w.length;
    const bytes = new TextEncoder().encode(stream);
    w.str(`${contentNums[i]} 0 obj\n<< /Length ${bytes.length} >>\nstream\n`);
    w.raw(bytes);
    w.str("\nendstream\nendobj\n");
    w.offsets[pageNums[i]!] = w.length;
    w.str(`${pageNums[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${res} /Contents ${contentNums[i]} 0 R >>\nendobj\n`);
  });

  // Fix xref: objects were emitted out of order (images first), so rebuild
  // offsets by re-walking would be wrong - instead the Writer tracked every
  // object start above. Emit the table now.
  const xrefAt = w.length;
  const maxObj = next - 1;
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxObj; n++) {
    xref += `${String(w.offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  w.str(xref);
  w.str(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
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
