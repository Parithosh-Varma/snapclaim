/**
 * Replay: proof that a report is computed, not generated.
 *
 * Usage: `npm run replay -- request.json measurement.json`
 *
 * - request.json: {component, masks, scaleReference?} — the measured inputs.
 * - measurement.json: the `measurement` object ({findings, receipts, mode})
 *   from a /v1/report or /v1/measure call (or the array form {receipts} is
 *   rejected — store the full measurement).
 *
 * Re-runs `measureSession` and checks findings, receipts and mode match.
 * Receipts bind the request identity (component id/confidence sit in the
 * ratio receipt inputs), so swapping component.id/confidence reads as DRIFT.
 * Exit 0 on match, 1 on any drift. No keys, no network, no models.
 */
import { readFileSync } from "node:fs";
import { measureSession } from "../src/engine/measure.ts";
import type { MeasureSessionInput, MeasureSessionResult } from "../src/engine/types.ts";

export interface ReplayResult {
  ok: boolean;
  findings: number;
  receipts: number;
  mode: string;
  mismatches: string[];
}

export function replay(request: MeasureSessionInput, stored: MeasureSessionResult): ReplayResult {
  const fresh = measureSession(request);
  const mismatches: string[] = [];
  if (fresh.mode !== stored.mode) {
    mismatches.push(`mode differs: fresh ${fresh.mode}, stored ${stored.mode}`);
  }
  if (JSON.stringify(fresh.findings) !== JSON.stringify(stored.findings)) {
    mismatches.push("findings differ from the stored measurement");
  }
  const freshById = new Map(fresh.receipts.map((receipt) => [receipt.id, receipt]));
  const storedById = new Map(stored.receipts.map((receipt) => [receipt.id, receipt]));
  if (freshById.size !== storedById.size) {
    mismatches.push(`receipt count differs: fresh ${freshById.size}, stored ${storedById.size}`);
  }
  for (const [id, receipt] of freshById) {
    const other = storedById.get(id);
    if (!other) {
      mismatches.push(`missing receipt ${id}`);
    } else if (JSON.stringify(receipt) !== JSON.stringify(other)) {
      mismatches.push(`receipt ${id} differs: fresh ${JSON.stringify(receipt.output)} vs stored ${JSON.stringify(other.output)}`);
    }
  }
  for (const id of storedById.keys()) {
    if (!freshById.has(id)) mismatches.push(`extra receipt ${id} not reproduced`);
  }
  return { ok: mismatches.length === 0, findings: fresh.findings.length, receipts: fresh.receipts.length, mode: fresh.mode, mismatches };
}

const invokedAsCli = process.argv[1] !== undefined && process.argv[1].endsWith("replay.ts");

if (invokedAsCli) {
  const [, , requestPath, measurementPath] = process.argv;
  if (!requestPath || !measurementPath) {
    console.error("usage: npm run replay -- request.json measurement.json");
    process.exit(2);
  }
  const request = JSON.parse(readFileSync(requestPath, "utf8")) as MeasureSessionInput;
  const stored = JSON.parse(readFileSync(measurementPath, "utf8")) as MeasureSessionResult;
  const result = replay(request, stored);
  console.log(`replay: ${result.findings} findings, ${result.receipts} receipts, mode ${result.mode}, ${result.ok ? "MATCH" : "DRIFT"}`);
  for (const mismatch of result.mismatches) console.log(`  - ${mismatch}`);
  if (!result.ok) process.exit(1);
}
