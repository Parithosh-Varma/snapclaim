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
  for (const step of ["01 / 05","02 / 05","03 / 05","04 / 05","05 / 05"]) {
    assert.ok(html.includes(step), `eyebrow ${step} exists`);
  }
  for (const id of ["numPhotoCard","numPhoto","numChip","numLoading","numError","reportDoc","docGate","docMeta","docPhoto","docQuote","docRows","annexImg","shareBtn","copyBtn","newClaimBtn","installBtn","offlineBar","toReport","renderBtn"]) {
    assert.ok(html.includes(`id="${id}"`), `report/check element ${id} exists`);
  }
  assert.ok(html.includes('id="xcheckBtn"') || html.includes("Cross-check"), "cross-check exists");
  assert.ok(html.includes('id="coinKind"'), "coin options exist");
  assert.ok(html.includes("India"), "Indian coin options exist");
});

test("service worker caches the shell, never the API", () => {
  const sw = read("pwa/sw.js");
  assert.ok(sw.includes("snapclaim-shell-v1"), "versioned cache");
  assert.ok(sw.includes("/v1/"), "API bypass is explicit");
  assert.ok(sw.includes("skipWaiting"), "updates activate");
  assert.ok(sw.includes("coin-model.js"), "coin model cached for offline gating");

  const app = read("pwa/app.js");
  assert.ok(app.includes("serviceWorker"), "PWA registers the service worker");
  assert.ok(app.includes("/v1/transcribe"), "voice posts to the transcribe proxy");
  assert.ok(app.includes("OfflineAudioContext"), "clip is resampled on-device");
  assert.ok(app.includes("/v1/crosscheck"), "PWA can cross-check on-device masks against SAM");
  assert.ok(app.includes("CoinModel.extractFeatures"), "coin ID uses the real feature extractor");
  assert.ok(app.includes("findRing"), "coin gate uses edge + radial-uniformity detection");
  assert.ok(!app.includes("$(\"raw\").innerHTML"), "no raw HTML injection of backend output");
});
