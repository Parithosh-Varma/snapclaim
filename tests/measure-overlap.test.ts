import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createSession } from "../react/src/lib/session.ts";
import {
  buildObserveBody,
  completeMeasureJob,
  failMeasureJob,
  invalidateMeasure,
  startMeasureJob,
} from "../react/src/lib/measure-job.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

function liveSession() {
  const s = createSession();
  s.stillDataUrl = "data:image/jpeg;base64,AAA";
  s.photoFor = "data:image/jpeg;base64,AAA";
  s.dmg.points = [[10, 10], [20, 20]];
  s.dmg.mask = new Uint8Array(64).fill(1);
  s.dmg.iou = 0.8;
  s.dmgLabel = "crack";
  s.coinManualPt = [5, 5];
  s.coinMask = new Uint8Array(64).fill(1);
  s.coinIou = 0.9;
  s.coinKindMm = 24.26;
  s.noScaleMode = false;
  s.gateCoin = null;
  return s;
}

test("stale job landing late is discarded; the new job wins", () => {
  const s = liveSession();
  const d1 = deferred();
  const job1 = startMeasureJob(s, d1.promise);
  assert.equal(job1.state, "running");
  assert.equal(s.measureJob, job1);
  const seq1 = job1.seq;

  // A retry (new taps, new measure) supersedes the first job.
  s.dmg.points = [[10, 10], [20, 20], [30, 30]];
  const d2 = deferred();
  const job2 = startMeasureJob(s, d2.promise);
  assert.ok(job2.seq > seq1);

  // The old job lands late with numbers for the old inputs: discarded.
  const landed = completeMeasureJob(
    s,
    job1,
    { overlay: { width: 8, height: 8, masks: [] } },
    { findings: [{ label: "crack", percent: 1, crackLengthMm: 10, areaCm2: 1, severity: "cosmetic" }], receipts: [], mode: "absolute" },
  );
  assert.equal(landed, false);
  assert.equal(s.payload, null);
  assert.equal(s.measurement, null);

  // The current job lands: applied.
  const payload = { overlay: { width: 8, height: 8, masks: [] } };
  const measurement = {
    findings: [{ label: "crack", percent: 5, crackLengthMm: 50, areaCm2: 2, severity: "moderate" }],
    receipts: [{ id: "R001", output: { value: 50, unit: "mm" } }],
    mode: "absolute",
  };
  assert.equal(completeMeasureJob(s, job2, payload, measurement), true);
  assert.equal(s.payload, payload);
  assert.equal(s.measurement, measurement);
  assert.equal(job2.state, "done");
  d1.resolve();
  d2.resolve();
});

test("editing taps after the job starts discards its landing", () => {
  const s = liveSession();
  const d = deferred();
  const job = startMeasureJob(s, d.promise);
  // User goes back and changes the taps mid-flight.
  s.dmg.points = [[99, 99]];
  const landed = completeMeasureJob(
    s,
    job,
    { overlay: { width: 8, height: 8, masks: [] } },
    { findings: [], receipts: [], mode: "absolute" },
  );
  assert.equal(landed, false);
  assert.equal(s.payload, null);
  d.resolve();
});

test("input edits and new cases invalidate the running job", () => {
  const s = liveSession();
  const d = deferred();
  const job = startMeasureJob(s, d.promise);
  assert.equal(s.measureJob, job);
  invalidateMeasure(s);
  assert.equal(s.measureJob, null);
  assert.equal(s.payload, null);
  // Late landing after invalidation never writes.
  assert.equal(
    completeMeasureJob(s, job, { a: 1 }, { findings: [], receipts: [], mode: "absolute" }),
    false,
  );
  assert.equal(failMeasureJob(s, job, "boom"), false);
  d.resolve();
});

test("observe body is identical for the sequential and overlapping flows", () => {
  // Same inputs built twice (once for the old blocking call, once for the
  // background job) must produce byte-identical bodies, so receipts match.
  const a = liveSession();
  const b = liveSession();
  const r1 = buildObserveBody(a, 8, 8);
  const r2 = buildObserveBody(b, 8, 8);
  assert.equal(r1.refused, undefined);
  assert.deepEqual(r1.body, r2.body);
  const ref = r1.body.reference as { knownMm: number; confidence: number };
  assert.equal(ref.knownMm, 24.26);
  assert.equal(ref.confidence, 0.9);

  // The /v1/report envelope is payload + transcript in both flows.
  const payload = r1.body;
  const reportA = { ...JSON.parse(JSON.stringify(payload)), transcript: "crack by the window" };
  const reportB = { ...JSON.parse(JSON.stringify(payload)), transcript: "crack by the window" };
  assert.deepEqual(reportA, reportB);
});

test("observe body keeps the legacy branches: gate circle, percent-only, refusal", () => {
  const s = liveSession();
  // Gate-coin legacy draft: circle reference with the chosen size.
  s.coinManualPt = null;
  s.coinMask = null;
  s.gateCoin = { cx: 4, cy: 4, rr: 2, fw: 8, fh: 8, sw: 8, sh: 8, sx: 1, sy: 1 };
  const g = buildObserveBody(s, 8, 8);
  assert.equal(g.refused, undefined);
  assert.ok((g.body.reference as Record<string, unknown>).rle);

  // Percent-only: no reference, explicit note.
  s.gateCoin = null;
  s.noScaleMode = true;
  const p = buildObserveBody(s, 8, 8);
  assert.equal(p.body.note, "percent-only requested");
  assert.equal((p.body as Record<string, unknown>).reference, undefined);

  // Tap landed but the outline missed: refuse, never guess a circle.
  s.noScaleMode = false;
  s.coinManualPt = [5, 5];
  s.coinMask = null;
  const r = buildObserveBody(s, 8, 8);
  assert.equal(r.refused, "Tap the coin again - the last outline missed the coin.");
});
