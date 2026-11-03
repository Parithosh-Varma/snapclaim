import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  applyDraft, clearDraft, collectDraft, draftSummary, loadDraft, mapScreen, saveDraft,
} from "../react/src/lib/draft.ts";
import type { StorageLike } from "../react/src/lib/store.ts";
import { createSession, type Session } from "../react/src/lib/session.ts";

function memStore(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

/** Storage that refuses writes over `cap` chars, like a full localStorage. */
function cappedStore(cap: number): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > cap) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k) => { data.delete(k); },
  };
}

function photo(w: number, h: number): HTMLCanvasElement {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

function liveSession(): Session {
  const s = createSession();
  s.stillDataUrl = "data:image/jpeg;base64,AAA";
  s.photo = photo(8, 8);
  s.photoFor = "data:image/jpeg;base64,AAA";
  s.dmg.points = [[1, 2], [3, 4]];
  s.dmg.mask = new Uint8Array([1, 0, 0, 1, 0, 0, 0, 0].flatMap((v) => Array(8).fill(v)));
  s.dmg.iou = 0.8;
  s.dmg.source = "api";
  s.coinManualPt = [5, 5];
  s.coinMask = new Uint8Array(64).fill(1);
  s.coinIou = 0.9;
  s.coinKindMm = 27;
  s.coinLabel = "India ₹10 · 27 mm dia";
  s.dmgLabel = "crack";
  s.transcript = "crack near the window";
  s.workingHist = ["crack", "crack", "coin"];
  s.measurement = {
    findings: [{ label: "crack", percent: 5.17, crackLengthMm: 85.9, areaCm2: 2.19, severity: "significant" }],
    receipts: [],
    mode: "absolute",
  };
  s.payload = { overlay: { width: 8, height: 8, masks: [] } };
  return s;
}

test("empty session and tab screens produce no draft", () => {
  assert.equal(collectDraft(createSession(), "sMark"), null);
  const s = liveSession();
  for (const screen of ["tHome", "tCases", "tSettings", "tAdmin", "sShared", "capture"]) {
    if (screen === "capture") {
      const noStill = createSession();
      assert.equal(collectDraft(noStill, "capture"), null);
      continue;
    }
    assert.equal(collectDraft(s, screen), null, screen);
  }
});

test("capture with a still folds to review", () => {
  assert.equal(mapScreen("capture", liveSession()), "sReview");
  assert.equal(mapScreen("capture", createSession()), null);
});

test("draft round-trips stills, taps, masks, coin and results", () => {
  const s = liveSession();
  const draft = collectDraft(s, "sMark", () => "2026-11-02T00:00:00.000Z");
  assert.ok(draft);
  assert.equal(draft.screen, "sMark");
  assert.equal(draft.working.points.length, 2);
  assert.ok(draft.working.maskRle);
  assert.ok(draft.working.coinMaskRle);

  const store = memStore();
  assert.ok(saveDraft(store, draft));
  const loaded = loadDraft(store);
  assert.ok(loaded);

  const fresh = createSession();
  applyDraft(fresh, loaded);
  assert.equal(fresh.stillDataUrl, s.stillDataUrl);
  assert.deepEqual(fresh.dmg.points, [[1, 2], [3, 4]]);
  assert.ok(fresh.dmg.mask instanceof Uint8Array);
  assert.deepEqual([...fresh.dmg.mask!], [...s.dmg.mask!]);
  assert.deepEqual(fresh.coinManualPt, [5, 5]);
  assert.deepEqual([...fresh.coinMask!], [...s.coinMask!]);
  assert.equal(fresh.transcript, "crack near the window");
  assert.equal(fresh.measurement?.findings[0]?.percent, 5.17);
  assert.deepEqual(fresh.workingHist, ["crack", "crack", "coin"]);
  assert.equal(fresh.photo, null);
  assert.equal(fresh.annexUrl, null);
});

test("quota tiers strip location photo, then payload overlays, and still save", () => {
  const s = liveSession();
  s.locationPhoto = "data:image/jpeg;base64," + "L".repeat(500);
  s.payload = {
    overlay: {
      width: 8,
      height: 8,
      masks: [{ label: "crack", path: "M" + "0 0 L1 1 ".repeat(1000) }],
    },
  };
  const draft = collectDraft(s, "sMark");
  assert.ok(draft);
  const full = JSON.stringify(draft).length;

  // Cap between the stripped size and the full size: full write fails,
  // a stripped tier must succeed.
  const store = cappedStore(full - 1000);
  assert.ok(saveDraft(store, draft));
  const loaded = loadDraft(store);
  assert.ok(loaded);
  assert.equal(loaded.locationPhoto, null);
  assert.equal(loaded.payload?.overlay, undefined);
  // Core progress survives the stripping.
  assert.equal(loaded.working.points.length, 2);
  assert.equal(loaded.transcript, "crack near the window");
});

test("legacy two-angle drafts load without crashing, favouring angle 1", () => {
  const angle1Still = "data:image/jpeg;base64,ANGLE1";
  const angle2Still = "data:image/jpeg;base64,ANGLE2";
  const legacy = {
    v: 1,
    savedAt: "2026-10-01T00:00:00.000Z",
    screen: "sMark",
    activeAngle: 2,
    stillDataUrl: angle2Still,
    stillA: angle1Still,
    still2DataUrl: angle2Still,
    locationPhoto: null,
    capturingAngle: 2,
    coinLabel: "",
    coinKindMm: 0,
    coinTaped: false,
    noScaleMode: false,
    dmgLabel: "crack",
    transcript: "legacy draft",
    extendedTranscript: null,
    reportStatement: null,
    reportFail: null,
    raw: "{}",
    currentCaseId: null,
    working: {
      photoFor: angle2Still, w: 0, h: 0,
      points: [[9, 9]], maskRle: null, iou: 0, source: null,
      coinManualPt: null, coinMaskRle: null, coinIou: 0,
      gateCoin: null, taped: false, hist: [],
    },
    bundleA: {
      photoFor: angle1Still, w: 0, h: 0,
      points: [[1, 2]], maskRle: null, iou: 0, source: null,
      coinManualPt: null, coinMaskRle: null, coinIou: 0,
      gateCoin: null, taped: false, hist: [],
    },
    bundleB: null,
    measurement: null,
    payload: null,
    measurementA: {
      findings: [{ label: "crack", percent: 4.1, crackLengthMm: null, areaCm2: null, severity: "minor" }],
      receipts: [],
      mode: "percent-only",
    },
    measurementB: null,
    payloadA: { overlay: { width: 8, height: 8, masks: [] } },
    payloadB: null,
    winnerAngle: 2,
  };
  const store = memStore();
  store.data.set("snapclaim.draft.v1", JSON.stringify(legacy));
  const loaded = loadDraft(store);
  assert.ok(loaded);
  const fresh = createSession();
  applyDraft(fresh, loaded);
  // Angle 2's working slot is ignored: angle 1's still, taps and results win.
  assert.equal(fresh.stillDataUrl, angle1Still);
  assert.deepEqual(fresh.dmg.points, [[1, 2]]);
  assert.equal(fresh.measurement?.findings[0]?.percent, 4.1);
  assert.equal(fresh.transcript, "legacy draft");
});

test("hopelessly small quota keeps the old draft and reports failure", () => {
  const s = liveSession();
  const draft = collectDraft(s, "sMark");
  assert.ok(draft);
  const store = cappedStore(10);
  assert.equal(saveDraft(store, draft), false);
  assert.equal(loadDraft(store), null);
});

test("corrupt, foreign or versioned drafts never restore", () => {
  const store = memStore();
  store.data.set("snapclaim.draft.v1", "not json{");
  assert.equal(loadDraft(store), null);
  store.data.set("snapclaim.draft.v1", JSON.stringify({ v: 2, screen: "sMark" }));
  assert.equal(loadDraft(store), null);
  store.data.set("snapclaim.draft.v1", JSON.stringify({ v: 1, screen: "tHome" }));
  assert.equal(loadDraft(store), null);
  store.data.set("snapclaim.draft.v1", JSON.stringify({ v: 1, screen: "sMark" }));
  assert.equal(loadDraft(store), null);
  clearDraft(store);
  assert.equal(loadDraft(store), null);
});

test("summary names the step, taps and photo for the banner", () => {
  const s = liveSession();
  const draft = collectDraft(s, "sCheck");
  assert.ok(draft);
  const summary = draftSummary(draft);
  assert.equal(summary.step, "Double-check");
  assert.equal(summary.taps, 2);
  assert.equal(summary.hasPhoto, true);
});
