import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EvidenceError, gateFindings, validateFindings } from "../src/findings/evidence-gate.ts";
import type { FindingDraft } from "../src/findings/evidence-gate.ts";
import { measureSession } from "../src/engine/measure.ts";
import type { MeasuredFinding } from "../src/engine/types.ts";
import { loadWallFixture } from "./helpers.ts";

function setup(): { finding: MeasuredFinding; receipts: ReturnType<typeof measureSession>["receipts"] } {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  const finding = session.findings[0];
  assert.ok(finding);
  return { finding, receipts: session.receipts };
}

function expectEvidenceError(action: () => void): EvidenceError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof EvidenceError, "expected EvidenceError");
    return error;
  }
  assert.fail("expected EvidenceError, nothing was thrown");
}

test("a fully cited finding passes the gate", () => {
  const { finding, receipts } = setup();
  const drafts: FindingDraft[] = [
    {
      statement: "crack covers 5.17% of the component and measures 85.9 mm; classified significant.",
      citations: [
        finding.receiptIds.ratio,
        finding.receiptIds.length ?? "",
        finding.receiptIds.severity,
      ],
    },
  ];

  const result = validateFindings(drafts, receipts);
  assert.equal(result.ok, true, result.failures.join("\n"));
  assert.doesNotThrow(() => gateFindings(drafts, receipts));
});

test("a number that no cited receipt supports fails the gate", () => {
  const { finding, receipts } = setup();
  const error = expectEvidenceError(() =>
    gateFindings(
      [{ statement: "crack covers 9.99% of the component.", citations: [finding.receiptIds.ratio] }],
      receipts,
    ),
  );
  assert.ok(error.failures.some((failure) => failure.includes("9.99")));
});

test("citing a receipt that does not exist fails the gate", () => {
  const { finding, receipts } = setup();
  const error = expectEvidenceError(() =>
    gateFindings([{ statement: "crack is significant.", citations: [finding.receiptIds.severity, "R999"] }], receipts),
  );
  assert.ok(error.failures.some((failure) => failure.includes("R999")));
});

test("millimetres without a calibrated-length citation fail the gate", () => {
  const { finding, receipts } = setup();
  const error = expectEvidenceError(() =>
    gateFindings(
      [{ statement: "crack measures 85.9 mm.", citations: [finding.receiptIds.ratio, finding.receiptIds.severity] }],
      receipts,
    ),
  );
  assert.ok(error.failures.some((failure) => failure.includes("millimetres")));
});

test("units the engine never emits are rejected", () => {
  const { finding, receipts } = setup();
  const error = expectEvidenceError(() =>
    gateFindings(
      [{ statement: "crack measures 8.6 cm.", citations: [finding.receiptIds.ratio, finding.receiptIds.length ?? ""] }],
      receipts,
    ),
  );
  assert.ok(error.failures.some((failure) => failure.includes("never emits")));
});

test("a finding with no citations fails the gate", () => {
  const { receipts } = setup();
  const error = expectEvidenceError(() => gateFindings([{ statement: "damage is significant.", citations: [] }], receipts));
  assert.ok(error.failures.some((failure) => failure.includes("no citations")));
});

test("a qualitative statement backed by the severity receipt passes", () => {
  const { finding, receipts } = setup();
  assert.doesNotThrow(() =>
    gateFindings([{ statement: "damage is significant.", citations: [finding.receiptIds.severity] }], receipts),
  );
});

test("empty statements fail", () => {
  const { finding, receipts } = setup();
  const error = expectEvidenceError(() => gateFindings([{ statement: "   ", citations: [finding.receiptIds.severity] }], receipts));
  assert.ok(error.failures.some((failure) => failure.includes("empty")));
});
