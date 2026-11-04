import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildReportPdf, type PdfReport } from "../react/src/lib/pdf.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function sampleReport(over: Partial<PdfReport> = {}): PdfReport {
  return {
    brand: "SnapClaim",
    ref: "SC-AEF52BF6",
    dateLine: "4 Nov 2026 · 1 finding",
    quote: "crack near the slab",
    version: "0.3.0",
    mode: "absolute",
    generatedUtc: "2026-11-04 11:55 UTC",
    findings: [
      {
        label: "crack",
        percent: 0.76,
        lengthMm: 229.3,
        widthMm: 3.3,
        areaCm2: 7.66,
        severity: "significant",
        receiptIds: { ratio: "R002", length: "R005", area: "R004", width: "R006", severity: "R007" },
        widthStatus: "unverified",
      },
    ],
    receipts: [
      { id: "R001", measure: "Scale calibration", value: "0.757669 mm/px", formula: "knownMm / referenceLengthPx" },
      { id: "R002", measure: "Area ratio", value: "0.76%", formula: "damageAreaPx / componentAreaPx × 100" },
      { id: "R003", measure: "Region count", value: "1", formula: "count of disconnected mask components" },
      { id: "R004", measure: "Calibrated area", value: "7.66 cm²", formula: "damageAreaPx × mmPerPx² / 100" },
      { id: "R005", measure: "Calibrated length", value: "229.3 mm", formula: "skeletonPx × mmPerPx" },
      { id: "R006", measure: "Calibrated width", value: "3.3 mm", formula: "damageAreaPx / skeletonPx × mmPerPx", unverified: true },
      { id: "R007", measure: "Severity classification", value: "Significant", formula: "area ratio + calibrated length + region count vs printed thresholds" },
    ],
    checks: { gate: "passed", skeptic: "not-run", xcheck: "not-run" },
    photos: [
      { jpeg: JPEG, width: 8, height: 6, caption: "Captured photo, full frame", alt: "Figure 1a" },
      { jpeg: JPEG, width: 8, height: 6, caption: "Measured outlines", alt: "Figure 1b" },
    ],
    ...over,
  };
}

function latin(pdf: Uint8Array): string {
  return Buffer.from(pdf).toString("latin1");
}

function parseXref(pdf: Uint8Array): Map<number, number> {
  const s = latin(pdf);
  const m = s.match(/xref\n0 (\d+)\n([\s\S]*?)trailer/);
  assert.ok(m, "xref table present");
  const map = new Map<number, number>();
  const lines = m[2]!.trim().split("\n");
  for (let n = 1; n < lines.length; n++) {
    map.set(n, parseInt(lines[n]!.slice(0, 10), 10));
  }
  return map;
}

function fontSizes(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/\/F\d (\d+(?:\.\d+)?) Tf/g)) out.push(Number(m[1]));
  return out;
}

test("report PDF is structurally valid with all offsets landing", () => {
  const pdf = buildReportPdf(sampleReport());
  const s = latin(pdf);
  assert.ok(s.startsWith("%PDF-1.4"), "PDF header");
  assert.ok(s.includes("/DCTDecode"), "JPEG passed through");
  assert.ok(s.includes("SC-AEF52BF6"), "reference number in body");
  assert.ok(s.includes("Page 1 of 2"), "slim footer with page numbers");
  assert.ok(s.includes("Page 2 of 2"), "identical footer on page 2");
  assert.ok(s.trimEnd().endsWith("%%EOF"), "EOF marker");
  assert.ok(s.includes("/WinAnsiEncoding"), "WinAnsi keeps dashes and superscripts");
  assert.ok(s.includes("/Lang (en-GB)"), "document language set");
  assert.ok(s.includes("/Title (SnapClaim") && s.includes("Measured damage report SC-AEF52BF6"), "document title set");
  const xref = parseXref(pdf);
  for (const [n, off] of xref) {
    assert.ok(s.startsWith(`${n} 0 obj`, off), `object ${n} offset lands`);
  }
});

test("header band sits at the top with visible report meta", () => {
  const s = latin(buildReportPdf(sampleReport()));
  // navy band rect at the top of the page (y ~770), not at the origin
  assert.ok(s.includes("0 770"), "navy header band at page top");
  assert.ok(!s.match(/0 0 595(\.0)? 68 re f/), "no navy block at the page bottom");
  assert.ok(s.includes("Measured damage report"), "report title in header");
  assert.ok(s.includes("4 Nov 2026"), "generated date in header");
});

test("typography uses superscripts, tight percents and middot separators", () => {
  const pdf = buildReportPdf(sampleReport());
  // raw WinAnsi octal escapes: ² = \262, · = \267, × = \327
  const s = latin(pdf);
  assert.ok(s.includes("\\262"), "cm² superscript survives");
  assert.ok(s.includes("0.76%"), "no space before %");
  assert.ok(!s.includes("0.76 %"), "no spaced percent");
  assert.ok(!s.includes(" - "), 'no ASCII " - " separators');
  assert.ok(s.includes("Figure 1a"), "figure 1a caption");
  assert.ok(s.includes("Figure 1b"), "figure 1b caption");
  for (const size of fontSizes(s)) {
    assert.ok(size >= 8, `no text below 8pt (saw ${size}pt)`);
  }
});

