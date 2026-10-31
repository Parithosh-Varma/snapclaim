import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CaseRun, HeldOutCase, Provenance, SplitFile } from "./run.ts";

/** A scaled held-out case with a tape-measured length to score against. */
export type GapCase = HeldOutCase & { groundTruth: { maskId: string; crackLengthMm: number } };

/** Muse Spark looking at the photo alone: one number in mm, or null when it refused to guess. */
export interface ModelOnlyGuess {
  caseId: string;
  provenance: Provenance;
  crackLengthMm: number | null;
}

/** How one arm (pipeline or model-only) did across the scored cases. */
export interface ArmScore {
  /** Cases that produced a number and were compared. */
  scored: number;
  /** null when nothing was scored, never a misleading 0. */
  medianAbsErrorMm: number | null;
  /** Share of scored cases within ±10% of the ground truth, 0..1. */
  withinTenPercent: number | null;
  /** Cases where this arm gave no number. A refusal on a scaled case is a miss, not a pass. */
  refused: string[];
  /** Cases with no archived run or guess at all. */
  missing: string[];
}

export interface GapRow {
  caseId: string;
  truthMm: number;
  /** undefined: no run archived. null: run found the crack but claimed no length. */
  measuredMm: number | null | undefined;
  modelOnlyMm: number | null | undefined;
}

export interface GapScore {
  rows: GapRow[];
  measured: ArmScore;
  modelOnly: ArmScore;
}

type NamedFile = { name: string; text: string };

/** Held-out cases that can be scored for accuracy: scaled, with a ground truth. */
export const gapCases = (heldOut: HeldOutCase[]): GapCase[] =>
  heldOut.filter((c): c is GapCase => c.hasScaleReference && c.groundTruth !== undefined);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function scoreArm(rows: GapRow[], pick: (r: GapRow) => number | null | undefined): ArmScore {
  const errors: number[] = [];
  let within = 0;
  const arm: ArmScore = { scored: 0, medianAbsErrorMm: null, withinTenPercent: null, refused: [], missing: [] };
  for (const r of rows) {
    const v = pick(r);
    if (v === undefined) arm.missing.push(r.caseId);
    else if (v === null) arm.refused.push(r.caseId);
    else {
      const err = Math.abs(v - r.truthMm);
      errors.push(err);
      if (err <= 0.1 * r.truthMm) within++;
    }
  }
  arm.scored = errors.length;
  arm.medianAbsErrorMm = median(errors);
  if (errors.length > 0) arm.withinTenPercent = within / errors.length;
  return arm;
}

/** The pipeline's length for the ground-truth mask, per case. A run without that mask counts as a refusal. */
export function measuredLengths(cases: GapCase[], runs: CaseRun[]): Map<string, number | null> {
  const byCase = new Map(runs.map((r) => [r.caseId, r]));
  const out = new Map<string, number | null>();
  for (const c of cases) {
    const run = byCase.get(c.id);
    if (!run) continue;
    const f = run.findings.find((x) => x.maskId === c.groundTruth.maskId);
    out.set(c.id, f ? f.crackLengthMm : null);
  }
  return out;
}

/**
 * Scores both arms against the same ground truth: median absolute error in mm and the share
 * of cases within ±10%. Refusals and missing runs are listed per arm, not dropped, so a model
 * that answers on two easy photos can't look better than one that answers on all of them.
 */
export function scoreGap(
  cases: GapCase[],
  measured: Map<string, number | null>,
  modelOnly: Map<string, number | null>,
): GapScore {
  const rows: GapRow[] = cases.map((c) => ({
    caseId: c.id,
    truthMm: c.groundTruth.crackLengthMm,
    measuredMm: measured.get(c.id),
    modelOnlyMm: modelOnly.get(c.id),
  }));
  return { rows, measured: scoreArm(rows, (r) => r.measuredMm), modelOnly: scoreArm(rows, (r) => r.modelOnlyMm) };
}

