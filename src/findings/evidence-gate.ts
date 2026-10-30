import type { Receipt } from "../receipts/types.ts";

export interface FindingDraft {
  statement: string;
  citations: string[];
}

export interface GateResult {
  ok: boolean;
  failures: string[];
}

/** Request-size caps: the gate does tokens×receipts work per finding, so a
 * 1 MB statement would be ~500k tokens → tens of millions of comparisons
 * synchronously. Reject oversized input with 400 before measuring. */
export const MAX_DRAFTS = 64;
export const MAX_STATEMENT_CHARS = 2000;
export const MAX_CITATIONS_PER_FINDING = 32;

export class EvidenceError extends Error {
  readonly failures: string[];

  constructor(failures: string[]) {
    super(`Evidence gate failed:\n- ${failures.join("\n- ")}`);
    this.name = "EvidenceError";
    this.failures = failures;
  }
}

const NUMBER_PATTERN = /(?<![A-Za-z])\d+(?:\.\d+)?/g;
const ISO_DATE_PATTERN = /\b\d{4}-\d{1,2}-\d{1,2}\b/g;
const TIME_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

function stripDates(statement: string): string {
  return statement.replace(ISO_DATE_PATTERN, " ").replace(TIME_PATTERN, " ");
}

function numbersIn(statement: string): number[] {
  return [...stripDates(statement).matchAll(NUMBER_PATTERN)].map((match) => Number(match[0]));
}

/** A number is backed when it matches a cited receipt output within rounding tolerance. */
function matchesReceipt(token: number, value: number): boolean {
  const tolerance = Math.max(0.011, Math.abs(value) * 0.01);
  return Math.abs(token - value) <= tolerance;
}

function severityWords(statement: string): string[] {
  const found: string[] = [];
  for (const band of ["cosmetic", "moderate", "significant"]) {
    if (new RegExp(`\\b${band}\\b`, "i").test(statement)) found.push(band);
  }
  return found;
}

function maskIdsOf(cited: Receipt[]): string[] {
  const ids: string[] = [];
  for (const receipt of cited) {
    const maskId = receipt.inputs["maskId"];
    if (typeof maskId === "string" && maskId !== "") ids.push(maskId);
  }
  return [...new Set(ids)];
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
  if (/(?<![a-z])m2\b|m²\b/i.test(statement)) {
    failures.push(`statement uses square metres, which this engine never emits (use mm or cm²): "${statement}"`);
  }
  if (/\bcm\b(?!2)/i.test(statement) && !/cm2|cm²/i.test(statement)) {
    failures.push(`statement uses centimetres, which this engine never emits (use mm or cm²): "${statement}"`);
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
  const percentOutputs = cited
    .filter((receipt) => receipt.output.unit === "percent")
    .map((receipt) => receipt.output.value)
    .filter((value): value is number => typeof value === "number");
  const mmOutputs = cited
    .filter((receipt) => receipt.output.unit === "mm")
    .map((receipt) => receipt.output.value)
    .filter((value): value is number => typeof value === "number");
  const cm2Outputs = cited
    .filter((receipt) => receipt.output.unit === "cm2")
    .map((receipt) => receipt.output.value)
    .filter((value): value is number => typeof value === "number");

  const tokens = numbersIn(draft.statement);
  // Every finding must cite at least one measured number. Qualitative-only
  // sentences ("the crack is serious") pass no evidence, so they fail.
  if (tokens.length === 0) {
    failures.push(`${label}: no measured number cited — every finding must cite a receipt value`);
  }
  for (const token of tokens) {
    const backed = numericOutputs.some((value) => matchesReceipt(token, value));
    if (!backed) {
      failures.push(`${label}: number ${token} is not backed by any cited receipt`);
    }
  }

  for (const failure of unitFailures(draft.statement, cited)) {
    failures.push(`${label}: ${failure}`);
  }

  // Per-unit backing: a % number must match a cited percent receipt,
  // an mm number must match a cited calibrated-length receipt.
  if (/(?:\d\s*)%|percent\b/i.test(draft.statement) && tokens.length > 0 && percentOutputs.length > 0) {
    const backedByPercent = tokens.some((token) => percentOutputs.some((value) => matchesReceipt(token, value)));
    if (!backedByPercent) {
      failures.push(`${label}: percentage has no matching cited percent receipt`);
    }
  }
  if (/mm\b/i.test(draft.statement) && tokens.length > 0 && mmOutputs.length > 0) {
    const backedByMm = tokens.some((token) => mmOutputs.some((value) => matchesReceipt(token, value)));
    if (!backedByMm) {
      failures.push(`${label}: millimetre value does not match any cited calibrated-length receipt`);
    }
  }
  if (/cm2|cm²/i.test(draft.statement) && tokens.length > 0 && cm2Outputs.length > 0) {
    const backedByCm2 = tokens.some((token) => cm2Outputs.some((value) => matchesReceipt(token, value)));
    if (!backedByCm2) {
      failures.push(`${label}: cm² value does not match any cited calibrated-area receipt`);
    }
  }

  // One finding, one mask: citing receipts from two different masks mixes evidence.
  const maskIds = maskIdsOf(cited);
  if (maskIds.length > 1) {
    failures.push(`${label}: cites receipts from multiple masks (${maskIds.join(", ")}) — one finding per mask`);
  }

  // Severity words must agree with the cited severity receipt.
  const words = severityWords(draft.statement);
  if (words.length > 0) {
    const severityReceipts = cited.filter((receipt) => receipt.method === "severity_classification");
    if (severityReceipts.length === 0) {
      failures.push(`${label}: severity word without a cited severity receipt`);
    } else {
      const values = new Set(severityReceipts.map((receipt) => String(receipt.output.value).toLowerCase()));
      for (const word of words) {
        if (!values.has(word)) {
          failures.push(
            `${label}: severity word "${word}" contradicts cited severity (${[...values].join(", ")})`,
          );
        }
      }
    }
  }

  return failures;
}

export function validateFindings(drafts: FindingDraft[], receipts: Receipt[]): GateResult {
  const list = Array.isArray(drafts) ? drafts : [];
  if (list.length > MAX_DRAFTS) {
    return { ok: false, failures: [`too many findings: ${list.length} > ${MAX_DRAFTS}`] };
  }
  const preflight: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const draft = list[i] as FindingDraft;
    if (typeof draft?.statement !== "string" || !Array.isArray((draft as FindingDraft)?.citations)) {
      preflight.push(`finding[${i}]: must be {statement: string, citations: string[]}`);
      continue;
    }
    if (draft.statement.length > MAX_STATEMENT_CHARS) {
      preflight.push(`finding[${i}]: statement is ${draft.statement.length} chars, capped at ${MAX_STATEMENT_CHARS}`);
    }
    if (draft.citations.length > MAX_CITATIONS_PER_FINDING) {
      preflight.push(`finding[${i}]: citations capped at ${MAX_CITATIONS_PER_FINDING}`);
    }
  }
  if (preflight.length > 0) return { ok: false, failures: preflight };
  const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const failures = list.flatMap((draft, index) => validateFinding(draft, byId, index));
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
