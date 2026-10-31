import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");
const exists = (path: string): boolean => existsSync(new URL(path, root));

test("React app exists with the full screen set", () => {
  const pkg = JSON.parse(read("react/package.json")) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  assert.ok(pkg.dependencies?.react, "react dependency");
  assert.ok(pkg.dependencies?.["react-dom"], "react-dom dependency");
  assert.ok(pkg.scripts?.build?.includes("vite build"), "vite build script");

  for (const f of [
    "react/index.html", "react/vite.config.ts", "react/src/main.tsx", "react/src/App.tsx",
    "react/src/screens/Capture.tsx", "react/src/screens/Mark.tsx", "react/src/screens/Say.tsx",
    "react/src/screens/Numbers.tsx", "react/src/screens/Check.tsx", "react/src/screens/Report.tsx",
    "react/src/screens/Tabs.tsx", "react/public/sw.js", "react/public/manifest.webmanifest",
    "react/public/coin-model.js", "react/public/sam-worker.js", "react/public/voice-worker.js",
  ]) {
    assert.ok(exists(f), `${f} exists`);
  }

  const app = read("react/src/App.tsx");
  for (const screen of ["tHome", "tCases", "tSettings", "capture", "sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"]) {
    assert.ok(app.includes(`"${screen}"`), `screen ${screen} in the React state machine`);
  }
});

test("Capture has one primary action and camera-free paths", () => {
  const cap = read("react/src/screens/Capture.tsx");
  for (const id of ["shutter", "uploadBtn", "altEntry", "noCoin", "enableCam", "tipsBtn", "tipsGotIt", "tipsClose"]) {
    assert.ok(cap.includes(`id="${id}"`), `capture keeps #${id}`);
  }
  for (const copy of [
    "Place a coin to unlock",
    "Percentages only — no millimetres",
    "Place a coin next to the damage",
    "Coin found – fit damage + coin in frame",
    "snapclaim.tipsSeen",
  ]) {
    assert.ok(cap.includes(copy), `capture copy: ${copy}`);
  }
});

test("Mark gates on crack selection; no model download before first tap", () => {
  const mark = read("react/src/screens/Mark.tsx");
  assert.ok(mark.includes("Select crack to continue."), "empty state names the required action");
  assert.ok(mark.includes("Crack selected: now verify"), "coin verify waits for a crack selection");
  assert.ok(mark.includes("there is nothing outlined to measure"), "measure refuses an empty mask even if forced");
});

test("React port keeps backend, worker and privacy contracts", () => {
  const all = [
    "react/src/App.tsx", "react/src/screens/Capture.tsx", "react/src/screens/Mark.tsx",
    "react/src/screens/Say.tsx", "react/src/screens/Numbers.tsx", "react/src/screens/Check.tsx",
    "react/src/screens/Report.tsx", "react/src/screens/Tabs.tsx",
    "react/src/lib/sam.ts", "react/src/lib/voice.ts", "react/src/lib/sample.ts",
  ].map(read).join("\n");
  for (const path of ["/v1/measure", "/v1/observe", "/v1/report", "/v1/skeptic", "/v1/crosscheck", "/v1/render", "/v1/transcribe", "/v1/segment", "/v1/health"]) {
    assert.ok(all.includes(path), `React port calls ${path}`);
  }
  assert.ok(all.includes("sam-worker.js"), "SlimSAM worker reused");
  assert.ok(all.includes("voice-worker.js"), "Whisper worker reused");
  assert.ok(all.includes("Server transcriber first"), "voice tries the server transcriber before on-device");
  assert.ok(!all.includes('innerHTML ='), "no raw HTML injection in the React port");

  const sw = read("react/public/sw.js");
  assert.ok(/snapclaim-react-v\d+/.test(sw), "versioned cache");
  assert.ok(sw.includes("SKIP_WAITING"), "updates wait for Reload");
  assert.ok(sw.includes("/v1/"), "API bypass is explicit");

  const check = read("react/src/screens/Check.tsx");
  assert.ok(check.includes("Run the measurement first"), "React skeptic guards a missing measurement");
  assert.ok(check.includes("Evidence gate failed") && check.includes("retried"), "React retries gate failures once");
  assert.ok(check.includes("console.error"), "React logs backend errors with status");
  assert.ok(check.includes("Skeptic unavailable") && check.includes("Cross-check unavailable"), "React names 4xx states");
  assert.ok(check.includes("unavailable in mock mode"), "React surfaces the segment-mock reason");
  assert.ok(check.includes("minReferenceConfidence"), "React skeptic sends the same measure inputs as report");
  assert.ok(!check.includes("...(s.payload ?? {})"), "React skeptic no longer sprays the overlay at the backend");
  const api = read("react/src/lib/api.ts");
  assert.ok(api.includes("backendError"), "shared status + details error helper");
  const mark = read("react/src/screens/Mark.tsx");
  assert.ok(mark.includes("coinManualPt"), "React keeps a manual coin correction like the PWA");
  assert.ok(mark.includes("manualCoinRadius"), "React manual ring shares the measured radius");
  assert.ok(mark.includes("Tap coin to correct"), "React offers the coin correction tap");
  assert.ok(mark.includes("coinTaped"), "React offers the taped-coin lenient outline");
  assert.ok(mark.includes("2.5"), "React tape halo uses the lenient outline margin");
  const session = read("react/src/lib/session.ts");
  assert.ok(session.includes("coinManualPt") && session.includes("coinTaped"), "session carries the correction");
  for (const w of ["react/public/sam-worker.js", "react/public/voice-worker.js"]) {
    assert.ok(read(w).includes('tf.env.logLevel = "error"'), `${w} quiets ONNX Runtime warnings`);
  }
  for (const w of ["react/public/sam-worker.js", "pwa/sam-worker.js"]) {
    assert.ok(read(w).includes("photoId: progressPhotoId"), `${w} tags progress with the photo so stale downloads never paint the bar`);
  }
  assert.ok(mark.includes("That photo could not be read"), "unreadable photo fails closed instead of keeping a stale mask");
  assert.ok(mark.includes("there is nothing outlined to measure"), "measure refuses an empty mask even if the button is forced");

  const html = read("react/index.html");
  assert.ok(html.includes("Content-Security-Policy"), "CSP kept");
  for (const host of ["https://cdn.jsdelivr.net", "https://huggingface.co"]) {
    assert.ok(html.includes(host), `React CSP connect-src allows the on-device model CDN (${host})`);
  }
  assert.ok(!html.includes("user-scalable=no"), "pinch zoom allowed");
  assert.ok(html.includes('src="./theme.js"'), "pre-paint theme kept");
  assert.ok(html.includes('src="./coin-model.js"'), "coin model global kept");
});

test("React store is the vanilla store contract", () => {
  const store = read("react/src/lib/store.ts");
  assert.ok(store.includes('CASES_KEY = "snapclaim.cases.v1"'), "same localStorage key: existing cases survive the switch");
  assert.ok(store.includes('SETTINGS_KEY = "snapclaim.settings.v1"'), "same settings key");
  assert.ok(store.includes("photoDropped"), "quota photo-drop kept");
});
