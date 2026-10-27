/**
 * Eval bench: guessed-vs-measured gap, deterministic and $0.
 *
 * Loads every `fixtures/masks/*.json`, runs `measureSession`, and compares
 * against `fixtures/expected/<same-name>.json` when present.
 *
 * Constantine's plug-in point: drop a new masks file plus its expected file
 * (same shape as `fixtures/expected/wall-crack.json`) and run `npm run eval`.
 * Cases without an expected file are reported as SKIP, never as failure.
 *
 * Usage: `npm run eval` — exit 0 on pass/skip, 1 on any gap over tolerance.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { measureSession } from "../src/engine/measure.ts";

interface ExpectedCase {
  maskId: string;
  percent: number;
  crackLengthMm: number | null;
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

function main(): void {
  const files = readdirSync(MASKS_DIR).filter((f) => f.endsWith(".json")).sort();
  let pass = 0;
  let skip = 0;
  let fail = 0;

  for (const file of files) {
    const stem = basename(file, ".json");
    const input = readJson(join(MASKS_DIR.pathname, file)) as {
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
      expected = readJson(join(EXPECTED_DIR.pathname, `${stem}.json`)) as ExpectedFile;
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
      if (ok) {
        pass += 1;
        console.log(`PASS ${stem}/${want.maskId}: ${got.percent}% len=${got.crackLengthMm} ${got.severity}`);
      } else {
        fail += 1;
        console.log(
          `FAIL ${stem}/${want.maskId}: got ${got.percent}% len=${got.crackLengthMm} ${got.severity} ` +
            `want ${want.percent}% len=${want.crackLengthMm} ${want.severity}`,
        );
      }
    }
  }

  console.log(`\neval: ${pass} pass, ${skip} skip, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main();
