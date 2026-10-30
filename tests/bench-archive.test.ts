import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { archiveRun, buildCaseRun, verdictsFromSkeptic } from "../bench/archive.ts";
import { evaluate, validateRun } from "../bench/run.ts";
import { citingDrafts, wallSession } from "./helpers.ts";

const provenance = { gitSha: "abc1234", model: "spark-open", promptVersion: "p1", timestamp: "2026-10-29T14:00:00+03:00" };

test("a skeptic that restates a finding confirms it, one that says DISPUTED disputes it", () => {
  const { findings } = wallSession();
  const drafts = citingDrafts(findings);
  const confirmed = verdictsFromSkeptic(findings, drafts);
  assert.equal(confirmed.get(findings[0]!.maskId), "CONFIRMED");
  const disputed = verdictsFromSkeptic(findings, drafts.map((d) => ({ ...d, statement: `DISPUTED: ${d.statement}` })));
  assert.equal(disputed.get(findings[0]!.maskId), "DISPUTED");
  const shortDisputed = verdictsFromSkeptic(
    findings,
    drafts.map((d) => ({
      statement: `Disputed: ${d.statement}`,
      citations: d.citations.map((c) => c.toLowerCase().replace(/^r0*(\d+)$/, "r$1")),
    })),
  );
  assert.equal(shortDisputed.get(findings[0]!.maskId), "DISPUTED");
});

test("a finding the skeptic never cited gets no verdict", () => {
  const { findings } = wallSession();
  assert.equal(verdictsFromSkeptic(findings, []).size, 0);
});

test("buildCaseRun carries lengths, receipt units and verdicts, and validates", () => {
  const session = wallSession();
  const run = buildCaseRun({ caseId: "case-a", provenance, measurement: session, skeptic: citingDrafts(session.findings) });
  assert.equal(validateRun(run), null);
  assert.equal(run.findings[0]!.crackLengthMm, session.findings[0]!.crackLengthMm);
  assert.equal(run.findings[0]!.verdict, "CONFIRMED");
  assert.equal(run.receipts!.length, session.receipts.length);
});

test("buildCaseRun refuses a run with empty provenance", () => {
  const session = wallSession();
  assert.throws(() => buildCaseRun({ caseId: "case-a", provenance: { ...provenance, model: "" }, measurement: session }), /provenance/);
});

test("archiveRun writes a file the bench reads, and refuses to overwrite it", () => {
  const dir = mkdtempSync(`${tmpdir()}/bench-`);
  try {
    const url = pathToFileURL(`${dir}/`);
    const run = buildCaseRun({ caseId: "case-a", provenance, measurement: { findings: [], receipts: [] } });
    const path = archiveRun(run, url);
    const out = evaluate({ frozenAt: "x", heldOut: [{ id: "case-a", hasScaleReference: false }] }, [{ name: "case-a.json", text: readFileSync(path, "utf8") }]);
    assert.ok(out.lines.some((l) => l.startsWith("MISSED case-a")));
    assert.throws(() => archiveRun(run, url), /already exists/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archiveRun rejects a caseId that could leave the folder", () => {
  const run = buildCaseRun({ caseId: "ok", provenance, measurement: { findings: [], receipts: [] } });
  assert.throws(() => archiveRun({ ...run, caseId: "../x" }), /unsafe/);
});
