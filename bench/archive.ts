import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MeasuredFinding } from "../src/engine/types.ts";
import type { FindingDraft } from "../src/findings/evidence-gate.ts";
import type { Receipt } from "../src/receipts/types.ts";
import { validateRun } from "./run.ts";
import type { CaseRun, Provenance } from "./run.ts";
import type { SkepticVerdict } from "./score.ts";

const receiptIdsOf = (f: MeasuredFinding): string[] => Object.values(f.receiptIds).filter((id): id is string => id !== null);

/**
 * Reads the skeptic's free-text drafts as one verdict per measured finding.
 * A draft that cites any of a finding's receipts and says DISPUTED disputes it; a finding the
 * skeptic cited without disputing is CONFIRMED; a finding it never cited gets no verdict,
 * so the bench reports it as missing instead of guessing.
 */
export function verdictsFromSkeptic(findings: MeasuredFinding[], drafts: FindingDraft[]): Map<string, SkepticVerdict> {
  const out = new Map<string, SkepticVerdict>();
  for (const f of findings) {
    const mine = new Set(receiptIdsOf(f));
    const about = drafts.filter((d) => d.citations.some((c) => mine.has(c)));
    if (about.length === 0) continue;
    out.set(f.maskId, about.some((d) => /\bDISPUTED\b/.test(d.statement)) ? "DISPUTED" : "CONFIRMED");
  }
  return out;
}

export interface ArchiveInput {
  caseId: string;
  provenance: Provenance;
  measurement: { findings: MeasuredFinding[]; receipts: Receipt[] };
  /** Skeptic drafts from /v1/skeptic. Omit for a run that never reached the skeptic. */
  skeptic?: FindingDraft[];
}

/** Turns one pipeline result into the CaseRun the bench reads. Throws if the result isn't a valid run. */
export function buildCaseRun(input: ArchiveInput): CaseRun {
  const verdicts = verdictsFromSkeptic(input.measurement.findings, input.skeptic ?? []);
  const run: CaseRun = {
    caseId: input.caseId,
    provenance: input.provenance,
    findings: input.measurement.findings.map((f) => {
      const verdict = verdicts.get(f.maskId);
      return { maskId: f.maskId, crackLengthMm: f.crackLengthMm, ...(verdict ? { verdict } : {}) };
    }),
    receipts: input.measurement.receipts.map((r) => ({ unit: r.output.unit })),
  };
  const err = validateRun(run);
  if (err) throw new Error(`archive: ${err}`);
  return run;
}

/** Writes bench/runs/<caseId>.json. Never overwrites: a second run for a case is a decision, not an accident. */
export function archiveRun(run: CaseRun, dir: URL = new URL("./runs/", import.meta.url)): string {
  if (!/^[\w.-]+$/.test(run.caseId)) throw new Error(`archive: unsafe caseId "${run.caseId}"`);
  mkdirSync(fileURLToPath(dir), { recursive: true });
  const path = fileURLToPath(new URL(`${run.caseId}.json`, dir));
  if (existsSync(path)) throw new Error(`archive: ${path} already exists; move it aside to re-run`);
  writeFileSync(path, JSON.stringify(run, null, 2) + "\n");
  return path;
}

/**
 * npm run bench:archive -- <caseId> <input.json>
 * input.json: { provenance, measurement: { findings, receipts }, skeptic?: [{ statement, citations }] }
 */
function main(): void {
  const [caseId, file] = process.argv.slice(2);
  if (!caseId || !file) {
    console.error("usage: npm run bench:archive -- <caseId> <input.json>");
    process.exit(2);
  }
  const input = JSON.parse(readFileSync(file, "utf8")) as Omit<ArchiveInput, "caseId">;
  console.log(archiveRun(buildCaseRun({ ...input, caseId })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
