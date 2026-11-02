/**
 * Two-frame agreement check: frame A and frame B each get measured on their
 * own; this compares the two independent readouts. It never merges masks,
 * never averages, and never picks a "better" frame - disagreement surfaces
 * as CHECK and the report still leads with frame A.
 *
 * Tolerances (absolute, per spec):
 * - length: |A-B| <= max(3% of the larger, 1.0 mm)
 * - area:   |A-B| <= 0.30 percentage points (percent of wall)
 * Boundary values count as agreement. A missing length (percent-only path,
 * no coin) skips the length leg - there is nothing to compare - while the
 * area leg still runs. Missing/invalid percents force CHECK.
 *
 * Plain JS (no TS syntax): the PWA ships this file directly to phones.
 * Types live in ./agree.d.ts for the test suite.
 */

/** 3% relative tolerance on crack length. */
export const AGREE_REL = 0.03;
/** 1.0mm absolute floor: sub-mm differences are noise, not signal. */
export const AGREE_MIN_MM = 1.0;
/** 0.30 percentage-point tolerance on damaged-area share. */
export const AGREE_MAX_PP = 0.3;

const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * @param {{crackLengthMm: number|null, percent: number}} a frame A readout
 * @param {{crackLengthMm: number|null, percent: number}} b frame B readout
 * @returns {{verdict:"AGREE"|"CHECK", lenA:number|null, lenB:number|null,
 *   lenTolMm:number, lenDeltaMm:number|null, lenOk:boolean,
 *   pctA:number, pctB:number, pctDelta:number}}
 */
export function compareMeasurements(a, b) {
  const lenA = isFiniteNumber(a.crackLengthMm) ? a.crackLengthMm : null;
  const lenB = isFiniteNumber(b.crackLengthMm) ? b.crackLengthMm : null;
  const pctA = a.percent;
  const pctB = b.percent;
  const pctOk = isFiniteNumber(pctA) && isFiniteNumber(pctB);
  const pctDelta = pctOk ? Math.abs(pctA - pctB) : NaN;
  const areaOk = pctOk && pctDelta <= AGREE_MAX_PP;

  let lenOk = true;
  let lenTolMm = 0;
  let lenDeltaMm = null;
  if (lenA !== null && lenB !== null) {
    lenTolMm = Math.max(AGREE_REL * Math.max(Math.abs(lenA), Math.abs(lenB)), AGREE_MIN_MM);
    lenDeltaMm = Math.abs(lenA - lenB);
    lenOk = lenDeltaMm <= lenTolMm;
  }
  const verdict = areaOk && lenOk ? "AGREE" : "CHECK";
  return { verdict, lenA, lenB, lenTolMm, lenDeltaMm, lenOk, pctA, pctB, pctDelta };
}

/** One-line badge copy for the Numbers screen. */
export function agreementBadge(r) {
  if (r.verdict === "AGREE") return "AGREE · 2 frames";
  const d = (!r.lenOk && r.lenDeltaMm !== null)
    ? `${Math.round(r.lenDeltaMm * 10) / 10} mm`
    : `${Math.round(r.pctDelta * 100) / 100} pp`;
  return `CHECK · frames disagree by ${d}`;
}

/** Human-readable detail lines for the CHECK case (and the AGREE values). */
export function agreementLines(r) {
  const lines = [];
  if (r.lenA !== null && r.lenB !== null && r.lenDeltaMm !== null) {
    lines.push(
      `Length A ${fmtMm(r.lenA)} vs B ${fmtMm(r.lenB)} · Δ ${fmtMm(r.lenDeltaMm)} (tolerance ${fmtMm(r.lenTolMm)})`,
    );
  } else {
    lines.push("Length: percent-only on at least one frame - no mm to compare.");
  }
  lines.push(`Area A ${fmtPct(r.pctA)} vs B ${fmtPct(r.pctB)} · Δ ${fmtPP(r.pctDelta)} (tolerance ${fmtPP(AGREE_MAX_PP)})`);
  return lines;
}

function fmtMm(v) {
  return `${Math.round(v * 10) / 10} mm`;
}

function fmtPct(v) {
  return `${Math.round(v * 100) / 100} %`;
}

function fmtPP(v) {
  if (!isFiniteNumber(v)) return "n/a";
  return `${Math.round(v * 100) / 100} pp`;
}
