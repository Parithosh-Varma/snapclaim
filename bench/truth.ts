/**
 * Known-truth bench: crack accuracy against answers we know exactly, $0.
 *
 * Every scene is drawn in code, so its true crack length and width in mm are
 * known before the pipeline sees it: a coin of known diameter and a crack of
 * known path and width, optionally on a wall shot at an angle. The masks go
 * through the same code a real photo does (circularReference, tiltStretch,
 * observeMask, measureSession) and the result is compared with the truth.
 *
 * What it measures: the measurement code given a mask (skeleton length,
 * width, coin scale, tilt correction). What it does not: how good the masks
 * from SAM are. A real photo with a tape on the wall is still needed for that.
 *
 * It also checks the refusals: with no coin, or a coin tilted past
 * MIN_COIN_ASPECT, the report must have no millimetres at all.
 *
 * Usage: `npm run bench:truth` — exit 1 if any refusal fails or the median
 * length error goes over MAX_MEDIAN_LENGTH_ERROR.
 */
import { fileURLToPath } from "node:url";
import { measureSession } from "../src/engine/measure.ts";
import type { MeasuredFinding } from "../src/engine/types.ts";
import { MIN_COIN_ASPECT, circularReference, observeMask, tiltStretch } from "../src/vision/observe.ts";
import { SIZE, photographed } from "../tests/tilted-scene.ts";

/** A 2 INR coin, the one in the team photos. */
export const COIN_MM = 25;
export const MAX_MEDIAN_LENGTH_ERROR = 0.05;

export interface TruthScene {
  id: string;
  /** minor / major of the wall as photographed; 1 is straight on. */
  aspect: number;
  coinRadiusPx: number | null;
  lengthPx: number;
  widthPx: number;
  /** Side-to-side wobble of the crack, px. 0 is a straight crack. */
  wavePx: number;
  angleDeg: number;
}

export interface TruthResult {
  scene: TruthScene;
  /** Null when the scene has no usable coin: the pipeline must refuse mm. */
  trueLengthMm: number | null;
  trueWidthMm: number | null;
  finding: MeasuredFinding;
  mode: "absolute" | "percent-only";
  lengthError: number | null;
  widthError: number | null;
  refused: boolean;
}

/** Path of the crack on the wall: centred near (30, 20), `wavePx` sine wobble. */
function crackPath(s: TruthScene): [number, number][] {
  const steps = 200;
  const a = (s.angleDeg * Math.PI) / 180;
  const [dx, dy, nx, ny] = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)];
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps - 0.5) * s.lengthPx;
    const off = s.wavePx * Math.sin((2 * Math.PI * (t + s.lengthPx / 2)) / 120);
    points.push([30 + t * dx + off * nx, 20 + t * dy + off * ny]);
  }
  return points;
}

function pathLength(points: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1]!, points[i]!];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

/** Points on the wall within widthPx / 2 of the path (flat ends). */
function crackShape(points: [number, number][], widthPx: number) {
  const half = widthPx / 2;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) - half, Math.max(...xs) + half, Math.min(...ys) - half, Math.max(...ys) + half];
  return (u: number, v: number) => {
    if (u < x0 || u > x1 || v < y0 || v > y1) return false;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      const [ex, ey] = [bx - ax, by - ay];
      const len2 = ex * ex + ey * ey;
      const t = ((u - ax) * ex + (v - ay) * ey) / len2;
      // Inner segments overlap at the joints; only the two path ends are cut flat.
      if ((i === 1 && t < 0) || (i === points.length - 1 && t > 1)) continue;
      const c = Math.max(0, Math.min(1, t));
      if (Math.hypot(u - ax - c * ex, v - ay - c * ey) <= half) return true;
    }
    return false;
  };
}

