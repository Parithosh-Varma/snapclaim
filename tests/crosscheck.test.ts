import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleRequest } from "../backend/app.ts";
import worker from "../backend/worker.ts";

const rle = (rows: string[]): { size: [number, number]; counts: number[] } => {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const counts: number[] = [];
  let cur = 0;
  let run = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const v = rows[y]?.[x] === "#" ? 1 : 0;
      if (v === cur) run++;
      else {
        counts.push(run);
        cur = v;
        run = 1;
      }
    }
  }
  counts.push(run);
  return { size: [h, w], counts };
};

test("crosscheck scores agreement between two frame masks", async () => {
  const a = rle(["##.", "##.", "..."]);
  const b = rle(["###", "...", "..."]);
  const res = await handleRequest({ method: "POST", path: "/v1/crosscheck", body: { a, b }, env: {} });
  assert.equal(res.status, 200);
  const result = (res.body as { result: { iou: number; dice: number; verdict: string } }).result;
  assert.equal(result.iou, 0.4);
  assert.equal(result.verdict, "DISPUTED");
  const loose = await handleRequest({ method: "POST", path: "/v1/crosscheck", body: { a, b, threshold: 0.3 }, env: {} });
  assert.equal((loose.body as { result: { verdict: string } }).result.verdict, "AGREED");
});

test("crosscheck refuses missing masks and size mismatches", async () => {
  const missing = await handleRequest({ method: "POST", path: "/v1/crosscheck", body: {}, env: {} });
  assert.equal(missing.status, 400);
  const mismatch = await handleRequest({
    method: "POST",
    path: "/v1/crosscheck",
    body: { a: rle(["##", "##"]), b: rle(["###", "###", "###"]) },
    env: {},
  });
  assert.equal(mismatch.status, 422);
});

test("worker rejects oversized bodies and routes unknown paths", async () => {
  const big = await worker.fetch(
    new Request("https://x/v1/measure", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1000001" },
      body: "{}",
    }),
    {},
  );
  assert.equal(big.status, 400);
  // Multibyte bypass: 400k CJK chars are under 1M UTF-16 units but ~1.2M
  // bytes. The cap is bytes (parity with the Node streaming cap), so reject.
  const wide = await worker.fetch(
    new Request("https://x/v1/measure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "あ".repeat(400_000) }),
    }),
    {},
  );
  assert.equal(wide.status, 400);
  const unknown = await worker.fetch(new Request("https://x/v1/nope", { method: "GET" }), {});
  assert.equal(unknown.status, 404);
  // The Worker's own 404 envelope fingerprints a stale deploy: method + path included.
  const unknownBody = (await unknown.json()) as { ok: boolean; error: string; details: unknown };
  assert.equal(unknownBody.error, "not found");
  assert.deepEqual(unknownBody.details, { method: "GET", path: "/v1/nope" });
  const health = await worker.fetch(new Request("https://x/v1/health", { method: "GET" }), {});
  assert.equal(health.status, 200);
});