/** Returns an error message, or null when `value` has the shape of a ModelOnlyGuess. */
export function validateGuess(value: unknown): string | null {
  const v = value as Partial<ModelOnlyGuess> | null;
  if (!v || typeof v !== "object") return "not an object";
  if (typeof v.caseId !== "string" || v.caseId === "") return "caseId must be a non-empty string";
  const p = v.provenance as Partial<Provenance> | undefined;
  if (!p || ![p.gitSha, p.model, p.promptVersion, p.timestamp].every((s) => typeof s === "string" && s !== "")) {
    return "provenance needs gitSha, model, promptVersion and timestamp";
  }
  if (v.crackLengthMm !== null && typeof v.crackLengthMm !== "number") return "crackLengthMm must be a number or null";
  return null;
}

export interface GapOutcome {
  lines: string[];
  /** 0 scored or nothing to score yet, 1 a scored case is missing a run or a guess, 2 a file is unreadable. */
  exitCode: number;
}

const fmt = (v: number | null | undefined): string => (v === undefined ? "missing" : v === null ? "refused" : `${v}`);
const armLine = (name: string, a: ArmScore): string =>
  `${name}: scored=${a.scored} medianAbsErrorMm=${a.medianAbsErrorMm ?? "n/a"} ` +
  `within10pct=${a.withinTenPercent === null ? "n/a" : (a.withinTenPercent * 100).toFixed(0) + "%"} ` +
  `refused=${a.refused.length} missing=${a.missing.length}`;

/** Parses run and guess files, scores the gap, and decides the exit code. No file or process access. */
export function evaluateGap(split: SplitFile, runFiles: NamedFile[], guessFiles: NamedFile[]): GapOutcome {
  const lines: string[] = [];
  let bad = false;
  const parse = <T>(files: NamedFile[], validate: (v: unknown) => string | null): T[] => {
    const out: T[] = [];
    for (const f of files) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(f.text);
      } catch (e) {
        lines.push(`BAD ${f.name}: not valid JSON (${(e as Error).message})`);
        bad = true;
        continue;
      }
      const err = validate(parsed);
      if (err) {
        lines.push(`BAD ${f.name}: ${err}`);
        bad = true;
        continue;
      }
      out.push(parsed as T);
    }
    return out;
  };
  // Run files were validated by bench:archive on the way in; a broken one is still reported, not scored.
  const runs = parse<CaseRun>(runFiles, (v) => {
    const r = v as Partial<CaseRun> | null;
    return r && typeof r.caseId === "string" && Array.isArray(r.findings) ? null : "not a CaseRun";
  });
  const guesses = parse<ModelOnlyGuess>(guessFiles, validateGuess);
  const cases = gapCases(split.heldOut);
  if (cases.length === 0) {
    lines.push("UNSCORED: no held-out case has a scale reference and a groundTruth yet; nothing to compare");
    return { lines, exitCode: bad ? 2 : 0 };
  }
  const modelOnly = new Map(guesses.map((g) => [g.caseId, g.crackLengthMm]));
  const score = scoreGap(cases, measuredLengths(cases, runs), modelOnly);
  lines.push(`gap: ${cases.length} scaled cases with ground truth`);
  for (const r of score.rows) {
    lines.push(`${r.caseId}: truth=${r.truthMm} measured=${fmt(r.measuredMm)} modelOnly=${fmt(r.modelOnlyMm)}`);
  }
  lines.push(armLine("measured", score.measured));
  lines.push(armLine("model-only", score.modelOnly));
  const incomplete = score.measured.missing.length > 0 || score.modelOnly.missing.length > 0;
  if (incomplete) {
    lines.push("INCOMPLETE: every scaled case needs one archived run in bench/runs/ and one guess in bench/model-only/");
  }
  return { lines, exitCode: bad ? 2 : incomplete ? 1 : 0 };
}

function readDir(dir: URL): NamedFile[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return names.map((name) => ({ name, text: readFileSync(fileURLToPath(new URL(name, dir)), "utf8") }));
}

/** npm run bench:gap. Reads bench/runs/ (pipeline) and bench/model-only/ (vision-only guesses). */
function main(): void {
  const split = JSON.parse(readFileSync(fileURLToPath(new URL("./split.json", import.meta.url)), "utf8")) as SplitFile;
  const out = evaluateGap(split, readDir(new URL("./runs/", import.meta.url)), readDir(new URL("./model-only/", import.meta.url)));
  for (const l of out.lines) console.log(l);
  process.exitCode = out.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
