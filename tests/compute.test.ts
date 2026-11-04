import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EMBED_LONG_EDGE, embedSize, isLowMem, onDeviceAllowed, onDeviceEnabled } from "../react/src/lib/compute.ts";

test("on-device defaults to off (missing key, false, junk)", () => {
  assert.equal(onDeviceEnabled(undefined), false);
  assert.equal(onDeviceEnabled({}), false);
  assert.equal(onDeviceEnabled({ onDevice: false }), false);
  assert.equal(onDeviceEnabled({ onDevice: "yes" }), false);
  assert.equal(onDeviceEnabled({ onDevice: true }), true);
});

test("unknown deviceMemory counts as low-memory (fail safe)", () => {
  for (const v of [undefined, null, 0, Number.NaN, "lots", -2]) {
    assert.equal(isLowMem(v), true, String(v));
  }
  assert.equal(isLowMem(2), true);
  assert.equal(isLowMem(4), true);
  assert.equal(isLowMem(8), false);
  assert.equal(EMBED_LONG_EDGE, 640);
});

test("embedSize caps the long edge and never upscales", () => {
  assert.deepEqual(embedSize(1024, 768), { width: 640, height: 480 });
  assert.deepEqual(embedSize(100, 100), { width: 100, height: 100 });
  const tiny = embedSize(0, 0);
  assert.ok(tiny.width >= 1 && tiny.height >= 1);
});

test("onDeviceAllowed is false in node (no navigator, no settings)", () => {
  // No localStorage + no navigator here: unknown device => low-mem => refused,
  // before any Worker is ever constructed.
  assert.equal(onDeviceAllowed(), false);
});

test("low-mem device refuses even with opt-in", async () => {
  Object.defineProperty(globalThis, "navigator", { value: { deviceMemory: 2 }, configurable: true });
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: () => JSON.stringify({ onDevice: true }),
    setItem: () => {},
    removeItem: () => {},
  };
  assert.equal(onDeviceAllowed(), false);
  const { SamClient } = await import("../react/src/lib/sam.ts");
  const sam = new SamClient();
  assert.equal(await sam.ensureEmbedded({} as HTMLCanvasElement), false);
  assert.match(sam.lastError ?? "", /low-memory/);
  // @ts-ignore restore node default (getter-only navigator)
  delete (globalThis as Record<string, unknown>).navigator;
  delete (globalThis as Record<string, unknown>).localStorage;
});
