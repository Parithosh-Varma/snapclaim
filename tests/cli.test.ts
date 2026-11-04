import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { headers, loadImage, parseArgs, parseCoin, parseTap } from "../cli/snapclaim.ts";

test("cli reads real photo dimensions and builds the data URL", () => {
  const png = loadImage(fileURLToPath(new URL("../react/public/icons/icon-192.png", import.meta.url)));
  assert.deepEqual({ width: png.width, height: png.height }, { width: 192, height: 192 });
  assert.equal(png.mime, "image/png");
  assert.ok(png.dataUrl.startsWith("data:image/png;base64,"));

  const jpeg = loadImage(fileURLToPath(new URL("../react/public/samples/dsc_0682.jpg", import.meta.url)));
  assert.deepEqual({ width: jpeg.width, height: jpeg.height }, { width: 1280, height: 851 });
  assert.equal(jpeg.mime, "image/jpeg");
  assert.ok(jpeg.dataUrl.startsWith("data:image/jpeg;base64,"));
});

test("cli tap and coin flags fail closed on malformed input", () => {
  assert.deepEqual(parseTap("420,310,crack"), { x: 420, y: 310, label: "crack" });
  for (const bad of ["420", "420,310", "420,310,crack,extra", "420,310,"]) {
    assert.throws(() => parseTap(bad), /--tap needs/);
  }
  assert.throws(() => parseTap("x,310,crack"), /coordinates must be numbers/);
  assert.deepEqual(parseCoin("830,610,24.26"), { x: 830, y: 610, knownMm: 24.26 });
  for (const bad of ["830,610", "830,610,coin", "830,610,24.26,extra"]) {
    assert.throws(() => parseCoin(bad), /--coin needs/);
  }
});

test("cli prefers BYOK flags over env and omits empty keys", () => {
  const previous = { meta: process.env.META_API_KEY, baseten: process.env.BASETEN_API_KEY };
  try {
    process.env.META_API_KEY = "k-env-meta";
    process.env.BASETEN_API_KEY = "k-env-baseten";
    const fromEnv = headers(parseArgs(["claim"]));
    assert.equal(fromEnv["x-meta-key"], "k-env-meta");
    assert.equal(fromEnv["x-baseten-key"], "k-env-baseten");
    assert.equal(fromEnv.authorization, undefined);

    const explicit = headers(parseArgs(["claim", "--meta-key", "flag-meta", "--bearer", "tok"]));
    assert.equal(explicit["x-meta-key"], "flag-meta", "an explicit flag wins");
    assert.equal(explicit.authorization, "Bearer tok");

    delete process.env.META_API_KEY;
    delete process.env.BASETEN_API_KEY;
    assert.deepEqual(headers(parseArgs(["claim"])), { "content-type": "application/json" });
  } finally {
    if (previous.meta === undefined) delete process.env.META_API_KEY;
    else process.env.META_API_KEY = previous.meta;
    if (previous.baseten === undefined) delete process.env.BASETEN_API_KEY;
    else process.env.BASETEN_API_KEY = previous.baseten;
  }
});
