import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MockFindingsProvider, MockVisionProvider } from "../src/adapters/mock.ts";
import { measureSession } from "../src/engine/measure.ts";
import { EvidenceError, gateFindings } from "../src/findings/evidence-gate.ts";
import { loadWallFixture } from "./helpers.ts";

test("mock pipeline: photo fixture in, gated findings out, zero API calls", async () => {
  const fixture = loadWallFixture();
  const vision = new MockVisionProvider({
    component: fixture.component,
    masks: fixture.masks,
  });

  const visionResult = await vision.segment({ imageId: fixture.imageId, labels: ["crack", "stain"] });
  const session = measureSession({
    component: visionResult.component,
    masks: visionResult.masks,
    scaleReference: fixture.scaleReference,
  });

  const findings = new MockFindingsProvider();
  const drafts = await findings.draftFindings({
    transcript: "wall crack near the window, coin for scale",
    findings: session.findings,
    receipts: session.receipts,
  });

  assert.equal(drafts.length, 2);
  assert.ok(drafts[0]?.statement.includes("5.17%"));
  assert.ok(drafts[0]?.statement.includes("85.9 mm"));

  assert.doesNotThrow(() => gateFindings(drafts, session.receipts));
  assert.equal(session.receipts.length, 8);
});

test("the pipeline can fail: tampered numbers are caught before shipping", async () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  const drafts = await new MockFindingsProvider().draftFindings({
    transcript: "test",
    findings: session.findings,
    receipts: session.receipts,
  });

  const first = drafts[0];
  assert.ok(first);
  first.statement = first.statement.replace("5.17", "7.77");

  assert.throws(() => gateFindings(drafts, session.receipts), EvidenceError);
});
