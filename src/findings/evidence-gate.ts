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

const NUMBER_PATTERN = /(?<![A-Za-z0-9_])[-+]?\d+(?:\.\d+)?/g;
const ISO_DATE_PATTERN = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
const TIME_PATTERN = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/g;

function stripDates(statement: string): string {
  // Only strip calendar-valid dates/times so hallucinations like 99:99 or
  // 9999-99-99 stay visible and must be backed by a receipt.
  return statement
    .replace(ISO_DATE_PATTERN, (m, y, mo, d) => {
      const month = Number(mo);
      const day = Number(d);
      void y;
      return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? " " : m;
    })
    .replace(TIME_PATTERN, (m, h, mi, s) => {
      const hour = Number(h);
      const min = Number(mi);
      const sec = s === undefined ? 0 : Number(s);
      return hour <= 23 && min <= 59 && sec <= 59 ? " " : m;
    });
}

function normalized(statement: string): string {
  // NFKC folds fullwidth / Arabic-Indic digits to ASCII so they cannot
  // slip past NUMBER_PATTERN invisible to the gate.
  return statement.normalize("NFKC");
}

type TokenUnit = "percent" | "mm" | "cm2" | "bare";

interface TypedToken {
  value: number;
  unit: TokenUnit;
}

function typedTokens(statement: string): TypedToken[] {
  const text = normalized(stripDates(statement));
  const out: TypedToken[] = [];
  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const value = Number(match[0]);
    if (!Number.isFinite(value)) continue;
    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 24).toLowerCase();
    let unit: TokenUnit = "bare";
    if (/^\s*(?:cm\s*2|cm2|cm²|square\s*centimet(er|re)s?)/.test(after)) unit = "cm2";
    else if (/^\s*(?:mm\b|millimet(er|re)s?)/.test(after)) unit = "mm";
    else if (/^\s*(?:%|percent\b|percentage\b)/.test(after)) unit = "percent";
    out.push({ value, unit });
  }
  return out;
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

/**
 * Severity-adjacent language the engine never emits. Without this, "total
 * loss, replace the whole wall" ships with zero severity evidence while the
 * gate advertises severity agreement — the canonical bands are the only
 * verifiable severity vocabulary.
 */
const UNVERIFIABLE_SEVERITY = /\b(severe|severely|critical|catastrophic|destroyed|total\s+loss|write-?off|minor|major|negligible|extensive|serious|badly\s+damaged)\b/i;

function maskIdsOf(cited: Receipt[]): string[] {
  const ids: string[] = [];
  for (const receipt of cited) {
    const maskId = receipt.inputs["maskId"];
    if (typeof maskId === "string" && maskId !== "") ids.push(maskId);
  }
  return [...new Set(ids)];
}

export function normalizeReceiptId(id: string): string {
  const trimmed = id.trim();
  const match = /^[rR]0*(\d+)$/.exec(trimmed);
  if (match) return `R${match[1]!.padStart(3, "0")}`;
  return trimmed;
}

function unitFailures(statement: string, cited: Receipt[]): string[] {
  const failures: string[] = [];
  const units = new Set(cited.map((receipt) => receipt.output.unit));
  const text = normalized(statement);

  if (/(?:\d\s*)%|percent\b/i.test(text) && !units.has("percent")) {
    failures.push(`statement cites a percentage without a cited percent receipt: "${statement}"`);
  }
  if (/mm\b|millimet(er|re)s?/i.test(text) && !units.has("mm")) {
    failures.push(`statement cites millimetres without a cited calibrated-length receipt: "${statement}"`);
  }
  if (/\bcm(?:2|²)(?![a-z0-9])|square\s*centimet(er|re)s?/i.test(text) && !units.has("cm2")) {
    failures.push(`statement cites square centimetres without a cited calibrated-area receipt: "${statement}"`);
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
    if (typeof id !== "string") {
      failures.push(`${label}: cites non-string receipt id`);
      continue;
    }
    const receipt = receipts.get(id) ?? receipts.get(normalizeReceiptId(id));
    if (receipt === undefined) {
      failures.push(`${label}: cites unknown receipt "${id}"`);
    } else {
      cited.push(receipt);
    }
  }

  if (cited.length === 0) {
    return failures;
  }

  // Only measured value pools back numbers. Count (region_count), scale
  // (mm_per_px) and band (severity) outputs never back a bare number, so a
  // region count of 1 cannot launder "1 building" into verified scope.
  const poolOf = (unit: Receipt["output"]["unit"]): number[] =>
    cited
      .filter((receipt) => receipt.output.unit === unit)
      .map((receipt) => receipt.output.value)
      .filter((value): value is number => typeof value === "number");
  const percentOutputs = poolOf("percent");
  const mmOutputs = poolOf("mm");
  const cm2Outputs = poolOf("cm2");
  const numericOutputs = [...percentOutputs, ...mmOutputs, ...cm2Outputs];

  const tokens = typedTokens(draft.statement);
  // Every finding must cite at least one measured number. Qualitative-only
  // sentences ("the crack is serious") pass no evidence, so they fail.
  if (tokens.length === 0) {
    failures.push(`${label}: no measured number cited — every finding must cite a receipt value`);
  }
  for (const token of tokens) {
    // A typed number must match a receipt of the same unit: 85.9% can only
    // be backed by a percent receipt, never by an 85.9 mm receipt.
    const pool = token.unit === "percent" ? percentOutputs : token.unit === "mm" ? mmOutputs : token.unit === "cm2" ? cm2Outputs : numericOutputs;
    const backed = pool.some((value) => matchesReceipt(token.value, value));
    if (!backed) {
      failures.push(`${label}: number ${token.value} is not backed by any cited receipt`);
    }
  }

  for (const failure of unitFailures(draft.statement, cited)) {
    failures.push(`${label}: ${failure}`);
  }

  // Per-unit completeness is now enforced per token above (every % token
  // needs a matching percent receipt, and so on); the legacy existential
  // `.some` checks were removed because they let swapped units pass.

  // One finding, one mask: citing receipts from two different masks mixes evidence.
  const maskIds = maskIdsOf(cited);
  if (maskIds.length > 1) {
    failures.push(`${label}: cites receipts from multiple masks (${maskIds.join(", ")}) — one finding per mask`);
  }

  // Severity words must agree with the cited severity receipt.
  const words = severityWords(draft.statement);
  const unverifiable = draft.statement.match(UNVERIFIABLE_SEVERITY);
  if (unverifiable) {
    failures.push(
      `${label}: unverifiable severity language "${unverifiable[0]}" — restate severity with its measured number using cosmetic, moderate or significant`,
    );
  }
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
  if (list.length === 0) {
    return { ok: false, failures: ["no findings: an empty report verifies nothing — the model must cite at least one measured number"] };
  }
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
  const byId = new Map<string, Receipt>();
  for (const receipt of receipts) {
    byId.set(receipt.id, receipt);
    byId.set(normalizeReceiptId(receipt.id), receipt);
  }
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
