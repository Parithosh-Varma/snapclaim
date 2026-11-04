import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EMBED_LONG_EDGE, embedSize, isLowMem, onDeviceEnabled } from "../pwa/compute.js";
import { createCaseStore, type StorageLike } from "../pwa/store.js";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

function memStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

/* ---------- pure policy ---------- */

test("on-device defaults OFF and needs an explicit opt-in", () => {
  assert.equal(onDeviceEnabled({}), false, "existing users have no key stored");
  assert.equal(onDeviceEnabled(undefined), false);
  assert.equal(onDeviceEnabled(null), false);
  assert.equal(onDeviceEnabled({ onDevice: false }), false);
  assert.equal(onDeviceEnabled({ onDevice: "true" }), false, "truthy strings do not opt in");
  assert.equal(onDeviceEnabled({ onDevice: true }), true);
  assert.equal(onDeviceEnabled({ onDevice: true, capture: { multiShot: true } }), true, "coexists with other flags");
});

test("compute toggle persists round-trip and survives case wipe", () => {
  const store = createCaseStore(memStorage());
  assert.equal(onDeviceEnabled(store.getSettings()), false, "fresh profile reads OFF");
  store.setSettings({ onDevice: true });
  assert.equal(onDeviceEnabled(store.getSettings()), true);
  store.setSettings({ onDevice: false });
  assert.equal(onDeviceEnabled(store.getSettings()), false);
  store.setSettings({ onDevice: true });
  store.save({ name: "C" });
  store.clear();
  assert.equal(onDeviceEnabled(store.getSettings()), true, "wipe clears cases, not the toggle");
});

test("unknown deviceMemory counts as low", () => {
  assert.equal(isLowMem(undefined), true, "unknown is low");
  assert.equal(isLowMem(0), true);
  assert.equal(isLowMem(2), true, "2 GB phone is low");
  assert.equal(isLowMem(4), true, "4 GB boundary is low");
  assert.equal(isLowMem(8), false);
  assert.equal(isLowMem("8"), false, "string readings work");
});

test("embed input is capped at a 640px long edge, never upscaled", () => {
  assert.equal(EMBED_LONG_EDGE, 640);
  assert.deepEqual(embedSize(1024, 768), { width: 640, height: 480 });
  assert.deepEqual(embedSize(400, 300), { width: 400, height: 300 }, "small photos pass through");
  assert.deepEqual(embedSize(2000, 500), { width: 640, height: 160 }, "panoramas fit the long edge");
  assert.deepEqual(embedSize(500, 2000), { width: 160, height: 640 });
  assert.ok(embedSize(0, 0).width >= 1 && embedSize(0, 0).height >= 1, "degenerate input stays >= 1px");
});

/* ---------- shell wiring: no workers unless opted in ---------- */

test("worker factories refuse to construct when cloud-only", () => {
  const app = read("pwa/app.js");
  const samBody = app.slice(app.indexOf("function sam()"), app.indexOf("function setupMarkPhoto"));
  assert.ok(samBody.includes("onDeviceOn()"), "sam() consults the toggle");
  assert.ok(
    samBody.indexOf("onDeviceOn()") < samBody.indexOf("new Worker"),
    "the toggle is checked before constructing sam-worker",
  );
  assert.ok(samBody.includes("speech model is busy"), "SAM waits while voice loads");
  const voiceBody = app.slice(app.indexOf("function transcribeOnDevice"), app.indexOf("mic.onclick"));
  assert.ok(voiceBody.includes("onDeviceOn()"), "transcribeOnDevice consults the toggle");
  assert.ok(
    voiceBody.indexOf("onDeviceOn()") < voiceBody.indexOf("new Worker"),
    "the toggle is checked before constructing voice-worker",
  );
  assert.ok(
    voiceBody.includes("releaseSam()") || voiceBody.includes("samLoading"),
    "voice preempts a SAM download instead of loading both models at once",
  );
});

