import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleRequest } from "../backend/app.ts";
import { measureSession } from "../src/engine/measure.ts";
import { citingDrafts, LIVE_ENV } from "./helpers.ts";

const W = 120;
const H = 80;

/** Uncompressed COCO RLE (column-major runs, starting with background) for a predicate mask. */
function rle(inside: (x: number, y: number) => boolean): { size: [number, number]; counts: number[] } {
  const counts: number[] = [];
  let current = 0;
  let run = 0;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const v = inside(x, y) ? 1 : 0;
      if (v !== current) {
        counts.push(run);
        run = 0;
        current = v;
      }
      run++;
    }
  }
  counts.push(run);
  return { size: [H, W], counts };
}

const crack = rle((x, y) => x >= 10 && x < 100 && Math.abs(y - 20 - x / 5) < 2);
const coin = rle((x, y) => (x - 95) ** 2 + (y - 60) ** 2 <= 12 ** 2);

async function observe(withCoin = true) {
  const res = await handleRequest({
    method: "POST",
    path: "/v1/observe",
    body: {
      masks: [{ id: "damage-1", label: "crack", rle: crack, confidence: 0.9 }],
      ...(withCoin ? { reference: { id: "coin", rle: coin, knownMm: 24.26, confidence: 0.95 } } : {}),
    },
    env: LIVE_ENV,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return (res.body as { result: Record<string, any> }).result;
}

test("/v1/observe returns outlines of the measured masks and the coin", async () => {
  const result = await observe();
  assert.equal(result.overlay.width, W);
  assert.equal(result.overlay.height, H);
  assert.deepEqual(result.overlay.masks.map((m: { label: string }) => m.label), ["crack", "coin"]);
  for (const m of result.overlay.masks) assert.match(m.path, /^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+)+ Z/);

  // /v1/measure ignores the extra keys and measures as before.
  const measured = await handleRequest({ method: "POST", path: "/v1/measure", body: result, env: LIVE_ENV });
  assert.equal(measured.status, 200, JSON.stringify(measured.body));
});

test("/v1/render draws the photo and outlines in the annexure", async () => {
  const result = await observe();
  const session = measureSession(result as never);
  const photoHref = "data:image/jpeg;base64,AAAA";
  const res = await handleRequest({
    method: "POST",
    path: "/v1/render",
    body: { ...result, overlay: { ...result.overlay, photoHref }, drafts: citingDrafts(session.findings), transcript: "crack by the window" },
    env: LIVE_ENV,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const svg = (res.body as { result: { svg: string } }).result.svg;
  assert.ok(svg.includes(`href="${photoHref}"`));
  assert.ok(svg.includes('data-mask="damage-1"') && svg.includes('data-mask="coin"'));
  assert.ok(svg.includes("#0f7a36"), "coin outline in green");
});

test("/v1/render refuses an overlay path that is not plain path data", async () => {
  const result = await observe(false);
  const session = measureSession(result as never);
  const overlay = { ...result.overlay, masks: [{ id: "damage-1", label: "crack", path: 'M 0 0" onload="x' }] };
  const res = await handleRequest({
    method: "POST",
    path: "/v1/render",
    body: { ...result, overlay, drafts: citingDrafts(session.findings) },
    env: LIVE_ENV,
  });
  assert.equal(res.status, 400);
});
