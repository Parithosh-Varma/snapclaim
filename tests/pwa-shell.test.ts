import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

test("PWA shell is installable and honest", () => {
  const manifest = JSON.parse(read("pwa/manifest.webmanifest")) as {
    name?: string;
    start_url?: string;
    display?: string;
    icons?: unknown[];
  };
  assert.ok(manifest.name?.includes("SnapClaim"));
  assert.ok(manifest.start_url);
  assert.equal(manifest.display, "standalone");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);

  const html = read("pwa/index.html");
  assert.ok(html.includes('rel="manifest"'), "index links the manifest");
  assert.ok(html.includes("Content-Security-Policy"), "index sets a CSP");
  for (const host of ["https://cdn.jsdelivr.net", "https://huggingface.co"]) {
    assert.ok(html.includes(host), `CSP connect-src allows the on-device model CDN (${host})`);
  }
  assert.ok(html.includes('id="micBtn"'), "voice capture button exists");
  assert.ok(html.includes('id="wave"'), "waveform exists");
  assert.ok(html.includes('id="shutter"'), "camera shutter exists");
  assert.ok(html.includes('id="coinRing"'), "coin ring exists");
  assert.ok(html.includes('id="sReview"'), "review screen exists");
  assert.ok(html.includes('id="usePhoto"') && html.includes('id="retake"'), "review actions exist");
  assert.ok(html.includes('id="markCanvas"'), "mark screen exists");
  assert.ok(html.includes('id="noCoin"'), "no-coin percent-only path exists");
  for (const step of ["01 / 06","02 / 06","03 / 06","04 / 06","05 / 06","06 / 06"]) {
    assert.ok(html.includes(step), `eyebrow ${step} exists`);
  }
  assert.ok(!html.includes("user-scalable=no"), "viewport allows pinch zoom");
  assert.ok(html.includes('id="apple-touch-icon"') || html.includes('rel="apple-touch-icon"'), "iOS home-screen icon linked");
  for (const id of ["camStep","uploadBtn","camFile","donateCheck","updateBar","updateGo"]) {
    assert.ok(html.includes(`id="${id}"`), `shell element ${id} exists`);
  }
  for (const id of ["numPhotoCard","numPhoto","numChip","numLoading","numError","reportDoc","docGate","docMeta","docPhoto","docQuote","docRows","annexImg","shareBtn","copyBtn","newClaimBtn","installBtn","offlineBar","toReport","renderBtn"]) {
    assert.ok(html.includes(`id="${id}"`), `report/check element ${id} exists`);
  }
  assert.ok(html.includes('id="xcheckBtn"') || html.includes("Cross-check"), "cross-check exists");
  assert.ok(html.includes('id="coinKind"'), "coin options exist");
  assert.ok(html.includes("India"), "Indian coin options exist");
  for (const id of ["tHome","netPill","nextTitle","nextSub","ctaNew","ctaSample","recentList","recentEmpty",
    "tCases","caseList","caseEmpty","tSettings","sc-theme-light","sc-theme-auto","sc-theme-dark","donateSetting",
    "installHint","updateBtn","storeInfo","sc-store-meter","exportAllBtn","wipeBtn","baseUrl2","setCheck","setHealth",
    "caseDlg","dlgName","dlgProp","dlgNotes","dlgPhotos","dlgAddPhoto","dlgFile","dlgSave","dlgExport","dlgDelete","dlgClose",
    "tabs","toast","appLive","doneHome"]) {
    assert.ok(html.includes(`id="${id}"`), `tab/case element ${id} exists`);
  }
  assert.ok(html.includes('data-tab="capture"'), "tab bar has the centre New action");
  assert.ok(html.includes('<script src="./theme.js"></script>'), "theme.js loads before first paint");
});

test("service worker caches the shell, never the API", () => {
  const sw = read("pwa/sw.js");
  assert.ok(/snapclaim-shell-v\d+/.test(sw), "versioned cache");
  assert.ok(sw.includes("/v1/"), "API bypass is explicit");
  assert.ok(sw.includes("skipWaiting"), "updates activate");
  assert.ok(sw.includes("SKIP_WAITING"), "updates wait for the Reload button, not install");
  assert.ok(sw.includes("location.origin"), "cross-origin requests are never cached");
  assert.ok(sw.includes('caches.match("./index.html")'), "offline navigations fall back to the shell");
  assert.ok(sw.includes("coin-model.js"), "coin model cached for offline gating");

  assert.ok(sw.includes("store.js") && sw.includes("theme.js"), "store and theme are precached for offline tabs");

  const app = read("pwa/app.js");
  assert.ok(app.includes("SKIP_WAITING"), "Reload button activates the waiting worker");
  assert.ok(app.includes('from "./store.js"'), "app uses the local case store");
  assert.ok(app.includes("saveCaseFromReport"), "finished reports are saved as cases");
  assert.ok(app.includes('showTab("tHome")'), "app lands on Home, camera only on demand");
  assert.ok(app.includes('addEventListener("offline"'), "offline banner is wired to connectivity events");
  assert.ok(app.includes('id="camFile"') || app.includes('$("camFile")'), "upload fallback is wired");
  assert.ok(app.includes("serviceWorker"), "PWA registers the service worker");
  assert.ok(app.includes("/v1/transcribe"), "voice posts to the transcribe proxy");
  assert.ok(app.includes("OfflineAudioContext"), "clip is resampled on-device");
  assert.ok(app.includes("/v1/crosscheck"), "PWA can cross-check on-device masks against SAM");
  assert.ok(app.includes("CoinModel.extractFeatures"), "coin ID uses the real feature extractor");
  assert.ok(app.includes("findRing"), "coin gate uses edge + radial-uniformity detection");
  assert.ok(!app.includes("$(\"raw\").innerHTML"), "no raw HTML injection of backend output");
});

test("PWA scripts load as the right module type", () => {
  const html = read("pwa/index.html");
  // ESM sources must never be pulled in with a classic <script src>:
  // the browser throws "Uncaught SyntaxError: Unexpected token 'export'"
  // and everything after it breaks.
  const classicSrcs = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
  const app = read("pwa/app.js");
  const esmSources = ["./photo-check.js"];
  for (const src of esmSources) {
    assert.ok(!classicSrcs.includes(src), `${src} must not load as a classic script`);
    assert.ok(app.includes(`from "${src}"`), `app.js imports ${src} as a module`);
  }
  // coin-model.js is a globalThis (non-module) script: classic tag is correct.
  assert.ok(classicSrcs.includes("./coin-model.js"), "coin-model.js loads as a classic global script");
});

test("PWA module top-level state is declared before use", () => {
  const app = read("pwa/app.js");
  // Regression test for "ReferenceError: payloadObj is not defined":
  // app.js runs as a strict-mode module, so every top-level assignment target
  // must have a let/const/var declaration somewhere in the module.
  for (const name of ["payloadObj", "lastMeasurement", "checkState"]) {
    assert.ok(
      new RegExp(`\\b(?:let|const|var)\\s+${name}\\b`).test(app),
      `${name} is declared at module scope`,
    );
  }
});
