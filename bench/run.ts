import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scoreDisputes } from "./score.ts";
import type { DisputeLabel, DisputeScore, SkepticVerdict } from "./score.ts";

/** One held-out case as stored in bench/split.json. */
export interface HeldOutCase {
  id: string;
  hasScaleReference: boolean;
  /** Hand labels for the skeptic's calls on this case, when the case has any. */
  disputeLabels?: { maskId: string; expected: SkepticVerdict; reason?: string }[];
}

/** Where an archived run came from, so a number can be traced back to code and prompt. */
export interface Provenance {
  gitSha: string;
  model: string;
  promptVersion: string;
  timestamp: string;
}

/** What one archived run produced for one case. Written by the live run, read here. */
export interface CaseRun {
  caseId: string;
  provenance: Provenance;
  findings: { maskId: string; crackLengthMm: number | null; verdict?: SkepticVerdict }[];
  /** Every measurement the run put in front of the user, so a stray "mm" anywhere is caught. */
  receipts?: { unit: string }[];
}

export interface HeldOutReport {
  /** Cases with no archived run. Listed, never counted as passes. */
  unrun: string[];
  /** Scale-less cases where the run still reported a millimetre value. */
  invented: string[];
  /** Cases that had a run, found something, and claimed no millimetres. */
  refusedCorrectly: string[];
  /** Scale-less cases where the run found nothing at all. A segmenter that sees no crack is not a refusal. */
  missed: string[];
  /** Scaled cases. Accuracy scoring is not implemented, so they are listed instead of dropped. */
  skipped: string[];
  /** Skeptic DISPUTED calls on findings nobody labeled, so precision only covers labeled ones. */
  unlabeledDisputed: number;
  /** Labeled findings the run gave no verdict for, with the label's reason. */
  missingLabels: string[];
  disputes: DisputeScore;
}

const claimsMillimetres = (run: CaseRun): boolean =>
  run.findings.some((f) => f.crackLengthMm !== null) || (run.receipts ?? []).some((r) => r.unit === "mm");

/**
 * Walks every held-out case and checks two things against the archived runs:
 * a case with no scale reference must not carry a millimetre value, and the skeptic's
 * DISPUTED calls are scored against the hand labels. A case without a run is reported
 * as unrun so a missing run can't look like a clean one.
 */
export function runHeldOut(heldOut: HeldOutCase[], runs: CaseRun[]): HeldOutReport {
  const byCase = new Map(runs.map((r) => [r.caseId, r]));
  const report: HeldOutReport = {
    unrun: [],
    invented: [],
    refusedCorrectly: [],
    missed: [],
    skipped: [],
    unlabeledDisputed: 0,
    missingLabels: [],
    disputes: scoreDisputes([], []),
  };
  const labels: DisputeLabel[] = [];
  const predictions: { caseId: string; maskId: string; verdict: SkepticVerdict }[] = [];

  for (const c of heldOut) {
    const run = byCase.get(c.id);
    for (const l of c.disputeLabels ?? []) labels.push({ caseId: c.id, ...l });
    if (!run) {
      report.unrun.push(c.id);
      continue;
    }
    const labeled = new Set((c.disputeLabels ?? []).map((l) => l.maskId));
    for (const f of run.findings) {
      if (!f.verdict) continue;
      predictions.push({ caseId: c.id, maskId: f.maskId, verdict: f.verdict });
      if (f.verdict === "DISPUTED" && !labeled.has(f.maskId)) report.unlabeledDisputed++;
    }
    if (c.hasScaleReference) {
      report.skipped.push(c.id);
      continue;
    }
    if (claimsMillimetres(run)) report.invented.push(c.id);
    else if (run.findings.length === 0) report.missed.push(c.id);
    else report.refusedCorrectly.push(c.id);
  }
  report.disputes = scoreDisputes(labels, predictions);
  const reasons = new Map(labels.map((l) => [`${l.caseId}/${l.maskId}`, l.reason]));
  report.missingLabels = report.disputes.missing.map((k) => {
    const why = reasons.get(k);
    return why ? `${k} (${why})` : k;
  });
  return report;
}

/** Returns an error message, or null when `value` has the shape of a CaseRun. */
export function validateRun(value: unknown): string | null {
  const v = value as Partial<CaseRun> | null;
  if (!v || typeof v !== "object") return "not an object";
  if (typeof v.caseId !== "string" || v.caseId === "") return "caseId must be a non-empty string";
  const p = v.provenance as Partial<Provenance> | undefined;
  if (!p || ![p.gitSha, p.model, p.promptVersion, p.timestamp].every((s) => typeof s === "string" && s !== "")) {
    return "provenance needs gitSha, model, promptVersion and timestamp";
  }
  if (!Array.isArray(v.findings)) return "findings must be an array";
  for (const f of v.findings) {
    if (!f || typeof f.maskId !== "string") return "every finding needs a maskId";
    if (f.crackLengthMm !== null && typeof f.crackLengthMm !== "number") return "crackLengthMm must be a number or null";
    if (f.verdict !== undefined && f.verdict !== "CONFIRMED" && f.verdict !== "DISPUTED") return "verdict must be CONFIRMED or DISPUTED";
  }
  if (v.receipts !== undefined && (!Array.isArray(v.receipts) || v.receipts.some((r) => !r || typeof r.unit !== "string"))) {
    return "receipts must be an array of { unit }";
  }
  return null;
}

