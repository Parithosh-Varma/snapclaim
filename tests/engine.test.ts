import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  MeasurementError,
  areaRatio,
  calibratedLengthMm,
  mmPerPx,
  ratioToPercent,
  round,
} from "../src/engine/math.ts";
import { classifySeverity, DEFAULT_SEVERITY_THRESHOLDS } from "../src/engine/severity.ts";
import { measureSession } from "../src/engine/measure.ts";
import { loadWallFixture } from "./helpers.ts";

test("area ratio and percent come from pixels, not from a model", () => {
  const fixture = loadWallFixture();
  const crack = fixture.masks[0];
  assert.ok(crack);

  const ratio = areaRatio(crack.areaPx, fixture.component.areaPx);
  assert.ok(Math.abs(ratio - 0.0516666667) < 1e-9);
  assert.equal(ratioToPercent(ratio), 5.17);
});

test("impossible masks are rejected instead of producing a number", () => {
  assert.throws(() => areaRatio(10, 0), MeasurementError);
  assert.throws(() => areaRatio(11, 10), MeasurementError);
  assert.throws(() => areaRatio(-1, 10), MeasurementError);
  assert.throws(() => ratioToPercent(1.2), MeasurementError);
});

test("calibration converts pixels to millimetres only with a confident reference", () => {
  const fixture = loadWallFixture();
  const ref = fixture.scaleReference;

  const scale = mmPerPx(ref);
  assert.ok(scale !== null);
  assert.ok(Math.abs(scale - 27 / 287) < 1e-12);

  assert.equal(calibratedLengthMm(913, ref), 85.9);
  assert.equal(mmPerPx({ ...ref, confidence: 0.4 }), null);
  assert.equal(calibratedLengthMm(913, { ...ref, confidence: 0.4 }), null);
  assert.throws(() => mmPerPx({ ...ref, knownMm: 0 }), MeasurementError);
});

test("severity bands follow the printed thresholds", () => {
  assert.equal(classifySeverity({ ratio: 0.005, crackLengthMm: null, regionCount: 1 }), "cosmetic");
  assert.equal(classifySeverity({ ratio: 0.02, crackLengthMm: null, regionCount: 1 }), "moderate");
  assert.equal(classifySeverity({ ratio: 0.08, crackLengthMm: null, regionCount: 1 }), "significant");

  // A small area still escalates on region count or on calibrated length.
  assert.equal(classifySeverity({ ratio: 0.005, crackLengthMm: null, regionCount: 3 }), "significant");
  assert.equal(classifySeverity({ ratio: 0.005, crackLengthMm: 200, regionCount: 1 }), "significant");

  assert.throws(
    () => classifySeverity({ ratio: 0.5, crackLengthMm: null, regionCount: 1 }, { ...DEFAULT_SEVERITY_THRESHOLDS, cosmeticMaxRatio: 0.1 }),
    MeasurementError,
  );
});

test("a full session emits one receipt per measured claim", () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });

  assert.equal(session.mode, "absolute");
  assert.equal(session.findings.length, 2);
  assert.equal(session.receipts.length, 8);

  const crack = session.findings[0];
  assert.ok(crack);
  assert.equal(crack.percent, 5.17);
  assert.equal(crack.crackLengthMm, 85.9);
  assert.equal(crack.severity, "significant");

  const stain = session.findings[1];
  assert.ok(stain);
  assert.equal(stain.percent, 1.29);
  assert.equal(stain.crackLengthMm, null);
  assert.equal(stain.severity, "moderate");

  const ids = new Set(session.receipts.map((receipt) => receipt.id));
  for (const finding of session.findings) {
    for (const id of Object.values(finding.receiptIds)) {
      if (id !== null) {
        assert.ok(ids.has(id), `missing receipt ${id}`);
      }
    }
  }
});

test("without a scale reference the session stays percent-only and says so", () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
  });

  assert.equal(session.mode, "percent-only");
  assert.ok(session.findings.every((finding) => finding.crackLengthMm === null));
  assert.ok(session.receipts.every((receipt) => receipt.output.unit !== "mm"));
});

test("a low-confidence reference is rejected with a receipt, not silently used", () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: { ...fixture.scaleReference, confidence: 0.4 },
  });

  assert.equal(session.mode, "percent-only");
  assert.ok(session.receipts.some((receipt) => receipt.method === "scale_rejected"));
  assert.ok(session.receipts.every((receipt) => receipt.output.unit !== "mm"));
});
