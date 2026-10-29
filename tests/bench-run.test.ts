import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluate, runHeldOut, validateRun } from "../bench/run.ts";
import type { CaseRun, SplitFile } from "../bench/run.ts";

const provenance = { gitSha: "abc1234", model: "spark-open", promptVersion: "p1", timestamp: "2026-10-28T18:00:00+03:00" };
const run = (caseId: string, findings: CaseRun["findings"], receipts?: CaseRun["receipts"]): CaseRun => ({
  caseId,
  provenance,
  findings,
  receipts,
});
const split = (ids: string[], frozenAt: string | null = "2026-10-28T18:00:00+03:00"): SplitFile => ({
  frozenAt,
  heldOut: ids.map((id) => ({ id, hasScaleReference: false })),
});
const file = (name: string, value: unknown) => ({ name, text: JSON.stringify(value) });

test("a scale-less case with a millimetre value is flagged as invented", () => {
  const r = runHeldOut(
    [{ id: "a", hasScaleReference: false }, { id: "b", hasScaleReference: false }],
    [run("a", [{ maskId: "m", crackLengthMm: 12 }]), run("b", [{ maskId: "m", crackLengthMm: null }])],
  );
  assert.deepEqual(r.invented, ["a"]);
  assert.deepEqual(r.refusedCorrectly, ["b"]);
});

test("a millimetre receipt counts even when no finding carries a length", () => {
  const r = runHeldOut([{ id: "a", hasScaleReference: false }], [run("a", [{ maskId: "m", crackLengthMm: null }], [{ unit: "mm" }])]);
  assert.deepEqual(r.invented, ["a"]);
});

test("a run with no findings is missed, not a correct refusal", () => {
  const r = runHeldOut([{ id: "a", hasScaleReference: false }], [run("a", [])]);
  assert.deepEqual(r.missed, ["a"]);
  assert.deepEqual(r.refusedCorrectly, []);
});

test("a case with no archived run is unrun, not a pass", () => {
  const r = runHeldOut([{ id: "a", hasScaleReference: false }], []);
  assert.deepEqual(r.unrun, ["a"]);
  assert.deepEqual(r.refusedCorrectly, []);
});

test("a scaled case may carry millimetres and is listed as skipped", () => {
  const r = runHeldOut([{ id: "a", hasScaleReference: true }], [run("a", [{ maskId: "m", crackLengthMm: 40 }])]);
  assert.deepEqual(r.invented, []);
  assert.deepEqual(r.skipped, ["a"]);
});

test("dispute labels on a held-out case are scored against the run's verdicts", () => {
  const r = runHeldOut(
    [{ id: "a", hasScaleReference: true, disputeLabels: [{ maskId: "m", expected: "DISPUTED" }] }],
    [run("a", [{ maskId: "m", crackLengthMm: 40, verdict: "DISPUTED" }])],
  );
  assert.equal(r.disputes.truePositives, 1);
  assert.equal(r.disputes.recall, 1);
});

test("DISPUTED calls on unlabeled findings are counted, and missing labels carry their reason", () => {
  const r = runHeldOut(
    [{ id: "a", hasScaleReference: true, disputeLabels: [{ maskId: "gone", expected: "DISPUTED", reason: "coin occluded" }] }],
    [run("a", [{ maskId: "other", crackLengthMm: 5, verdict: "DISPUTED" }])],
  );
  assert.equal(r.unlabeledDisputed, 1);
  assert.deepEqual(r.missingLabels, ["a/gone (coin occluded)"]);
});

test("validateRun rejects a missing provenance and a bad verdict", () => {
  assert.equal(validateRun(run("a", [])), null);
  assert.match(validateRun({ caseId: "a", findings: [] }) ?? "", /provenance/);
  assert.match(validateRun(run("a", [{ maskId: "m", crackLengthMm: null, verdict: "MAYBE" as never }])) ?? "", /verdict/);
});

test("a null frozenAt refuses to score", () => {
  const out = evaluate(split(["a"], null), []);
  assert.equal(out.exitCode, 2);
  assert.match(out.lines[0] ?? "", /REFUSED/);
});

test("all-UNRUN exits 1 by default and 0 with allowUnrun", () => {
  assert.equal(evaluate(split(["a"]), []).exitCode, 1);
  assert.equal(evaluate(split(["a"]), [], { allowUnrun: true }).exitCode, 0);
});

test("a clean run exits 0 and an empty finding list exits 1", () => {
  assert.equal(evaluate(split(["a"]), [file("a.json", run("a", [{ maskId: "m", crackLengthMm: null }]))]).exitCode, 0);
  assert.equal(evaluate(split(["a"]), [file("a.json", run("a", []))]).exitCode, 1);
});

test("a scaled case prints a SKIP line", () => {
  const s: SplitFile = { frozenAt: "2026-10-28T18:00:00+03:00", heldOut: [{ id: "a", hasScaleReference: true }] };
  const out = evaluate(s, [file("a.json", run("a", [{ maskId: "m", crackLengthMm: 40 }]))]);
  assert.ok(out.lines.some((l) => l.startsWith("SKIP a")));
});

test("a malformed run file names the file and exits 2", () => {
  const out = evaluate(split(["a"]), [{ name: "broken.json", text: "{nope" }]);
  assert.equal(out.exitCode, 2);
  assert.match(out.lines[0] ?? "", /BAD broken\.json/);
});

test("unknown and duplicate caseIds are reported and fail the run", () => {
  const ok = run("a", [{ maskId: "m", crackLengthMm: null }]);
  const out = evaluate(split(["a"]), [file("a.json", ok), file("a2.json", ok), file("z.json", run("z", []))]);
  assert.equal(out.exitCode, 1);
  assert.ok(out.lines.some((l) => l.startsWith("DUPLICATE a2.json")));
  assert.ok(out.lines.some((l) => l.startsWith("UNKNOWN z.json")));
});

// Golden digests: a held-out case that is edited after the freeze changes its hash and fails here.
// Adding a case is fine (add its line); changing or removing one is the thing this catches.
const FROZEN_DIGESTS: Record<string, string> = {
  "public-ruin-wall-crack-01": "b35d3dea8474857d454349182349237390a4ddb8c795cef79f580649798d4121",
  "public-stone-wall-crack-02": "e396b15cbafacf8a67bdb7bea5c889c813d8dade8c9dc9a17c616a4ca8c96ffa",
  "public-interior-wall-cracks-03": "50a1e217fd31196f8447ab6d3676457bf2685ce4ca9ec54887a48c215e613d5d",
  "public-cracked-tile-04": "c64dd070b738d7fc1a3104be11468e18360a0cacad5e92632fba72d92fed6823",
};

test("every frozen held-out case still hashes to its frozen digest", () => {
  const s = JSON.parse(readFileSync(new URL("../bench/split.json", import.meta.url), "utf8")) as SplitFile;
  assert.ok(s.frozenAt, "split.json must have frozenAt set");
  const now = new Map(s.heldOut.map((c) => [c.id, createHash("sha256").update(JSON.stringify(c)).digest("hex")]));
  for (const [id, digest] of Object.entries(FROZEN_DIGESTS)) assert.equal(now.get(id), digest, `held-out case ${id} changed after the freeze`);
});
