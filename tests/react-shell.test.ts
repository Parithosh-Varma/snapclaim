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
  assert.ok(all.includes("On the device first") || all.includes("on-device"), "voice stays on-device first");
  assert.ok(!all.includes('innerHTML ='), "no raw HTML injection in the React port");

  const sw = read("react/public/sw.js");
  assert.ok(/snapclaim-react-v\d+/.test(sw), "versioned cache");
  assert.ok(sw.includes("SKIP_WAITING"), "updates wait for Reload");
  assert.ok(sw.includes("/v1/"), "API bypass is explicit");

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
