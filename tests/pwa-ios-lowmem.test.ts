import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const app = readFileSync(new URL("../pwa/app.js", import.meta.url), "utf8");

test("iPhone/iPad count as low-memory even without navigator.deviceMemory", () => {
  const body = app.match(/function isLowMemDevice\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(body.includes("isAppleMobile()"), "isLowMemDevice checks iOS before deviceMemory");
  assert.ok(app.includes('/iPad|iPhone|iPod/.test(navigator.userAgent)'), "UA check for iPhone/iPad/iPod");
  assert.ok(app.includes('navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1'), "iPadOS desktop-UA check");
});

test("low-memory phones start the SAM worker on the CPU", () => {
  assert.match(app, /get\("device"\) \?\? \(isLowMemDevice\(\) \? "wasm" : null\)/);
});
