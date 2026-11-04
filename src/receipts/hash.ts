import { createHash } from "node:crypto";
import type { Receipt } from "./types.ts";

/**
 * Tamper-evidence helpers for the receipt ledger.
 *
 * Replay (`npm run replay`) proves a report was *computed* from its inputs:
 * it re-runs `measureSession` and prints MATCH or DRIFT. It does not prove
 * the inputs themselves are original - anyone can edit the receipts file and
 * replay it consistently. Tamper-evidence needs one step more, recorded here
 * so every writer uses the same bytes:
 *
 * 1. At capture, hash the original photo bytes (before EXIF stripping) and
 *    keep `photoSha256` next to the archived run.
 * 2. Chain-hash the receipts below and store it with the run; re-hash on
 *    every read and compare.
 * 3. Sign the canonical payload at capture (the share-link HMAC in
 *    `react/src/lib/share.ts` is the current signing point for URLs).
 *
 * Without (1)-(3) a report is replayable but not tamper-evident.
 * See README "Provenance and license" and docs/eval-report.md.
 */

/** Stable bytes for one receipt: input keys sorted so key order cannot move the hash. */
export function canonicalReceipt(receipt: Receipt): string {
  const inputs = Object.fromEntries(Object.entries(receipt.inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify({
    id: receipt.id,
    method: receipt.method,
    inputs,
    output: receipt.output,
    formula: receipt.formula,
    confidence: receipt.confidence,
    notes: receipt.notes,
  });
}

/** SHA-256 over the canonical receipts in ledger order, hex encoded. */
export function receiptChainHash(receipts: Receipt[]): string {
  const hash = createHash("sha256");
  for (const receipt of receipts) {
    hash.update(canonicalReceipt(receipt));
    hash.update("\n");
  }
  return hash.digest("hex");
}

/** SHA-256 of raw bytes (photo intake hashing), hex encoded. */
export function hashBytesHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
