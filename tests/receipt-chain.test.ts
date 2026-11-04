import { strict as assert } from "node:assert";
import { test } from "node:test";
import { measureSession } from "../src/engine/measure.ts";
import { canonicalReceipt, hashBytesHex, receiptChainHash } from "../src/receipts/hash.ts";
import { loadWallFixture } from "./helpers.ts";

test("receipt chain hash is deterministic and tamper-visible", () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  const first = receiptChainHash(session.receipts);
  assert.match(first, /^[0-9a-f]{64}$/);

  const again = receiptChainHash(structuredClone(session.receipts));
  assert.equal(again, first);

  const tampered = structuredClone(session.receipts);
  tampered[0]!.output.value = 99.99;
  assert.notEqual(receiptChainHash(tampered), first);

  // Input key order must not move the hash.
  const reordered = structuredClone(session.receipts);
  const inputs = reordered[0]!.inputs;
  reordered[0]!.inputs = Object.fromEntries(Object.entries(inputs).reverse());
  assert.equal(canonicalReceipt(reordered[0]!), canonicalReceipt(session.receipts[0]!));
});

test("hashBytesHex matches the SHA-256 test vector", () => {
  assert.equal(hashBytesHex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("scale receipts warn that the reference must share the damage plane", () => {
  const fixture = loadWallFixture();
  const session = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: fixture.scaleReference,
  });
  const scale = session.receipts.find((receipt) => receipt.method === "scale_calibration");
  assert.ok(scale, "expected a scale_calibration receipt");
  assert.ok(scale.notes.some((note) => /coplanar/i.test(note)), "scale receipt must carry the coplanar warning");

  const rejected = measureSession({
    component: fixture.component,
    masks: fixture.masks,
    scaleReference: { ...fixture.scaleReference, confidence: 0.1 },
  });
  const refusal = rejected.receipts.find((receipt) => receipt.method === "scale_rejected");
  assert.ok(refusal, "expected a scale_rejected receipt");
  assert.equal(rejected.mode, "percent-only");
  assert.ok(refusal.notes.some((note) => /percent-only/i.test(note)));
});
