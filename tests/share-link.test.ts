import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decodeShareHash, encodeSharePayload, MAX_SHARE_URL_CHARS, type SharedReport } from "../react/src/lib/share.ts";

const rep: SharedReport = {
  v: 1,
  ref: "SC-TEST",
  date: "1 Nov 2026",
  label: "crack",
  percent: 5.17,
  lengthMm: 85.9,
  widthMm: null,
  areaCm2: null,
  severity: "significant",
  mode: "absolute",
  transcript: "crack by the window",
  checks: "Evidence gate: passed - Independent skeptic: not run - Mask cross-check: not run",
  img: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
};

test("share payload round-trips through the hash", () => {
  const hash = encodeSharePayload(rep);
  assert.ok(hash.startsWith("#/s/"));
  assert.deepEqual(decodeShareHash(hash), rep);
});

test("garbage hashes decode to null, never throw", () => {
  assert.equal(decodeShareHash(""), null);
  assert.equal(decodeShareHash("#/s/"), null);
  assert.equal(decodeShareHash("#/s/!!!not-base64!!!"), null);
  assert.equal(decodeShareHash("#/s/" + Buffer.from(JSON.stringify({ v: 2 })).toString("base64url")), null);
  assert.equal(decodeShareHash("#/s/" + Buffer.from(JSON.stringify({ ...rep, img: "http://evil/x.jpg" })).toString("base64url")), null);
  assert.equal(decodeShareHash("#/s/" + Buffer.from(JSON.stringify({ ...rep, ref: "x".repeat(33) })).toString("base64url")), null);
});

test("oversized reports refuse a link instead of making a broken one", () => {
  const big = { ...rep, img: `data:image/jpeg;base64,${"A".repeat(MAX_SHARE_URL_CHARS)}` };
  assert.throws(() => encodeSharePayload(big), /too large/);
});
