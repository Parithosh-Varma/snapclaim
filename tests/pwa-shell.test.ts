import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const pwa = new URL("../pwa/", import.meta.url);

test("every file the service worker pre-caches exists (one missing file fails the whole install)", () => {
  const sw = readFileSync(new URL("sw.js", pwa), "utf8");
  const list = sw.slice(sw.indexOf("const SHELL = ["), sw.indexOf("];", sw.indexOf("const SHELL = [")));
  const paths = [...list.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]!).filter((p) => p !== "");
  assert.ok(paths.length >= 8);
  for (const p of paths) assert.ok(existsSync(new URL(p, pwa)), `pwa/${p} is in sw.js SHELL but missing`);
});

test("the manifest's icons exist and its start URL stays inside the PWA", () => {
  const manifest = JSON.parse(readFileSync(new URL("manifest.webmanifest", pwa), "utf8"));
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  for (const icon of manifest.icons) assert.ok(existsSync(new URL(icon.src, pwa)), icon.src);
});
