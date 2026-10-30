import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

test("offline bar is honest about what works without a connection", () => {
  for (const [path, src] of [
    ["pwa/index.html", read("pwa/index.html")],
    ["react/src/App.tsx", read("react/src/App.tsx")],
  ] as const) {
    const bar = src.match(/id="offlineBar"[\s\S]{0,600}/)?.[0] ?? src;
    assert.ok(/saved cases/i.test(bar), `${path} offline bar says saved cases work offline`);
    assert.ok(/capture/i.test(bar), `${path} offline bar says capture works offline`);
    assert.ok(/measur/i.test(bar), `${path} offline bar says measuring needs a connection`);
    assert.ok(/one online load first/i.test(bar), `${path} offline bar says on-device models need a first online load`);
  }
});

test("settings copy names the third-party hosts contacted on first use", () => {
  const pwa = read("pwa/app.js") + read("pwa/index.html");
  const react = read("react/src/screens/Tabs.tsx");
  for (const host of ["Google Fonts", "jsDelivr", "Hugging Face"]) {
    assert.ok(pwa.includes(host), `PWA settings/storage copy mentions ${host}`);
    assert.ok(react.includes(host), `React settings copy mentions ${host}`);
  }
});

test("on-device model failures say 'not available offline yet' instead of a raw error", () => {
  for (const path of ["pwa/app.js", "react/src/screens/Mark.tsx", "react/src/screens/Check.tsx"]) {
    assert.ok(read(path).includes("model not available offline yet"), `${path} names the offline-model state`);
  }
  for (const path of ["pwa/app.js", "react/src/screens/Say.tsx"]) {
    const src = read(path);
    assert.ok(
      src.includes("speech model not available offline yet") || src.includes('offlineModelMessage("speech")'),
      `${path} names the offline speech state`,
    );
  }
});

test("offline rendering falls back to system fonts", () => {
  for (const path of ["pwa/index.html", "react/src/styles.css"]) {
    const src = read(path);
    assert.ok(src.includes("ui-monospace"), `${path} has a system monospace fallback`);
    assert.ok(!src.includes('"IBM Plex Mono",monospace') && !src.includes("'IBM Plex Mono',monospace"), `${path} has no bare monospace fallback`);
  }
  assert.ok(read("pwa/index.html").includes("-apple-system"), "PWA body falls back past Archivo");
});

test("service worker still does no cross-origin runtime caching", () => {
  for (const path of ["pwa/sw.js", "react/public/sw.js"]) {
    const sw = read(path);
    assert.ok(sw.includes("location.origin"), `${path} guards on same-origin`);
    assert.ok(!sw.includes("cache.put"), `${path} adds no runtime cache entries (poison-proof by absence)`);
  }
});