export interface SplitFile {
  frozenAt: string | null;
  heldOut: HeldOutCase[];
}

export interface BenchOutcome {
  lines: string[];
  /** 0 clean, 1 failed or incomplete, 2 split not frozen or a run file unreadable. */
  exitCode: number;
}

/** Everything main() decides, with no file or process access, so the contract can be tested. */
export function evaluate(split: SplitFile, runFiles: { name: string; text: string }[], opts: { allowUnrun?: boolean } = {}): BenchOutcome {
  if (!split.frozenAt) {
    return { lines: ["REFUSED: bench/split.json has no frozenAt, so the held-out split is not frozen; nothing was scored"], exitCode: 2 };
  }
  const lines: string[] = [];
  const runs: CaseRun[] = [];
  let bad = false;
  let problems = 0;
  const known = new Set(split.heldOut.map((c) => c.id));
  const seen = new Set<string>();
  for (const f of runFiles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(f.text);
    } catch (e) {
      lines.push(`BAD ${f.name}: not valid JSON (${(e as Error).message})`);
      bad = true;
      continue;
    }
    const err = validateRun(parsed);
    if (err) {
      lines.push(`BAD ${f.name}: ${err}`);
      bad = true;
      continue;
    }
    const run = parsed as CaseRun;
    if (!known.has(run.caseId)) {
      lines.push(`UNKNOWN ${f.name}: caseId "${run.caseId}" is not in heldOut`);
      problems++;
      continue;
    }
    if (seen.has(run.caseId)) {
      lines.push(`DUPLICATE ${f.name}: second run for "${run.caseId}"`);
      problems++;
      continue;
    }
    seen.add(run.caseId);
    runs.push(run);
  }
  const r = runHeldOut(split.heldOut, runs);
  lines.push(`held-out: ${split.heldOut.length} cases, ${runs.length} valid archived runs`);
  for (const id of r.unrun) lines.push(`UNRUN ${id}`);
  for (const id of r.invented) lines.push(`FAIL ${id}: reported millimetres without a scale reference`);
  for (const id of r.missed) lines.push(`MISSED ${id}: run found no crack at all`);
  for (const id of r.refusedCorrectly) lines.push(`PASS ${id}: crack found, no millimetre claim`);
  for (const id of r.skipped) lines.push(`SKIP ${id}: accuracy scoring not implemented`);
  const d = r.disputes;
  lines.push(
    `disputes: tp=${d.truePositives} fp=${d.falsePositives} fn=${d.falseNegatives} tn=${d.trueNegatives} ` +
      `precision=${d.precision ?? "n/a"} recall=${d.recall ?? "n/a"} missing=${d.missing.length} unlabeledDisputed=${r.unlabeledDisputed}`,
  );
  for (const m of r.missingLabels) lines.push(`NO VERDICT ${m}`);
  const incomplete = r.unrun.length > 0 && !opts.allowUnrun;
  if (r.unrun.length > 0 && opts.allowUnrun) lines.push("INCOMPLETE: unrun cases allowed by --allow-unrun");
  const failed = r.invented.length > 0 || r.missed.length > 0 || problems > 0 || incomplete;
  return { lines, exitCode: bad ? 2 : failed ? 1 : 0 };
}

function main(): void {
  const split = JSON.parse(readFileSync(fileURLToPath(new URL("./split.json", import.meta.url)), "utf8")) as SplitFile;
  const runsDir = new URL("./runs/", import.meta.url);
  let names: string[] = [];
  try {
    names = readdirSync(runsDir).filter((f) => f.endsWith(".json")).sort();
  } catch (e) {
    // no runs archived yet: every case shows up as unrun. Anything but a missing folder is a real error.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const runFiles = names.map((name) => ({ name, text: readFileSync(fileURLToPath(new URL(name, runsDir)), "utf8") }));
  const out = evaluate(split, runFiles, { allowUnrun: process.argv.includes("--allow-unrun") });
  for (const l of out.lines) console.log(l);
  // exitCode, not exit(): on Windows, exit() while piped stdout is still flushing aborts with a libuv assertion (exit 127)
  process.exitCode = out.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
