import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { agreementBadge, agreementLines, compareMeasurements } from "../pwa/agree.js";
import { createCaseStore, type StorageLike } from "../pwa/store.js";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

const tiny = (n: number): string => `data:image/jpeg;base64,${"A".repeat(n)}`;

/* ---------- agreement function ---------- */

test("agreement: near-identical frames agree", () => {
  const r = compareMeasurements(
    { crackLengthMm: 42.0, percent: 3.1 },
    { crackLengthMm: 42.5, percent: 3.2 },
  );
  assert.equal(r.verdict, "AGREE");
  assert.equal(agreementBadge(r), "AGREE · 2 frames");
});

test("agreement: boundary values count as agreement", () => {
  // Exactly 3% of the larger (100mm -> 3.0mm tolerance) and exactly 0.30pp.
  const len = compareMeasurements(
    { crackLengthMm: 100, percent: 3.0 },
    { crackLengthMm: 103, percent: 3.3 },
  );
  assert.equal(len.lenTolMm, 3.09, "tolerance is max(3% rel, 1.0mm)");
  assert.equal(len.verdict, "AGREE", "inclusive boundaries agree");
  // Sub-mm differences are noise: 1.0mm floor wins over 3% on small cracks.
  const small = compareMeasurements(
    { crackLengthMm: 10, percent: 2.0 },
    { crackLengthMm: 11, percent: 2.0 },
  );
  assert.equal(small.lenTolMm, 1.0);
  assert.equal(small.verdict, "AGREE");
});

test("agreement: divergent frames check, in red terms", () => {
  const len = compareMeasurements(
    { crackLengthMm: 40, percent: 3.1 },
    { crackLengthMm: 45, percent: 3.15 },
  );
  assert.equal(len.verdict, "CHECK");
  assert.ok(agreementBadge(len).startsWith("CHECK · frames disagree by "));
  assert.ok(agreementBadge(len).includes("mm"), "length failure reports mm");
  const area = compareMeasurements(
    { crackLengthMm: 40, percent: 3.1 },
    { crackLengthMm: 40.2, percent: 3.9 },
  );
  assert.equal(area.verdict, "CHECK");
  assert.ok(agreementBadge(area).includes("pp"), "area failure reports percentage points");
  const lines = agreementLines(len);
  assert.ok(lines.some((l) => l.includes("Length A") && l.includes("Δ")), "both values and the delta print");
});

test("agreement: percent-only skips the length leg", () => {
  const r = compareMeasurements(
    { crackLengthMm: null, percent: 4.0 },
    { crackLengthMm: null, percent: 4.1 },
  );
  assert.equal(r.lenOk, true, "no mm to compare is not a failure");
  assert.equal(r.verdict, "AGREE");
  const mixed = compareMeasurements(
    { crackLengthMm: null, percent: 4.0 },
    { crackLengthMm: 30, percent: 4.8 },
  );
  assert.equal(mixed.verdict, "CHECK", "area leg still runs without a coin");
});

/* ---------- storage budget ---------- */

test("quota fallback drops context, then B, then A - never the case", () => {
  // Quota fits metadata + one photo: all three throw, A+B throw, A alone fits.
  const one = tiny(300);
  let calls = 0;
  const storage: StorageLike = {
    getItem: () => null,
    setItem: (_k, v) => { calls++; if (v.length > 700) throw new Error("quota"); },
    removeItem: () => {},
  };
  const store = createCaseStore(storage, { makeId: () => "drop-order" });
  const saved = store.save({
    name: "Drop order",
    label: "crack",
    percent: 2,
    photos: { a: one, b: one, context: one },
  });
  assert.equal(saved.photos?.context, null);
  assert.equal(saved.photos?.b, null);
  assert.equal(saved.photos?.a, one, "frame A survives longest");
  assert.deepEqual(saved.dropped, ["context", "b"]);
  assert.equal(saved.label, "crack", "measurements and the record survive");
  assert.ok(calls >= 3, "retried after each drop");
});

test("v1 single-photo cases migrate to photos.a and stay readable", () => {
  const storage = memStorage();
  const store = createCaseStore(storage, { makeId: () => "v1" });
  const migrated = store.save({ name: "Old", photo: tiny(50) });
  assert.equal(migrated.photos?.a, tiny(50));
  assert.equal(migrated.photo, undefined, "legacy key migrates away on save");
  const dropped = store.save({ name: "Old dropped", photo: tiny(50), photoDropped: true });
  assert.deepEqual(dropped.dropped, ["a"]);
});

test("oversized blobs are refused up front, per slot", () => {
  const store = createCaseStore(memStorage(), { makeId: () => "big" });
  const saved = store.save({ name: "Huge", photos: { a: tiny(800_000), b: tiny(10) } });
  assert.equal(saved.photos?.a, null);
  assert.ok(saved.dropped?.includes("a"));
  assert.equal(saved.photos?.b, tiny(10), "small slots are kept");
});

/* ---------- C is never measured ---------- */

test("three-shot shell: only A and B are measurable, C is display-only", () => {
  const html = read("pwa/index.html");
  const app = read("pwa/app.js");
  const sw = read("pwa/sw.js");
  for (const id of ["shotTag", "shotCopy", "skipShot", "frameTag", "agreeBox", "multiNext", "locPlate", "setMultiShot"]) {
    assert.ok(html.includes(`id="${id}"`), `shell element ${id} exists`);
  }
  assert.ok(html.includes("Location — context only, not measured."), "location plate says it is not measured");
  assert.ok(app.includes('from "./agree.js"'), "app imports the pure agreement module");
  assert.ok(app.includes('const MEASURE_SLOTS = ["a", "b"]'), "measured slots are named explicitly");
  assert.ok(!app.includes('MEASURE_SLOTS = ["a", "b", "context"]'), "context is not a measured slot");
  assert.ok(app.includes("capture.multiShot"), "feature rides the settings flag, default off");
  for (const line of app.split("\n")) {
    if (line.includes("frames.context") || line.includes("frames[\"context\"]")) {
      assert.ok(!line.includes("/v1/") && !line.includes("fetch("),
        `location still never reaches a backend call: ${line.trim().slice(0, 100)}`);
    }
  }
  assert.ok(!/payloadObj\s*=\s*.*context/.test(app), "the reported payload is never the location frame");
  const skipAt = app.indexOf('$("skipShot").onclick');
  assert.ok(skipAt >= 0, "skip button is wired");
  assert.ok(app.slice(skipAt, skipAt + 400).includes("frames.context"), "skip writes the location slot only");
  assert.ok(sw.includes('"./agree.js"'), "agreement module is precached for offline use");
});

/* ---------- sample flow untouched ---------- */

test("sample flow still bypasses the three-shot set", () => {
  const app = read("pwa/app.js");
  const body = app.slice(app.indexOf("async function loadSample()"), app.indexOf("/* ---------- local cases"));
  assert.ok(body.includes("resetShots()"), "sample resets any in-flight set");
  assert.ok(!body.includes("startShot"), "sample never enters the shot state machine");
  assert.ok(!body.includes("frames."), "sample never touches frame slots");
});
