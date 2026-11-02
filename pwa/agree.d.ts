// Types for ./agree.js (plain JS shared by the PWA and the test suite).
export const AGREE_REL: number;
export const AGREE_MIN_MM: number;
export const AGREE_MAX_PP: number;

export interface AgreementInput {
  /** Crack length in mm, or null when no coin scale was available. */
  crackLengthMm: number | null;
  /** Share of the wall damaged, in percent (0-100). */
  percent: number;
}

export interface AgreementResult {
  verdict: "AGREE" | "CHECK";
  lenA: number | null;
  lenB: number | null;
  lenTolMm: number;
  lenDeltaMm: number | null;
  lenOk: boolean;
  pctA: number;
  pctB: number;
  pctDelta: number;
}

export function compareMeasurements(a: AgreementInput, b: AgreementInput): AgreementResult;
export function agreementBadge(r: AgreementResult): string;
export function agreementLines(r: AgreementResult): string[];
