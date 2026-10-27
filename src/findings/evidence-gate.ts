import type { Receipt } from "../receipts/types.ts";

export interface FindingDraft {
  statement: string;
  citations: string[];
}

export interface GateResult {
  ok: boolean;
  failures: string[];
}

export class EvidenceError extends Error {
  readonly failures: string[];

  constructor(failures: string[]) {
    super(`Evidence gate failed:\n- ${failures.join("\n- ")}`);
    this.name = "EvidenceError";
    this.failures = failures;
  }
}

const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/g;

function numbersIn(statement: string): number[] {
  return [...statement.matchAll(NUMBER_PATTERN)].map((match) => Number(match[0]));
}

/** A number is backed when it matches a cited receipt output within rounding tolerance. */
function matchesReceipt(token: number, value: number): boolean {
  const tolerance = Math.max(0.011, Math.abs(value) * 0.01);
  return Math.abs(token - value) <= tolerance;
}

function unitFailures(statement: string, cited: Receipt[]): string[] {
  const failures: string[] = [];
  const units = new Set(cited.map((receipt) => receipt.output.unit));

  if (/(?:\d\s*)%|percent\b/i.test(statement) && !units.has("percent")) {
    failures.push(`statement cites a percentage without a cited percent receipt: "${statement}"`);
  }
  if (/mm\b/i.test(statement) && !units.has("mm")) {
    failures.push(`statement cites millimetres without a cited calibrated-length receipt: "${statement}"`);
  }
  if (/(?:cm|cm2|cm²|m2|m²)\b/i.test(statement)) {
    failures.push(`statement uses a unit this engine never emits (use mm or %): "${statement}"`);
  }

  return failures;
}

function validateFinding(
  draft: FindingDraft,
  receipts: Map<string, Receipt>,
  index: number,
): string[] {
  const label = `finding[${index}]`;
  const failures: string[] = [];

  if (draft.statement.trim() === "") {
    failures.push(`${label}: statement is empty`);
  }
  if (draft.citations.length === 0) {
    failures.push(`${label}: no citations`);
  }

  const cited: Receipt[] = [];
  for (const id of draft.citations) {
    const receipt = receipts.get(id);
    if (receipt === undefined) {
      failures.push(`${label}: cites unknown receipt "${id}"`);
    } else {
      cited.push(receipt);
    }
  }

  if (cited.length === 0) {
    return failures;
  }

  const numericOutputs = cited
    .map((receipt) => receipt.output.value)
    .filter((value): value is number => typeof value === "number");

  for (const token of numbersIn(draft.statement)) {
    const backed = numericOutputs.some((value) => matchesReceipt(token, value));
    if (!backed) {
      failures.push(`${label}: number ${token} is not backed by any cited receipt`);
    }
  }

  for (const failure of unitFailures(draft.statement, cited)) {
    failures.push(`${label}: ${failure}`);
  }

  return failures;
}

export function validateFindings(drafts: FindingDraft[], receipts: Receipt[]): GateResult {
  const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const failures = drafts.flatMap((draft, index) => validateFinding(draft, byId, index));
  return { ok: failures.length === 0, failures };
}

/**
 * The gate that keeps the language model honest.
 * Every number in a finding must exist in a cited receipt, and absolute units
 * require a calibrated-length receipt. Failures throw instead of shipping.
 */
export function gateFindings(drafts: FindingDraft[], receipts: Receipt[]): FindingDraft[] {
  const result = validateFindings(drafts, receipts);
  if (!result.ok) {
    throw new EvidenceError(result.failures);
  }
  return drafts;
}
