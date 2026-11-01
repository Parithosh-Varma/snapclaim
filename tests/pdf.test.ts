import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildReportPdf } from "../react/src/lib/pdf.ts";

function parseXref(pdf: Uint8Array): Map<number, number> {
  const s = Buffer.from(pdf).toString("latin1");
  const m = s.match(/xref\n0 (\d+)\n([\s\S]*?)trailer/);
  assert.ok(m, "xref table present");
  const map = new Map<number, number>();
  const lines = m[2]!.trim().split("\n");
  for (let n = 1; n < lines.length; n++) {
    map.set(n, parseInt(lines[n]!.slice(0, 10), 10));
  }
  return map;
}

test("report PDF is structurally valid with all offsets landing", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildReportPdf({
    brand: "SnapClaim",
    ref: "SC-TEST",
    dateLine: "1 Nov 2026",
    quote: "crack (test)",
    rows: [{ item: "Length", value: "10 mm", evidence: "R1", status: "ok" }],
    method: "m",
    checks: "c",
    photos: [{ jpeg, width: 2, height: 2, caption: "fig" }],
  });
  const s = Buffer.from(pdf).toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4"), "PDF header");
  assert.ok(s.includes("/DCTDecode"), "JPEG passed through");
  assert.ok(s.includes("(SC-TEST") || s.includes("SC-TEST"), "reference number in body");
  assert.ok(s.trimEnd().endsWith("%%EOF"), "EOF marker");
  assert.ok(s.includes("0.043 0.118 0.275 rg"), "navy SnapClaim header band");
  assert.ok(s.includes("0.055 0.541 0.302 rg"), "green section titles");
  assert.ok(s.includes("Page 1 of"), "footer with page numbers");
  const xref = parseXref(pdf);
  for (const [n, off] of xref) {
    assert.ok(s.startsWith(`${n} 0 obj`, off), `object ${n} offset lands`);
  }
});

test("report PDF sanitises unicode copy to ASCII", () => {
  const pdf = buildReportPdf({
    brand: "SnapClaim",
    ref: "SC-EMU",
    dateLine: "d",
    quote: "Crack — 5 mm… “quoted”",
    rows: [],
    method: "",
    checks: "",
    photos: [],
  });
  const s = Buffer.from(pdf).toString("latin1");
  assert.ok(!s.includes("—"), "no em dash survives");
  assert.ok(s.includes("Crack - 5 mm..."), "punctuation mapped to ASCII");
});
