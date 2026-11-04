import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReportPdf } from "../react/src/lib/pdf.ts";

/**
 * Render the sample PDFs for the measured-damage report redesign
 * (see docs review of SC-AEF52BF6): the current report, plus the three
 * stress variants (3 findings, long transcript, confirmed width).
 *
 * Figures come from scripts/fixtures/ so anyone can reproduce the render:
 * original-sample.jpg is react/public/samples/dsc_0698.jpg, and
 * annotated-sample.jpg is the same frame with the measured damage outline
 * (red) and coin scale outline (green) drawn on it.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "docs", "samples");

function jpeg(path: string): { jpeg: Uint8Array; width: number; height: number } {
  const buf = readFileSync(path);
  // minimal JPEG SOF scan for dimensions
  let w = 0;
  let h = 0;
  for (let i = 0; i < buf.length - 9; i++) {
    if (buf[i] === 0xff && [0xc0, 0xc1, 0xc2].includes(buf[i + 1] as number)) {
      h = (buf[i + 5] as number) * 256 + (buf[i + 6] as number);
      w = (buf[i + 7] as number) * 256 + (buf[i + 8] as number);
      break;
    }
  }
  if (!w || !h) throw new Error(`no SOF in ${path}`);
  return { jpeg: new Uint8Array(buf), width: w, height: h };
}

const orig = jpeg(join(root, "scripts", "fixtures", "original-sample.jpg"));
const ann = jpeg(join(root, "scripts", "fixtures", "annotated-sample.jpg"));
const logo = jpeg(join(root, "scripts", "fixtures", "logo.jpg"));

const base = {
  brand: "SnapClaim",
  ref: "SC-AEF52BF6",
  dateLine: "4 Nov 2026 · 1 finding",
  version: "0.3.0",
  mode: "absolute" as const,
  generatedUtc: "2026-11-04 11:55 UTC",
  coinLabel: "US quarter",
  coinMm: 24.26,
  headerLogo: { ...logo, caption: "", alt: "SnapClaim logo" },
  photos: [
    { ...orig, caption: "Captured photo, full frame", alt: "Figure 1a: captured photo of the cracked slab, full frame" },
    { ...ann, caption: "Measured outlines", alt: "Figure 1b: measured outlines over the photo, red damage outline and green coin scale reference" },
  ],
};

const finding1122 = {
  label: "crack",
  percent: 0.76,
  lengthMm: 229.3,
  widthMm: 3.3,
  areaCm2: 7.66,
  severity: "significant",
  receiptIds: { ratio: "R002", length: "R005", area: "R004", width: "R006", severity: "R007" },
  statement: "Near the slab, a significant crack covers 0.76% of the component, extending 229.3 mm.",
};

const receipts1122 = [
  { id: "R001", measure: "Scale calibration", value: "0.757669 mm/px", formula: "knownMm / referenceLengthPx" },
  { id: "R002", measure: "Area ratio", value: "0.76%", formula: "damageAreaPx / componentAreaPx × 100" },
  { id: "R003", measure: "Region count", value: "1", formula: "count of disconnected mask components" },
  { id: "R004", measure: "Calibrated area", value: "7.66 cm²", formula: "damageAreaPx × mmPerPx² / 100" },
  { id: "R005", measure: "Calibrated length", value: "229.3 mm", formula: "skeletonPx × mmPerPx" },
  { id: "R006", measure: "Calibrated width", value: "3.3 mm", formula: "damageAreaPx / skeletonPx × mmPerPx", unverified: true },
  { id: "R007", measure: "Severity classification", value: "Significant", formula: "area ratio + calibrated length + region count vs printed thresholds" },
];

mkdirSync(OUT, { recursive: true });

// 1. current report: width unverified
writeFileSync(
  join(OUT, "SC-AEF52BF6.pdf"),
  buildReportPdf({
    ...base,
    quote: "crack near the slab",
    findings: [{ ...finding1122, widthStatus: "unverified" as const }],
    receipts: receipts1122,
    checks: { gate: "passed", skeptic: "not-run", xcheck: "not-run" },
  }),
);

// 2. three findings
const f3 = [
  { ...finding1122, widthStatus: "unverified" as const },
  { label: "stain", percent: 1.29, lengthMm: null, widthMm: null, areaCm2: 13.02, severity: "moderate", receiptIds: { ratio: "R009", area: "R011", severity: "R013" } },
  { label: "peel", percent: 0.42, lengthMm: null, widthMm: null, areaCm2: 4.24, severity: "cosmetic", receiptIds: { ratio: "R014", area: "R016", severity: "R018" } },
];
const r3 = [
  ...receipts1122,
  { id: "R008", measure: "Scale calibration", value: "0.757669 mm/px", formula: "knownMm / referenceLengthPx" },
  { id: "R009", measure: "Area ratio", value: "1.29%", formula: "damageAreaPx / componentAreaPx × 100" },
  { id: "R010", measure: "Region count", value: "2", formula: "count of disconnected mask components" },
  { id: "R011", measure: "Calibrated area", value: "13.02 cm²", formula: "damageAreaPx × mmPerPx² / 100" },
  { id: "R013", measure: "Severity classification", value: "Moderate", formula: "area ratio + region count vs printed thresholds" },
  { id: "R014", measure: "Area ratio", value: "0.42%", formula: "damageAreaPx / componentAreaPx × 100" },
  { id: "R016", measure: "Calibrated area", value: "4.24 cm²", formula: "damageAreaPx × mmPerPx² / 100" },
  { id: "R018", measure: "Severity classification", value: "Cosmetic", formula: "area ratio + region count vs printed thresholds" },
];
writeFileSync(
  join(OUT, "SC-3FINDINGS.pdf"),
  buildReportPdf({
    ...base,
    ref: "SC-3FIND01",
    dateLine: "4 Nov 2026 · 3 findings",
    quote: "cracks across the north wall and a damp stain near the window",
    findings: f3,
    receipts: r3,
    checks: { gate: "passed", skeptic: "not-run", xcheck: "not-run" },
  }),
);

// 3. long transcript
writeFileSync(
  join(OUT, "SC-LONGTXT.pdf"),
  buildReportPdf({
    ...base,
    ref: "SC-LONGTX1",
    quote: "crack near the slab that started hairline after the heavy rain last month and has now widened along the joint past the drain cover towards the step",
    findings: [{ ...finding1122, widthStatus: "unverified" as const }],
    receipts: receipts1122,
    checks: { gate: "passed", skeptic: "not-run", xcheck: "not-run" },
  }),
);

// 4. width confirmed
writeFileSync(
  join(OUT, "SC-WIDTHOK.pdf"),
  buildReportPdf({
    ...base,
    ref: "SC-WIDTHOK1",
    quote: "crack near the slab",
    findings: [{ ...finding1122, widthStatus: "confirmed" as const }],
    receipts: receipts1122.map((x) => (x.id === "R006" ? { ...x, unverified: false } : x)),
    checks: { gate: "passed", skeptic: "passed", xcheck: "passed" },
  }),
);

console.log(`wrote 4 pdfs to ${OUT}`);
for (const f of ["SC-AEF52BF6.pdf", "SC-3FINDINGS.pdf", "SC-LONGTXT.pdf", "SC-WIDTHOK.pdf"]) {
  const s = readFileSync(join(OUT, f));
  console.log(f, s.length, "bytes");
}
