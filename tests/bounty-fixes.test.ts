import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertSafeImageUrl, corsHeadersFor, observeBody } from "../backend/app.ts";
import { safeEqual } from "../backend/admin.ts";
import { SpendGuard } from "../src/config/spend-guard.ts";
import { validateFindings } from "../src/findings/evidence-gate.ts";
import { measureSession } from "../src/engine/measure.ts";
import { decodeRle } from "../pwa/rle.js";
import { unionMasks } from "../pwa/mask-ops.js";
import { stripMetadata } from "../src/vision/exif.ts";
import { replay } from "../eval/replay.ts";

const BIG = { size: [4096, 4096] as [number, number], counts: [0, 16777216] };
const mask = (id: string, label = "crack", rle = { size: [10, 10] as [number, number], counts: [0, 100] }) => ({
  id,
  label,
  confidence: 0.9,
  rle,
});

test("aggregate pixel budget: fifty individually-legal masks are refused", () => {
  const masks = Array.from({ length: 50 }, (_, i) => mask(`m${i}`, "crack", BIG));
  assert.throws(() => observeBody({ masks }), /per-request .*pixel budget/);
});

test("a single small mask still observes", () => {
  const out = (observeBody({ masks: [mask("m1")] }) as unknown as { result: { masks: unknown[] } }).result;
  assert.equal(out.masks.length, 1);
});

test("arbitrary mask labels are rejected at the boundary", () => {
  assert.throws(() => observeBody({ masks: [mask("m1", "banana")] }), /crack, stain, peel, dent/);
  assert.throws(
    () =>
      measureSession({
        component: { id: "w", areaPx: 100, confidence: 1 },
        masks: [{ id: "m", label: "banana" as never, areaPx: 10, confidence: 0.9 }],
      }),
    /mask label must be one of/,
  );
});

test("a refused coin ships diagnostics but no scaleReference", () => {
  const square = { size: [20, 20] as [number, number], counts: [0, 400] };
  const out = (
    observeBody({
      masks: [mask("m1", "crack", square)],
      reference: { id: "c1", knownMm: 25, confidence: 0.9, rle: square },
    }) as unknown as { result: { scaleReference?: unknown; referenceCheck?: { rejected?: string } } }
  ).result;
  assert.equal(out.scaleReference, undefined);
  assert.match(out.referenceCheck?.rejected ?? "", /misshapen|cut off/);
});

test("SSRF validator blocks decimal, octal, short-form and trailing-dot literals", () => {
  for (const u of [
    "https://2130706433/x.jpg",
    "https://0177.0.0.1/x.jpg",
    "https://127.0.0.1./x.jpg",
    "https://localhost./x.jpg",
    "https://127.1/x.jpg",
    "https://0x7f.0x0.0x0.0x1/x.jpg",
  ]) {
    assert.throws(() => assertSafeImageUrl(u), /public host/, u);
  }
  assert.doesNotThrow(() => assertSafeImageUrl("https://cdn.example.com/wall.jpg"));
});

test("severity synonyms cannot ship without verifiable bands", () => {
  const session = measureSession({
    component: { id: "w", areaPx: 10000, confidence: 1 },
    masks: [{ id: "c1", label: "crack", areaPx: 500, skeletonPx: 100, regionCount: 1, confidence: 0.9 }],
  });
  const ratio = session.findings[0]!.receiptIds.ratio;
  const bad = validateFindings(
    [{ statement: `crack covers ${session.findings[0]!.percent}%; total loss, replace the wall.`, citations: [ratio] }],
    session.receipts,
  );
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.some((f) => f.includes("unverifiable severity")));
});

test("swapped units fail the gate", () => {
  const session = measureSession({
    component: { id: "w", areaPx: 100000, confidence: 1 },
    masks: [{ id: "c1", label: "crack", areaPx: 5170, skeletonPx: 900, regionCount: 1, confidence: 0.9 }],
    scaleReference: { id: "coin", knownMm: 25, lengthPx: 260, confidence: 0.95 },
  });
  const ids = session.findings[0]!.receiptIds;
  const res = validateFindings(
    [
      {
        statement: `crack covers ${session.findings[0]!.crackLengthMm}% and measures ${session.findings[0]!.percent} mm; classified ${session.findings[0]!.severity}.`,
        citations: [ids.ratio, ids.length ?? "", ids.severity],
      },
    ],
    session.receipts,
  );
  assert.equal(res.ok, false);
});

test("replay drifts when the component identity is swapped", () => {
  const component = { id: "wall-1", areaPx: 10000, confidence: 1 };
  const masks = [{ id: "c1", label: "crack" as const, areaPx: 500, skeletonPx: 100, regionCount: 1, confidence: 0.9 }];
  const session = measureSession({ component, masks });
  const drifted = replay({ component: { ...component, id: "wall-2" }, masks }, session);
  assert.equal(drifted.ok, false);
});

test("spend holds serialize concurrent callers on one budget", () => {
  const guard = new SpendGuard(0.1);
  const first = guard.reserve("call-a", 0.05);
  assert.throws(() => guard.reserve("call-b", 0.06));
  first.settle("call-a", 0.0025);
  assert.equal(guard.spentUsd, 0.0025);
  const second = guard.reserve("call-b", 0.06);
  second.release();
  assert.equal(guard.reservedUsd, 0);
});

test("admin token comparison is constant-time and exact", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
});

test("CORS responses vary by Origin", () => {
  assert.equal(corsHeadersFor(null, {} as never).vary, "Origin");
});

test("pwa rle decode refuses oversized and ragged inputs", () => {
  assert.throws(() => decodeRle({ size: [20000, 20000], counts: [0, 400000000] }), /pixel cap/);
  assert.throws(() => decodeRle({ size: [2, 2], counts: [0, 3] }), /covers 3 pixels/);
  assert.throws(() => decodeRle({ size: [2, 2], counts: [0, 5] }), /exceed/);
});

test("unionMasks refuses mismatched lengths instead of corrupting", () => {
  assert.throws(() => unionMasks([new Uint8Array(4), new Uint8Array(9)]), /differs/);
});

test("JPEG bytes trailing the EOI marker are dropped, not archived", () => {
  const seg = (marker: number, payload: number[]): number[] => [0xff, marker, 0x00, payload.length + 2, ...payload];
  const input = Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]),
    0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xff, 0x00, 0x33, 0xff, 0xd9,
    0xff, 0xe1, 0x00, 0x10, 0x47, 0x50, 0x53, 0x21,
  ]);
  const out = stripMetadata(input);
  const text = new TextDecoder("latin1").decode(out.bytes);
  assert.ok(!text.includes("GPS"), "trailing metadata must not survive");
  assert.ok(out.removed.some((r) => r.kind.includes("trailing data")));
});
