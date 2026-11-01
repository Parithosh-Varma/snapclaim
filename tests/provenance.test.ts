import { strict as assert } from "node:assert";
import { test } from "node:test";
import { measureSession } from "../src/engine/measure.ts";
import { handleRequest } from "../backend/app.ts";

// 10x10 solid mask: column-major RLE starting with background run 0.
const RLE_10X10 = { size: [10, 10] as [number, number], counts: [0, 100] };

test("pixel-verified provenance when rle agrees with areaPx", () => {
  const out = measureSession({
    component: { id: "wall", areaPx: 10000, confidence: 1 },
    masks: [{ id: "c1", label: "crack", areaPx: 100, confidence: 0.9, rle: RLE_10X10 }],
  });
  assert.equal(out.provenance, "pixel-verified");
});

test("self-reported provenance without rle", () => {
  const out = measureSession({
    component: { id: "wall", areaPx: 10000, confidence: 1 },
    masks: [{ id: "c1", label: "crack", areaPx: 100, confidence: 0.9 }],
  });
  assert.equal(out.provenance, "self-reported");
});

test("rle area mismatch is fail-closed", () => {
  assert.throws(
    () =>
      measureSession({
        component: { id: "wall", areaPx: 10000, confidence: 1 },
        masks: [{ id: "c1", label: "crack", areaPx: 9999, confidence: 0.9, rle: RLE_10X10 }],
      }),
    /disagrees with decoded rle pixels/,
  );
});

test("REQUIRE_PIXEL_PROVENANCE=1 rejects self-reported absolute claims", async () => {
  const body = {
    component: { id: "wall", areaPx: 10000, confidence: 1 },
    masks: [{ id: "c1", label: "crack", areaPx: 100, skeletonPx: 50, confidence: 0.9 }],
    scaleReference: { id: "coin", knownMm: 25, lengthPx: 250, confidence: 0.95 },
  };
  const res = await handleRequest({
    method: "POST",
    path: "/v1/report",
    body,
    env: { REQUIRE_PIXEL_PROVENANCE: "1" },
  });
  assert.equal(res.status, 422);
  assert.match((res.body as { error: string }).error, /pixel provenance required/);
});

test("REQUIRE_PIXEL_PROVENANCE=1 allows pixel-verified absolute claims", async () => {
  const body = {
    component: { id: "wall", areaPx: 10000, confidence: 1 },
    masks: [{ id: "c1", label: "crack", areaPx: 100, skeletonPx: 50, confidence: 0.9, rle: RLE_10X10 }],
    scaleReference: { id: "coin", knownMm: 25, lengthPx: 250, confidence: 0.95 },
    drafts: [{ statement: "crack covers 1% of the wall.", citations: [] }],
  };
  // Drafts path still gated in mock; the point is provenance passes and the
  // failure (if any) is the evidence gate, not the provenance gate.
  const res = await handleRequest({
    method: "POST",
    path: "/v1/report",
    body,
    env: { REQUIRE_PIXEL_PROVENANCE: "1" },
  });
  const err = (res.body as { error?: string }).error ?? "";
  assert.ok(!/pixel provenance required/.test(err), `unexpected provenance rejection: ${err}`);
});
