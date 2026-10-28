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

/** What one archived run produced for one case. Written by the live run, read here. */
export interface CaseRun {
  caseId: string;
  findings: { maskId: string; crackLengthMm: number | null; verdict?: SkepticVerdict }[];
}

export interface HeldOutReport {
  /** Cases with no archived run. Listed, never counted as passes. */
  unrun: string[];
  /** Scale-less cases where the run still reported a millimetre value. */
  invented: string[];
  /** Cases that had a run and no invented millimetres. */
  refusedCorrectly: string[];
  disputes: DisputeScore;
}

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
    for (const f of run.findings) {
      if (f.verdict) predictions.push({ caseId: c.id, maskId: f.maskId, verdict: f.verdict });
    }
    if (c.hasScaleReference) continue;
    if (run.findings.some((f) => f.crackLengthMm !== null)) report.invented.push(c.id);
    else report.refusedCorrectly.push(c.id);
  }
  report.disputes = scoreDisputes(labels, predictions);
  return report;
}

function main(): void {
  const split = JSON.parse(readFileSync(fileURLToPath(new URL("./split.json", import.meta.url)), "utf8")) as {
    heldOut: HeldOutCase[];
  };
  const runsDir = new URL("./runs/", import.meta.url);
  let files: string[] = [];
  try {
    files = readdirSync(runsDir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    // no runs archived yet: every case shows up as unrun
  }
  const runs = files.map((f) => JSON.parse(readFileSync(fileURLToPath(new URL(f, runsDir)), "utf8")) as CaseRun);
  const r = runHeldOut(split.heldOut, runs);
  console.log(`held-out: ${split.heldOut.length} cases, ${runs.length} archived runs`);
  for (const id of r.unrun) console.log(`UNRUN ${id}`);
  for (const id of r.invented) console.log(`FAIL ${id}: reported millimetres without a scale reference`);
  for (const id of r.refusedCorrectly) console.log(`PASS ${id}: no millimetre claim`);
  const d = r.disputes;
  console.log(
    `disputes: tp=${d.truePositives} fp=${d.falsePositives} fn=${d.falseNegatives} tn=${d.trueNegatives} ` +
      `precision=${d.precision ?? "n/a"} recall=${d.recall ?? "n/a"} missing=${d.missing.length}`,
  );
  if (r.invented.length > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