test("tap handler is API-first with an opt-in-only device fallback", () => {
  const app = read("pwa/app.js");
  const tapBody = app.slice(app.indexOf('"markCanvas").addEventListener'), app.indexOf('$("coinKind").addEventListener'));
  assert.ok(tapBody.includes("segmentViaApi"), "API stays the first path");
  assert.ok(tapBody.includes("onDeviceOn()"), "device fallback is gated on the toggle");
  assert.ok(!tapBody.includes("gateLowMemOnDevice"), "no second-tap gate relic on the tap path");
  assert.ok(!app.includes("gateLowMemOnDevice"), "the dead gate is deleted, not just bypassed");
  assert.ok(tapBody.includes("Settings → Compute"), "API failure names the opt-in when cloud-only");
});

test("voice is server-first with an opt-in-only on-device fallback", () => {
  const app = read("pwa/app.js");
  const voiceBody = app.slice(app.indexOf("Server transcriber first"), app.indexOf("function landTranscript"));
  assert.ok(voiceBody.includes("/v1/transcribe"), "server stays the first path");
  assert.ok(voiceBody.includes("onDeviceOn()") || voiceBody.includes("allowDevice"), "device fallback is gated on the toggle");
  assert.ok(voiceBody.includes("Or type the line below"), "cloud-only failure still offers typing");
});

test("retake and new claims release resident workers", () => {
  const app = read("pwa/app.js");
  const retakeBody = app.slice(app.indexOf('$("retake").onclick'), app.indexOf('$("usePhoto").onclick'));
  assert.ok(retakeBody.includes("releaseSam()"), "retake releases the outlining worker");
  assert.ok(retakeBody.includes("releaseVoice()"), "retake releases the speech worker");
  assert.ok(app.includes("function releaseSam()"), "release terminates the worker, not just nulls it");
  assert.ok(app.includes(".terminate()"), "release terminates workers");
});

test("embed path is capped, paused and single-sourced", () => {
  const app = read("pwa/app.js");
  assert.ok(app.includes("embedSize(photo.width, photo.height)"), "embed input goes through the cap");
  assert.ok(app.includes("embedRunning"), "embed state pauses the detector");
  assert.ok(app.includes("lowMem: isLowMemDevice()"), "the single low-mem source rides the embed message");
  assert.ok(
    read("pwa/sam-worker.js").includes("msgLowMem") || read("pwa/sam-worker.js").includes("lowMem"),
    "worker prefers the page-passed value",
  );
  const scanBody = app.slice(app.indexOf("function scan()"), app.indexOf("function grayEdges"));
  assert.ok(scanBody.includes("embedRunning"), "scan loop yields while the embed posts pixels");
});

test("compute settings UI exists with the exact contract copy", () => {
  const html = read("pwa/index.html");
  assert.ok(html.includes('id="setOnDevice"'), "Compute toggle exists");
  assert.ok(html.includes("<h3>Compute</h3>"), "Compute group exists in Settings");
  assert.ok(html.includes("Off = cloud only (recommended)."), "toggle documents the default");
  assert.ok(html.includes("may crash low-memory phones"), "toggle warns about low-memory phones");
  const app = read("pwa/app.js");
  assert.ok(app.includes("Cloud-only processing") || app.includes("Cloud-only"), "toggling OFF confirms cloud-only");
});

test("offline copy is mode-aware", () => {
  const app = read("pwa/app.js");
  assert.ok(
    app.includes("new measurements need a connection"),
    "offline bar copy names the connection requirement",
  );
  assert.ok(
    app.includes("on-device processing is off - see Settings → Compute"),
    "offline model message points at the toggle when cloud-only",
  );
  assert.ok(app.includes("new measurements need a connection") , "offline voice error names the connection");
});

test("compute module ships in the precached shell", () => {
  const sw = read("pwa/sw.js");
  assert.ok(sw.includes('"./compute.js"'), "compute.js is precached for offline settings");
  assert.ok(sw.includes("sam-worker.js") && sw.includes("voice-worker.js"), "workers stay cached for opt-in offline use");
});
