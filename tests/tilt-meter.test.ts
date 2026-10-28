import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TILT_REFUSE_DEG, TILT_WARN_DEG, mountTiltMeter, tiltFromOrientation, tiltMessage, tiltZone } from "../pwa/tilt-meter.js";

const near = (actual: number | null, expected: number) => {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);
};

test("upright phone is square to a wall, flat phone is square to the floor", () => {
  near(tiltFromOrientation(90, 0, "wall"), 0);
  near(tiltFromOrientation(0, 0, "floor"), 0);
  near(tiltFromOrientation(90, 0, "floor"), 90);
});

test("tipping the phone back from a wall reads as that many degrees", () => {
  near(tiltFromOrientation(60, 0, "wall"), 30);
  near(tiltFromOrientation(45, 0, "wall"), 45);
  near(tiltFromOrientation(120, 0, "wall"), 30); // tipped forward reads the same
});

test("side-to-side roll on a floor counts too", () => {
  near(tiltFromOrientation(0, 40, "floor"), 40);
  near(tiltFromOrientation(0, -40, "floor"), 40);
});

test("missing sensor readings give null and no message", () => {
  assert.equal(tiltFromOrientation(null, 0), null);
  assert.equal(tiltZone(null), "unknown");
  assert.equal(tiltMessage(null), "");
});

test("zones match the coin check: warn past 30°, refuse past 60°", () => {
  assert.equal(TILT_WARN_DEG, 30);
  assert.equal(TILT_REFUSE_DEG, 60);
  assert.equal(tiltZone(30), "ok");
  assert.equal(tiltZone(30.5), "flatter");
  assert.equal(tiltZone(60), "flatter");
  assert.equal(tiltZone(61), "refuse");
  assert.match(tiltMessage(45, "wall"), /flatter to the wall/);
  assert.match(tiltMessage(70, "floor"), /refused/);
});

test("mount does nothing where the browser has no orientation sensors", () => {
  const stop = mountTiltMeter({}, { win: {} });
  assert.equal(typeof stop, "function");
  stop();
});
