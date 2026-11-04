import { strict as assert } from "node:assert";
import { test } from "node:test";
import { pasteRasterToFrame, frameBox, type SamBox } from "../src/vision/sam.ts";
import { createMask, type BinaryMask } from "../src/vision/mask.ts";
import { observeMask } from "../src/vision/observe.ts";
import { measureSession } from "../src/engine/measure.ts";
import { handleRequest, rateLimitMaxForPath } from "../backend/app.ts";
import { resetSpendForTests, spendStatus } from "../backend/spend.ts";
import { replay } from "../eval/replay.ts";
import type { MeasureSessionInput, MeasureSessionResult } from "../src/engine/types.ts";
import { citingDrafts, LIVE_ENV } from "./helpers.ts";
import { COIN, coin, crack, photographed } from "./tilted-scene.ts";

/** Row-major mask → COCO RLE (column-major, first run counts zeros). */
function toRle(mask: BinaryMask): { size: [number, number]; counts: number[] } {
  const counts: number[] = [];
  let run = 0;
  let on = false;
  for (let x = 0; x < mask.width; x++) {
    for (let y = 0; y < mask.height; y++) {
      if ((mask.data[y * mask.width + x] !== 0) !== on) {
        counts.push(run);
        run = 0;
        on = !on;
      }
      run++;
    }
  }
  counts.push(run);
  return { size: [mask.height, mask.width], counts };
}

interface ClaimReply {
  ok: boolean;
  requestId: string;
  result: {
    claimId: string;
    measurement: MeasureSessionResult;
    findings: { statement: string; citations: string[] }[];
    gate: { ok: boolean };
    overlay?: { width: number; height: number; masks: { id: string; label: string; path: string }[] };
    referenceCheck?: { rejected?: string };
    segmentation?: { records: number; dropped: number; taps: number; frame: { width: number; height: number } };
    svg?: string;
    replay: { request: MeasureSessionInput; measurement: MeasureSessionResult };
  };
}

test("claim turns COCO RLE masks into a gated report, SVG and replay in one call", async () => {
  // Straight-on wall photo: a 200 px crack and a 40 px-radius coin.
  const body = {
    masks: [{ id: "damage-1", label: "crack", rle: toRle(photographed(1, 0, crack(0, 0, 200, 0))), confidence: 0.9 }],
    reference: { ...COIN, rle: toRle(photographed(1, 0, coin)) },
    transcript: "crack across the wall, coin for scale",
  };
  const res = await handleRequest({ method: "POST", path: "/v1/claim", body, env: {} });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const reply = res.body as ClaimReply;

  assert.equal(reply.result.claimId, reply.requestId);
  assert.equal(reply.result.measurement.mode, "absolute");
  assert.equal(reply.result.gate.ok, true);
  assert.equal(reply.result.findings.length, 1);
  assert.ok(reply.result.svg?.includes('data-mask="damage-1"'), "annexure outlines the measured mask");
  assert.ok(reply.result.svg?.includes("Crack"), "annexure names the damage");

  // The reply carries everything `npm run replay` needs: recomputation matches.
  const replayed = replay(reply.result.replay.request, reply.result.replay.measurement);
  assert.equal(replayed.ok, true, replayed.mismatches.join("; "));
  assert.equal(replayed.mode, "absolute");
});

test("claim without masks or a photo is a 400, not an empty report", async () => {
  const res = await handleRequest({ method: "POST", path: "/v1/claim", body: {}, env: {} });
  assert.equal(res.status, 400);
  assert.match((res.body as { error: string }).error, /masks\[\]|imageUrl/);
});

