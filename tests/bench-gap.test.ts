import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateGap, gapCases, measuredLengths, scoreGap, validateGuess } from "../bench/gap.ts";
import type { GapCase } from "../bench/gap.ts";
import type { CaseRun, SplitFile } from "../bench/run.ts";

const provenance = { gitSha: "abc1234", model: "spark-open", promptVersion: "p1", timestamp: "2026-10-30T00:00:00+03:00" };
const gapCase = (id: string, mm: number): GapCase => ({
  id,
  hasScaleReference: true,
  groundTruth: { maskId: "crack-1", crackLengthMm: mm },
});
const run = (caseId: string, findings: CaseRun["findings"]): CaseRun => ({ caseId, provenance, findings });
const file = (name: string, value: unknown) => ({ name, text: JSON.stringify(value) });
const split = (heldOut: SplitFile["heldOut"]): SplitFile => ({ frozenAt: "2026-10-28T18:00:00+03:00", heldOut });

test("only scaled cases with a ground truth are scored", () => {
  const cases = gapCases([
    { id: "scaled", hasScaleReference: true, groundTruth: { maskId: "m", crackLengthMm: 100 } },
    { id: "no-truth", hasScaleReference: true },
    { id: "no-scale", hasScaleReference: false, groundTruth: { maskId: "m", crackLengthMm: 100 } },
  ]);
  assert.deepEqual(cases.map((c) => c.id), ["scaled"]);
});

test("median absolute error and the ±10% share are computed per arm", () => {
  const cases = [gapCase("a", 100), gapCase("b", 200), gapCase("c", 50)];
  const measured = new Map<string, number | null>([["a", 105], ["b", 190], ["c", 80]]);
  const modelOnly = new Map<string, number | null>([["a", 150], ["b", 100], ["c", 52]]);
  const s = scoreGap(cases, measured, modelOnly);
  assert.equal(s.measured.scored, 3);
  assert.equal(s.measured.medianAbsErrorMm, 10);
  assert.equal(s.measured.withinTenPercent, 2 / 3);
  assert.equal(s.modelOnly.medianAbsErrorMm, 50);
  assert.equal(s.modelOnly.withinTenPercent, 1 / 3);
});

test("an even number of errors takes the mean of the two middle ones", () => {
  const s = scoreGap([gapCase("a", 100), gapCase("b", 100)], new Map([["a", 110], ["b", 130]]), new Map());
  assert.equal(s.measured.medianAbsErrorMm, 20);
});

test("a refusal and a missing run are listed, not scored, and leave the stats at null", () => {
  const s = scoreGap([gapCase("a", 100), gapCase("b", 100)], new Map([["a", null]]), new Map());
  assert.deepEqual(s.measured.refused, ["a"]);
  assert.deepEqual(s.measured.missing, ["b"]);
  assert.equal(s.measured.scored, 0);
  assert.equal(s.measured.medianAbsErrorMm, null);
  assert.equal(s.measured.withinTenPercent, null);
  assert.deepEqual(s.modelOnly.missing, ["a", "b"]);
});

test("the measured length comes from the ground-truth mask; a run without it is a refusal", () => {
  const cases = [gapCase("a", 100), gapCase("b", 100)];
  const m = measuredLengths(cases, [
    run("a", [{ maskId: "other", crackLengthMm: 5 }, { maskId: "crack-1", crackLengthMm: 97 }]),
    run("b", [{ maskId: "other", crackLengthMm: 5 }]),
  ]);
  assert.equal(m.get("a"), 97);
  assert.equal(m.get("b"), null);
});

test("validateGuess rejects a guess with no provenance or a non-numeric length", () => {
  assert.equal(validateGuess({ caseId: "a", provenance, crackLengthMm: 12 }), null);
  assert.equal(validateGuess({ caseId: "a", provenance, crackLengthMm: null }), null);
  assert.match(validateGuess({ caseId: "a", crackLengthMm: 12 }) ?? "", /provenance/);
  assert.match(validateGuess({ caseId: "a", provenance, crackLengthMm: "12" }) ?? "", /crackLengthMm/);
});

test("a split with no scaled case prints UNSCORED and exits 0", () => {
  const out = evaluateGap(split([{ id: "a", hasScaleReference: false }]), [], []);
  assert.equal(out.exitCode, 0);
  assert.match(out.lines[0] ?? "", /^UNSCORED/);
});

test("a scored case without a run or a guess is INCOMPLETE and exits 1", () => {
  const out = evaluateGap(
    split([gapCase("a", 100), gapCase("b", 100)]),
    [file("a.json", run("a", [{ maskId: "crack-1", crackLengthMm: 101 }]))],
    [file("a.json", { caseId: "a", provenance, crackLengthMm: 140 })],
  );
  assert.equal(out.exitCode, 1);
  assert.ok(out.lines.includes("a: truth=100 measured=101 modelOnly=140"));
  assert.ok(out.lines.includes("b: truth=100 measured=missing modelOnly=missing"));
  assert.ok(out.lines.some((l) => l.startsWith("INCOMPLETE")));
});

test("a complete set exits 0 and a bad guess file exits 2", () => {
  const s = split([gapCase("a", 100)]);
  const runs = [file("a.json", run("a", [{ maskId: "crack-1", crackLengthMm: 101 }]))];
  const ok = evaluateGap(s, runs, [file("a.json", { caseId: "a", provenance, crackLengthMm: null })]);
  assert.equal(ok.exitCode, 0);
  assert.ok(ok.lines.some((l) => l.startsWith("model-only: scored=0") && l.includes("refused=1")));
  const bad = evaluateGap(s, runs, [{ name: "a.json", text: "{not json" }]);
  assert.equal(bad.exitCode, 2);
  assert.match(bad.lines[0] ?? "", /^BAD a\.json/);
});
