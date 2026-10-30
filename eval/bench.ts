/**
 * Eval bench: guessed-vs-measured gap, deterministic and $0.
 *
 * Loads every `fixtures/masks/*.json`, runs `measureSession`, and compares
 * against `fixtures/expected/<same-name>.json` when present.
 * When an expected case carries `rulerGtMm`, also scores measured accuracy
 * against the known ground-truth length (per-case error, median absolute error,
 * and share within ±10%).
 *
 * Constantine's plug-in point: drop a new masks file plus its expected file
 * (same shape as `fixtures/expected/wall-crack.json`) and run `npm run eval`.
 * Cases without an expected file are reported as SKIP, never as failure.
 *
 * Usage: `npm run eval` — exit 0 on pass/skip, 1 on any gap over tolerance.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { measureSession } from "../src/engine/measure.ts";

interface ExpectedCase {
  maskId: string;
  percent: number;
  crackLengthMm: number | null;
  rulerGtMm?: number;
  severity: string;
}

interface ExpectedFile {
  cases: ExpectedCase[];
  tolerance: { percent: number; crackLengthMm: number };
}

const MASKS_DIR = new URL("../fixtures/masks/", import.meta.url);
const EXPECTED_DIR = new URL("../fixtures/expected/", import.meta.url);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function main(): void {
  const files = readdirSync(MASKS_DIR).filter((f) => f.endsWith(".json")).sort();
  let pass = 0;
  let skip = 0;
  let fail = 0;
  const gtErrorsAll: number[] = [];
  const gtErrorsSam: number[] = [];
  let gtWithin10 = 0;

  for (const file of files) {
    const stem = basename(file, ".json");
    const input = readJson(fileURLToPath(new URL(file, MASKS_DIR))) as {
      component: never;
      masks: never[];
      scaleReference?: never;
    };
    const session = measureSession({
      component: input.component,
      masks: input.masks,
      scaleReference: input.scaleReference,
    });

    let expected: ExpectedFile | null = null;
    try {
      expected = readJson(fileURLToPath(new URL(`${stem}.json`, EXPECTED_DIR))) as ExpectedFile;
    } catch {
      expected = null;
    }

    if (!expected) {
      skip += 1;
      console.log(`SKIP ${stem}: no fixtures/expected/${stem}.json`);
      continue;
    }

    for (const want of expected.cases) {
      const got = session.findings.find((f) => f.maskId === want.maskId);
      if (!got) {
        fail += 1;
        console.log(`FAIL ${stem}/${want.maskId}: mask missing from measurement`);
        continue;
      }
      const dPercent = Math.abs(got.percent - want.percent);
      const dLen =
        got.crackLengthMm === null || want.crackLengthMm === null
          ? got.crackLengthMm === want.crackLengthMm ? 0 : Number.POSITIVE_INFINITY
          : Math.abs(got.crackLengthMm - want.crackLengthMm);
      const okSeverity = got.severity === want.severity;
      const ok = dPercent <= expected.tolerance.percent && dLen <= expected.tolerance.crackLengthMm && okSeverity;

      let gtSuffix = "";
      if (typeof want.rulerGtMm === "number" && got.crackLengthMm !== null) {
        const diff = got.crackLengthMm - want.rulerGtMm;
        const absErr = Math.abs(diff);
        const relPct = (diff / want.rulerGtMm) * 100;
        const within = absErr <= 0.1 * want.rulerGtMm;
        gtErrorsAll.push(Number(absErr.toFixed(2)));
        if (stem.startsWith("calibrated-")) {
          gtErrorsSam.push(Number(absErr.toFixed(2)));
        }
        if (within) gtWithin10 += 1;
        const sign = diff >= 0 ? "+" : "";
        gtSuffix = ` [gt=${want.rulerGtMm}mm err=${sign}${diff.toFixed(1)}mm (${sign}${relPct.toFixed(1)}%)]`;
      }

      if (ok) {
        pass += 1;
        console.log(`PASS ${stem}/${want.maskId}: ${got.percent}% len=${got.crackLengthMm} ${got.severity}${gtSuffix}`);
      } else {
        fail += 1;
        console.log(
          `FAIL ${stem}/${want.maskId}: got ${got.percent}% len=${got.crackLengthMm} ${got.severity} ` +
            `want ${want.percent}% len=${want.crackLengthMm} ${want.severity}${gtSuffix}`,
        );
      }
    }
  }

  console.log(`\neval: ${pass} pass, ${skip} skip, ${fail} fail`);
  if (gtErrorsAll.length > 0) {
    const medAll = median(gtErrorsAll).toFixed(1);
    const medSam = gtErrorsSam.length > 0 ? median(gtErrorsSam).toFixed(1) : "n/a";
    const pct10 = ((gtWithin10 / gtErrorsAll.length) * 100).toFixed(0);
    console.log(
      `ground-truth accuracy: scored=${gtErrorsAll.length} medianAbsErrorMm=${medAll} ` +
        `(SAM-calibrated n=${gtErrorsSam.length}: ${medSam}mm) within10pct=${gtWithin10}/${gtErrorsAll.length} (${pct10}%)`,
    );
  }
  if (fail > 0) process.exit(1);
}

main();