test("claim refuses more than 16 taps and unknown damage labels", async () => {
  const base = { imageUrl: "data:image/jpeg;base64,AAA", width: 60, height: 27 };
  const tooMany = await handleRequest({
    method: "POST",
    path: "/v1/claim",
    body: { ...base, damage: Array.from({ length: 17 }, () => ({ x: 1, y: 1, label: "crack" })) },
    env: LIVE_ENV,
  });
  assert.equal(tooMany.status, 400);

  const badLabel = await handleRequest({
    method: "POST",
    path: "/v1/claim",
    body: { ...base, damage: [{ x: 1, y: 1, label: "spider" }] },
    env: LIVE_ENV,
  });
  assert.equal(badLabel.status, 400);

  const outside = await handleRequest({
    method: "POST",
    path: "/v1/claim",
    body: { ...base, damage: [{ x: 60, y: 1, label: "crack" }] },
    env: LIVE_ENV,
  });
  assert.equal(outside.status, 400);
});

test("claim in mock mode refuses to segment a photo: the backend invents no masks", async () => {
  const res = await handleRequest({
    method: "POST",
    path: "/v1/claim",
    body: { imageUrl: "data:image/jpeg;base64,AAA", width: 60, height: 27, damage: [{ x: 10, y: 10, label: "crack" }] },
    env: {},
  });
  assert.equal(res.status, 422);
  assert.match((res.body as { error: string }).error, /invents no masks/);
});

test("claim photo path without a live key fails closed with 503", async () => {
  const res = await handleRequest({
    method: "POST",
    path: "/v1/claim",
    body: { imageUrl: "data:image/jpeg;base64,AAA", width: 60, height: 27, damage: [{ x: 10, y: 10, label: "crack" }] },
    env: { MOCK_MODE: "0" },
  });
  assert.equal(res.status, 503);
});

/** SSE lane carrying one parsed SAM line. */
function samStream(line: string): string {
  return [
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: line })}`,
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed" })}`,
  ].join("\n\n");
}

/** Canned official-encoder payloads: 4x6 diagonal, 27x60 all ones. */
const DIAGONAL_4X6 = "data=4,6,!!!!!'O3NZWV4";
const FULL_27X60 = "data=27,60,!!!!!'y:R[_&l";

function record(id: number, box: SamBox, token: string): string {
  const b = `box;x1=${box.x1};y1=${box.y1};x2=${box.x2};y2=${box.y2};w=${box.w};h=${box.h}`;
  return `${id}<|${b}|><|mask;x=0;y=0;c=${box.confidence ?? 0.9};${token}|>`;
}

