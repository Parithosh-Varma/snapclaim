import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { measureSession } from "../src/engine/measure.ts";
import { renderAnnexureSvg } from "../src/render/svg.ts";
import { loadWallFixture } from "./helpers.ts";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

test("annexure marks crack width unverified: no width ground truth exists anywhere", () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  assert.ok(session.findings.some((f) => f.crackWidthMm !== null), "fixture has a width to label");
  const svg = renderAnnexureSvg({
    findings: session.findings,
    receipts: session.receipts,
    mode: session.mode,
    generatedAt: "t",
    version: "0.2.0",
  });
  assert.match(svg, /w [\d.]+ mm \(unverified/, "width carries the unverified mark");
  assert.ok(!svg.includes("Confirmed"), "annexure never claims a width is confirmed");
});

test("report tables and PDF exports label crack width unverified, not confirmed", () => {
  const report = read("react/src/screens/Report.tsx");
  const widthRow = report.match(/Crack width[\s\S]{0,500}?<\/tr>/)?.[0] ?? "";
  assert.match(widthRow, /Unverified/, "report table width row is unverified");
  assert.ok(!/Confirmed/.test(widthRow), "report table width row is not confirmed");
  assert.match(report, /row\("Crack width", `\$\{String\(f\.crackWidthMm\)\} mm`, refs\.width, "Unverified/, "PDF width row is unverified");
  const shared = read("react/src/screens/Shared.tsx");
  assert.match(shared, /row\("Crack width", `\$\{rep\.widthMm\} mm`, "Unverified/, "shared PDF width row is unverified");
});
