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
  assert.ok(html.includes('id="micBtn"'), "voice capture button exists");
  assert.ok(html.includes('id="wave"'), "waveform exists");
  assert.ok(html.includes('id="shutter"'), "camera shutter exists");
  assert.ok(html.includes('id="coinRing"'), "coin ring exists");
  assert.ok(html.includes('id="sReview"'), "review screen exists");
  assert.ok(html.includes('id="usePhoto"') && html.includes('id="retake"'), "review actions exist");
  assert.ok(html.includes('id="markCanvas"'), "mark screen exists");
  assert.ok(html.includes('id="noCoin"'), "no-coin percent-only path exists");
  // Home, then four steps, each tagged in its top bar.
  assert.ok(html.includes('id="sHome"') && html.includes('id="startBtn"'), "home screen starts a claim");
  for (const step of ["<span>Step 1</span>Photo", "<span>Step 2</span>Mark", "<span>Step 3</span>Describe", "<span>Step 4</span>Report"]) {
    assert.ok(html.includes(step), `step tag ${step} exists`);
  }
  for (const id of ["numPhotoCard","numPhoto","numChip","measured","transcriptBox","sendBtn","reportDoc","docGate","docMeta","docPhoto","docQuote","docRows","findings","skState","xState","annexImg","shareBtn","copyBtn","newClaimBtn","installBtn","offlineBar","renderBtn"]) {
    assert.ok(html.includes(`id="${id}"`), `report/check element ${id} exists`);
  }
  assert.ok(html.includes('id="xcheckBtn"') || html.includes("Cross-check"), "cross-check exists");
  assert.ok(html.includes('id="coinKind"'), "coin options exist");
  assert.ok(html.includes("India"), "Indian coin options exist");
});

test("service worker caches the shell, never the API", () => {
  const sw = read("pwa/sw.js");
  assert.ok(/snapclaim-shell-v\d+/.test(sw), "versioned cache");
  assert.ok(sw.includes("/v1/"), "API bypass is explicit");
  assert.ok(sw.includes("skipWaiting"), "updates activate");
  assert.ok(sw.includes("coin-model.js"), "coin model cached for offline gating");
  assert.ok(sw.includes("rle.js"), "RLE decoder cached for offline shell");
  assert.ok(sw.includes("coin-detect.js"), "coin detector cached for offline shell");

  const app = read("pwa/app.js");
  assert.ok(app.includes("serviceWorker"), "PWA registers the service worker");
  assert.ok(app.includes("/v1/transcribe"), "voice posts to the transcribe proxy");
  assert.ok(app.includes("OfflineAudioContext"), "clip is resampled on-device");
  assert.ok(app.includes("/v1/crosscheck"), "PWA can cross-check on-device masks against SAM");
  assert.ok(app.includes("/v1/sessions"), "PWA records completed claim sessions");
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