test("page 1 carries cards, width caveat, method and verification", () => {
  const s = latin(buildReportPdf(sampleReport()));
  for (const token of ["229.3", "3.3", "7.66", "0.76%", "SIGNIFICANT", "R005", "R006", "R004", "R002", "R007"]) {
    assert.ok(s.includes(token), `stat strip cites ${token}`);
  }
  assert.ok(s.includes("Unverified"), "width shows an amber Unverified chip");
  assert.ok(s.includes("Width is unverified:"), "width caveat kept next to the card in plain language");
  assert.ok(s.includes("Method"), "method section present");
  assert.ok(s.includes("Evidence gate"), "verification checklist present");
  assert.ok(s.includes("Independent skeptic"), "skeptic row never hidden");
  assert.ok(s.includes("Mask cross-check"), "cross-check row never hidden");
  assert.ok(s.includes("Not run"), "not-run reads neutral, not a failure");
});

test("page 2 is a native-text annexure with findings and receipts", () => {
  const s = latin(buildReportPdf(sampleReport()));
  assert.ok(s.includes("Annexure: evidence receipts"), "annexure heading");
  assert.ok(s.includes("annexure v0.3.0"), "annexure version meta");
  assert.ok(s.includes("ABSOLUTE") && s.includes("calibrated"), "annexure mode meta");
  assert.ok(s.includes("2026-11-04 11:55 UTC"), "annexure timestamp meta");
  assert.ok(!s.includes("proportional schematics"), "no stale bars note");
  for (const id of ["R001", "R002", "R003", "R004", "R005", "R006", "R007"]) {
    assert.ok(s.includes(`(${id})`), `receipt ${id} selectable in text layer`);
  }
  assert.ok(s.includes("Computed, not generated."), "closing callout kept");
});

test("flow layout survives three findings", () => {
  const one = sampleReport().findings![0]!;
  const pdf = buildReportPdf(
    sampleReport({
      ref: "SC-3FIND01",
      dateLine: "4 Nov 2026 · 3 findings",
      findings: [
        one,
        { label: "stain", percent: 1.29, lengthMm: null, widthMm: null, areaCm2: 13.02, severity: "moderate", receiptIds: { ratio: "R009", area: "R011", severity: "R013" } },
        { label: "peel", percent: 0.42, lengthMm: null, widthMm: null, areaCm2: 4.24, severity: "cosmetic", receiptIds: { ratio: "R014", area: "R016", severity: "R018" } },
      ],
    }),
  );
  const s = latin(pdf);
  for (const token of ["Stain", "Peel", "Findings"]) assert.ok(s.includes(token), `three-finding annexure cites ${token}`);
  assert.ok(s.includes("\\(3\\)"), "three-finding count in heading");
  const xref = parseXref(pdf);
  for (const [n, off] of xref) assert.ok(s.startsWith(`${n} 0 obj`, off), `object ${n} offset lands`);
});

test("flow layout survives a long transcript", () => {
  const pdf = buildReportPdf(
    sampleReport({
      quote: "crack near the slab that started hairline after the heavy rain last month and has now widened along the joint past the drain cover towards the step",
    }),
  );
  const s = latin(pdf);
  assert.ok(s.includes("drain cover"), "long quote kept whole, nothing clipped");
  assert.ok(s.includes("Verification"), "verification not pushed off by the quote");
  const xref = parseXref(pdf);
  for (const [n, off] of xref) assert.ok(s.startsWith(`${n} 0 obj`, off), `object ${n} offset lands`);
});

test("a confirmed width reads green with no caveat", () => {
  const one = sampleReport().findings![0]!;
  const pdf = buildReportPdf(
    sampleReport({
      findings: [{ ...one, widthStatus: "confirmed" }],
      receipts: sampleReport().receipts!.map((x) => (x.id === "R006" ? { ...x, unverified: false } : x)),
      checks: { gate: "passed", skeptic: "passed", xcheck: "passed" },
    }),
  );
  const s = latin(pdf);
  assert.ok(!s.includes("Width is unverified:"), "no caveat when width is confirmed");
  assert.ok(s.includes("Confirmed"), "confirmed chips present");
});

test("legacy rows still render without invented receipts", () => {
  const pdf = buildReportPdf({
    brand: "SnapClaim",
    ref: "SC-LEGACY",
    dateLine: "4 Nov 2026 · 1 finding",
    quote: "crack (legacy)",
    rows: [
      { item: "Crack length", value: "10 mm", evidence: "R1", status: "Confirmed" },
      { item: "Surface affected", value: "1.00%", evidence: "R2", status: "Confirmed" },
    ],
    checks: "Evidence gate: passed - Independent skeptic: not run - Mask cross-check: not run",
    photos: [],
  });
  const s = latin(pdf);
  assert.ok(s.includes("SC-LEGACY"), "legacy ref renders");
  assert.ok(s.includes("(R1)"), "cited receipt kept");
  assert.ok(!s.includes("0.757669"), "no invented scale value");
  assert.ok(s.includes("Page 1 of"), "footer present");
});