test("claim photo path segments, drops the wall record, and ships a percent-only report", async () => {
  const width = 60;
  const height = 27;
  // Diagonal 4x6 raster pasted 1:1 at (10,10): four crack pixels.
  const damageBox: SamBox = { x1: 10, y1: 10, x2: 15, y2: 13, w: width, h: height, confidence: 0.9 };
  // The whole frame: a tap that caught the wall, which must be dropped.
  const wallBox: SamBox = { x1: 0, y1: 0, x2: 59, y2: 26, w: width, h: height, confidence: 0.95 };
  const stream = samStream(`<0f>0<|${`box;x1=10;y1=10;x2=15;y2=13;w=60;h=27`}|><|mask;x=0;y=0;c=0.9;${DIAGONAL_4X6}|>,${record(2, wallBox, FULL_27X60)}`);

  // The expected measurement, so the stub model cites real receipts.
  const expectedMask = createMask(width, height);
  for (let i = 0; i < 4; i++) expectedMask.data[(10 + i) * width + (10 + i)] = 1;
  const expected = measureSession({
    component: { id: "photo", areaPx: width * height, confidence: 1 },
    masks: [observeMask(expectedMask, { id: "damage-1", label: "crack", confidence: 0.9 })],
  });

  const fetchFn = (async (url: unknown) => {
    if (String(url).endsWith("/responses")) {
      return { ok: true, status: 200, text: async () => stream } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(citingDrafts(expected.findings)) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const res = await handleRequest({
    method: "POST",
    path: "/v1/claim",
    body: { imageUrl: "data:image/jpeg;base64,AAA", width, height, damage: [{ x: 10, y: 10, label: "crack" }], transcript: "crack in the wall" },
    env: LIVE_ENV,
    fetchFn,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const reply = res.body as ClaimReply;

  assert.equal(reply.result.segmentation?.records, 2);
  assert.equal(reply.result.segmentation?.dropped, 1, "the wall-sized record is dropped");
  assert.equal(reply.result.segmentation?.frame.width, width);
  assert.equal(reply.result.measurement.mode, "percent-only", "no coin means no millimetres");
  assert.equal(reply.result.measurement.provenance, "pixel-verified");
  assert.equal(reply.result.gate.ok, true);
  assert.deepEqual(reply.result.overlay?.masks.map((m) => m.id), ["damage-1"]);
  assert.ok(reply.result.svg?.includes('data-mask="damage-1"'));
});

test("claim photo path with a coin tap degrades to percent-only when the outline is not a coin", async () => {
  const width = 200;
  const height = 200;
  const damageBox: SamBox = { x1: 10, y1: 10, x2: 15, y2: 13, w: width, h: height, confidence: 0.9 };
  const damageStream = samStream(`<0f>0<|box;x1=10;y1=10;x2=15;y2=13;w=200;h=200|><|mask;x=0;y=0;c=0.9;${DIAGONAL_4X6}|>`);
  // 46x101 striped raster: contains the coin tap, coin-sized, but not a disc.
  const coinBox: SamBox = { x1: 10, y1: 10, x2: 110, y2: 55, w: width, h: height, confidence: 0.8 };
  const coinStream = samStream(`<0f>0<|box;x1=10;y1=10;x2=110;y2=55;w=200;h=200;c=0.8|><|mask;x=0;y=0;c=0.8;data=46,101,!!!!!)Qf!wEg{8E|>`);

  const expectedMask = createMask(width, height);
  for (let i = 0; i < 4; i++) expectedMask.data[(10 + i) * width + (10 + i)] = 1;
  const expected = measureSession({
    component: { id: "photo", areaPx: width * height, confidence: 1 },
    masks: [observeMask(expectedMask, { id: "damage-1", label: "crack", confidence: 0.9 })],
  });

  let samCalls = 0;
  const fetchFn = (async (url: unknown) => {
    if (String(url).endsWith("/responses")) {
      const stream = samCalls++ === 0 ? damageStream : coinStream;
      return { ok: true, status: 200, text: async () => stream } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(citingDrafts(expected.findings)) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const res = await handleRequest({
    method: "POST",
    path: "/v1/claim",
    body: {
      imageUrl: "data:image/jpeg;base64,AAA",
      width,
      height,
      damage: [{ x: 10, y: 10, label: "crack" }],
      coin: { x: 10, y: 10, knownMm: 24.26 },
      transcript: "crack with a coin beside it",
    },
    env: LIVE_ENV,
    fetchFn,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const reply = res.body as ClaimReply;
  assert.equal(samCalls, 2, "one damage call + one coin call");
  assert.ok(reply.result.referenceCheck?.rejected, "the non-coin outline is refused, never measured");
  assert.equal(reply.result.measurement.mode, "percent-only");
  assert.equal(reply.result.gate.ok, true);
});

test("claim is billed like the other expensive routes", () => {
  assert.equal(rateLimitMaxForPath("POST", "/v1/claim"), 20);
});

test("claim runs on the caller's key: no worker secret, no operator spend", async () => {
  const width = 60;
  const height = 27;
  const stream = samStream(`<0f>0<|box;x1=10;y1=10;x2=15;y2=13;w=${width};h=${height}|><|mask;x=0;y=0;c=0.9;${DIAGONAL_4X6}|>`);
  const expectedMask = createMask(width, height);
  for (let i = 0; i < 4; i++) expectedMask.data[(10 + i) * width + (10 + i)] = 1;
  const expected = measureSession({
    component: { id: "photo", areaPx: width * height, confidence: 1 },
    masks: [observeMask(expectedMask, { id: "damage-1", label: "crack", confidence: 0.9 })],
  });

  const tokens: string[] = [];
  const fetchFn = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    tokens.push(init?.headers?.authorization ?? "");
    if (String(url).endsWith("/responses")) {
      return { ok: true, status: 200, text: async () => stream } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(citingDrafts(expected.findings)) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  resetSpendForTests();
  // Live backend with NO META_API_KEY secret: the only key in play is the caller's.
  const res = await handleRequest({
    method: "POST",
    path: "/v1/claim",
    body: { imageUrl: "data:image/jpeg;base64,AAA", width, height, damage: [{ x: 10, y: 10, label: "crack" }], render: false },
    env: { MOCK_MODE: "0" },
    fetchFn,
    headers: { "x-meta-key": "  caller-key  " },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(tokens.length, 2, "SAM and findings both ran on the caller's key");
  assert.ok(tokens.every((token) => token === "Bearer caller-key"), tokens.join(" | "));

  // BYOK means the caller's upstream quota pays, so the operator ledger stays empty.
  const ledger = spendStatus({ MOCK_MODE: "0" });
  assert.equal(ledger.spentUsd, 0);
  assert.equal(ledger.entries.length, 0);
  resetSpendForTests();
});

test("claim stays pixel-verified under REQUIRE_PIXEL_PROVENANCE=1", async () => {
  const body = {
    masks: [{ id: "damage-1", label: "crack", rle: toRle(photographed(1, 0, crack(0, 0, 200, 0))), confidence: 0.9 }],
    reference: { ...COIN, rle: toRle(photographed(1, 0, coin)) },
    transcript: "crack across the wall",
  };
  const res = await handleRequest({ method: "POST", path: "/v1/claim", body, env: { REQUIRE_PIXEL_PROVENANCE: "1" } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const reply = res.body as ClaimReply;
  assert.equal(reply.result.measurement.provenance, "pixel-verified");
  assert.equal(reply.result.measurement.mode, "absolute");
});

test("claim honours the REQUIRE_BILLING_AUTH lockdown", async () => {
  const body = {
    masks: [{ id: "damage-1", label: "crack", rle: toRle(photographed(1, 0, crack(0, 0, 200, 0))), confidence: 0.9 }],
    transcript: "crack across the wall",
  };
  const locked = { REQUIRE_BILLING_AUTH: "1", ADMIN_TOKEN: "a".repeat(32) };
  const denied = await handleRequest({ method: "POST", path: "/v1/claim", body, env: locked });
  assert.equal(denied.status, 401);
  const allowed = await handleRequest({
    method: "POST",
    path: "/v1/claim",
    body,
    env: locked,
    headers: { authorization: `Bearer ${"a".repeat(32)}` },
  });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
});

test("claim errors, never empties, when a tap lands on nothing", async () => {
  const width = 60;
  const height = 27;
  // Only the wall came back: over half the frame, so it is dropped.
  const line = `<0f>0<|box;x1=0;y1=0;x2=59;y2=26;w=${width};h=${height};c=0.95|><|mask;x=0;y=0;c=0.95;${FULL_27X60}|>`;
  const stream = samStream(line);
  const fetchFn = (async () => ({ ok: true, status: 200, text: async () => stream }) as unknown as Response) as unknown as typeof fetch;
  const res = await handleRequest({
    method: "POST",
    path: "/v1/claim",
    body: { imageUrl: "data:image/jpeg;base64,AAA", width, height, damage: [{ x: 10, y: 10, label: "crack" }], render: false },
    env: LIVE_ENV,
    fetchFn,
  });
  assert.equal(res.status, 422);
  assert.match((res.body as { error: string }).error, /SAM found no crack under damage\[0\]/);
});
