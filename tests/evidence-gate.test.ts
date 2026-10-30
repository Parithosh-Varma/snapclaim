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

test("a qualitative statement with no measured number fails the gate", () => {
  const { finding, receipts } = setup();
  const error = expectEvidenceError(() =>
    gateFindings([{ statement: "damage is significant.", citations: [finding.receiptIds.severity] }], receipts),
  );
  assert.ok(error.failures.some((failure) => failure.includes("no measured number")));
});

test("a date in the statement is not read as evidence numbers", () => {
  const { finding, receipts } = setup();
  // The date contributes no number failures; the cited numbers pass.
  assert.doesNotThrow(() =>
    gateFindings(
      [
        {
          statement: `On 2026-10-28 the crack covered 5.17% of the component; classified significant.`,
          citations: [finding.receiptIds.ratio, finding.receiptIds.severity],
        },
      ],
      receipts,
    ),
  );
  // An uncited number still fails even next to a date.
  const error = expectEvidenceError(() =>
    gateFindings(
      [
        {
          statement: `On 2026-10-28 the crack covered 9.99% of the component.`,
          citations: [finding.receiptIds.ratio],
        },
      ],
      receipts,
    ),
  );
  assert.ok(error.failures.some((f) => f.includes("9.99")));
  assert.ok(!error.failures.some((f) => f.includes("2026")));
});

test("citing receipts from two masks in one finding fails", () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  const crack = session.findings.find((f) => f.label === "crack");
  const stain = session.findings.find((f) => f.label === "stain");
  assert.ok(crack && stain);
  const error = expectEvidenceError(() =>
    gateFindings(
      [
        {
          statement: `crack covers 5.17% and stain covers 1.29% of the component.`,
          citations: [crack.receiptIds.ratio, stain.receiptIds.ratio],
        },
      ],
      session.receipts,
    ),
  );
  assert.ok(error.failures.some((failure) => failure.includes("multiple masks")));
});

test("a severity word that contradicts the cited receipt fails", () => {
  const { finding, receipts } = setup();
  const error = expectEvidenceError(() =>
    gateFindings(
      [
        {
          statement: `crack covers 5.17% of the component; classified cosmetic.`,
          citations: [finding.receiptIds.ratio, finding.receiptIds.severity],
        },
      ],
      receipts,
    ),
  );
  assert.ok(error.failures.some((failure) => failure.includes("contradicts")));
});

test("empty statements fail", () => {
  const { finding, receipts } = setup();
  const error = expectEvidenceError(() => gateFindings([{ statement: "   ", citations: [finding.receiptIds.severity] }], receipts));
  assert.ok(error.failures.some((failure) => failure.includes("empty")));
});

test("shorthand receipt ids (r1, R1, r001) match canonical R001 receipts", () => {
  const { finding, receipts } = setup();
  const shortRatio = finding.receiptIds.ratio.toLowerCase().replace(/^r0*(\d+)$/, "r$1");
  const shortSev = finding.receiptIds.severity.toLowerCase().replace(/^r0*(\d+)$/, "r$1");
  const drafts: FindingDraft[] = [
    {
      statement: "crack covers 5.17% of the component; classified significant.",
      citations: [shortRatio, shortSev],
    },
  ];
  const result = validateFindings(drafts, receipts);
  assert.equal(result.ok, true, result.failures.join("\n"));
});

test("square centimetres without a calibrated-area citation fail the gate", () => {
  const { finding, receipts } = setup();
  const error = expectEvidenceError(() =>
    gateFindings(
      [{ statement: "crack covers 2.19 cm2.", citations: [finding.receiptIds.ratio, finding.receiptIds.severity] }],
      receipts,
    ),
  );
  assert.ok(error.failures.some((failure) => failure.includes("square centimetres")));

  assert.doesNotThrow(() =>
    gateFindings(
      [{ statement: "crack covers 2.19 cm².", citations: [finding.receiptIds.area ?? ""] }],
      receipts,
    ),
  );
});
