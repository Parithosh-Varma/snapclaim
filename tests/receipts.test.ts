import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ReceiptLedger } from "../src/receipts/ledger.ts";

test("ledger ids are deterministic and append-only", () => {
  const ledger = new ReceiptLedger();
  const first = ledger.add({
    method: "area_ratio",
    inputs: { damageAreaPx: 10, componentAreaPx: 100 },
    output: { value: 10, unit: "percent" },
    formula: "damageAreaPx / componentAreaPx * 100",
    confidence: 0.9,
    notes: [],
  });
  const second = ledger.add({
    method: "severity_classification",
    inputs: { percent: 10 },
    output: { value: "moderate", unit: "band" },
    formula: "thresholds",
    confidence: null,
    notes: ["test"],
  });

  assert.equal(first.id, "R001");
  assert.equal(second.id, "R002");
  assert.equal(ledger.size, 2);
  assert.equal(ledger.get("R002")?.method, "severity_classification");

  const lines = ledger.toJsonl().split("\n");
  assert.equal(lines.length, 2);
  const parsed = JSON.parse(lines[0] ?? "") as { id: string; output: { unit: string } };
  assert.equal(parsed.id, "R001");
  assert.equal(parsed.output.unit, "percent");

  // Mutating the returned array must not mutate the ledger.
  ledger.all().pop();
  assert.equal(ledger.size, 2);
});