export function runScene(scene: TruthScene): TruthResult {
  const path = crackPath(scene);
  const crackMask = photographed(scene.aspect, 90, crackShape(path, scene.widthPx));

  let reference;
  let stretch;
  let usable = false;
  if (scene.coinRadiusPx !== null) {
    const r = scene.coinRadiusPx;
    const coinMask = photographed(scene.aspect, 90, (u, v) => (u + 120) ** 2 + (v + 120) ** 2 <= r * r);
    const measured = circularReference(coinMask, { id: "coin", knownMm: COIN_MM, confidence: 0.95 });
    reference = measured.reference;
    stretch = tiltStretch(measured.diagnostics);
    usable = measured.diagnostics.rejected === undefined;
  }

  const session = measureSession({
    component: { id: "photo", areaPx: SIZE * SIZE, confidence: 1 },
    masks: [observeMask(crackMask, { id: "crack", label: "crack", confidence: 0.9, ...(stretch ? { stretch } : {}) })],
    ...(reference ? { scaleReference: reference } : {}),
  });
  const finding = session.findings[0]!;

  const mmPerPx = usable ? COIN_MM / (2 * scene.coinRadiusPx!) : null;
  const trueLengthMm = mmPerPx === null ? null : pathLength(path) * mmPerPx;
  const trueWidthMm = mmPerPx === null ? null : scene.widthPx * mmPerPx;
  const rel = (got: number | null, want: number | null) =>
    got === null || want === null ? null : Math.abs(got / want - 1);
  return {
    scene,
    trueLengthMm,
    trueWidthMm,
    finding,
    mode: session.mode,
    lengthError: rel(finding.crackLengthMm, trueLengthMm),
    widthError: rel(finding.crackWidthMm, trueWidthMm),
    refused: finding.crackLengthMm === null && finding.areaCm2 === null && finding.crackWidthMm === null,
  };
}

/** The fixed grid. Deterministic: no randomness, same scenes every run. */
export function scenes(): TruthScene[] {
  const out: TruthScene[] = [];
  const angles = [15, 50, 80, 125, 160];
  let k = 0;
  for (const aspect of [1, 0.8, 0.65]) {
    for (const lengthPx of [120, 200, 260]) {
      for (const widthPx of [2, 3, 5]) {
        for (const wavePx of [0, 12]) {
          const angleDeg = angles[k++ % angles.length]!;
          out.push({ id: `a${aspect}-l${lengthPx}-w${widthPx}-v${wavePx}`, aspect, coinRadiusPx: 40, lengthPx, widthPx, wavePx, angleDeg });
        }
      }
    }
  }
  // Refusals: no coin at all, and a coin tilted past MIN_COIN_ASPECT.
  for (const aspect of [1, 0.65]) {
    out.push({ id: `refuse-nocoin-a${aspect}`, aspect, coinRadiusPx: null, lengthPx: 200, widthPx: 3, wavePx: 12, angleDeg: 40 });
  }
  out.push({ id: "refuse-flatcoin", aspect: MIN_COIN_ASPECT - 0.08, coinRadiusPx: 40, lengthPx: 200, widthPx: 3, wavePx: 0, angleDeg: 40 });
  return out;
}

export interface TruthSummary {
  measured: number;
  medianLengthError: number;
  within10Length: number;
  medianWidthError: number;
  within10Width: number;
  refusalCases: number;
  refusalFailures: string[];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function summarize(results: TruthResult[]): TruthSummary {
  const scored = results.filter((r) => r.trueLengthMm !== null);
  const len = scored.map((r) => r.lengthError ?? Number.POSITIVE_INFINITY);
  const wid = scored.map((r) => r.widthError ?? Number.POSITIVE_INFINITY);
  const refusals = results.filter((r) => r.trueLengthMm === null);
  return {
    measured: scored.length,
    medianLengthError: median(len),
    within10Length: len.filter((e) => e <= 0.1).length / len.length,
    medianWidthError: median(wid),
    within10Width: wid.filter((e) => e <= 0.1).length / wid.length,
    refusalCases: refusals.length,
    refusalFailures: refusals.filter((r) => !r.refused || r.mode !== "percent-only").map((r) => r.scene.id),
  };
}

const pct = (x: number | null) => (x === null ? "-" : `${(x * 100).toFixed(1)}%`);

function main(): void {
  const results = scenes().map(runScene);
  for (const r of results) {
    if (r.trueLengthMm === null) {
      console.log(`${r.refused ? "REFUSED" : "FAIL   "} ${r.scene.id}: len=${r.finding.crackLengthMm} mode=${r.mode}`);
    } else {
      console.log(
        `MEASURED ${r.scene.id}: len ${r.finding.crackLengthMm} vs ${r.trueLengthMm.toFixed(1)} mm (${pct(r.lengthError)}), ` +
          `width ${r.finding.crackWidthMm} vs ${r.trueWidthMm!.toFixed(2)} mm (${pct(r.widthError)})`,
      );
    }
  }
  const s = summarize(results);
  console.log(
    `\ntruth: ${s.measured} measured scenes, length median error ${pct(s.medianLengthError)}, ` +
      `${pct(s.within10Length)} within ±10%; width median error ${pct(s.medianWidthError)}, ` +
      `${pct(s.within10Width)} within ±10%; ${s.refusalCases - s.refusalFailures.length}/${s.refusalCases} refusals held`,
  );
  if (s.refusalFailures.length > 0 || s.medianLengthError > MAX_MEDIAN_LENGTH_ERROR) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
