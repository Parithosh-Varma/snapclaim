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
  assert.ok(html.includes('id="record"'), "voice capture button exists");
  assert.ok(html.includes('id="voiceStatus"'), "voice status element exists");
  assert.ok(html.includes('id="sample"'), "one-tap sample measurement exists");
  assert.ok(html.includes("India"), "Indian coin options exist");
});

test("service worker caches the shell, never the API", () => {
  const sw = read("pwa/sw.js");
  assert.ok(sw.includes("snapclaim-shell-v1"), "versioned cache");
  assert.ok(sw.includes("/v1/"), "API bypass is explicit");
  assert.ok(sw.includes("skipWaiting"), "updates activate");

  const app = read("pwa/app.js");
  assert.ok(app.includes("serviceWorker"), "PWA registers the service worker");
  assert.ok(app.includes("/v1/transcribe"), "voice posts to the transcribe proxy");
  assert.ok(app.includes("OfflineAudioContext"), "clip is resampled on-device");
  assert.ok(!app.includes("$(\"raw\").innerHTML"), "no raw HTML injection of backend output");
});
