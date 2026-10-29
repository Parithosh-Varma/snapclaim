import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleRequest } from "../backend/app.ts";

const IMG = "data:image/jpeg;base64," + "A".repeat(100);

function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (/INSERT INTO donations/i.test(query)) {
                const [id, created_at, , image, label, coin_mm, transcript, masks_json, receipts_json, user_agent] = values;
                rows.push({ id, created_at, image, label, coin_mm, transcript, masks_json, receipts_json, user_agent });
              }
              return { success: true };
            },
            async first<T>() {
              if (/COUNT\(\*\)/i.test(query)) return { n: rows.length } as unknown as T;
              return null;
            },
          };
        },
      };
    },
  };
}

test("collect requires opt-in consent", async () => {
  const db = fakeDb();
  const res = await handleRequest({
    method: "POST", path: "/v1/collect",
    body: { consent: false, image: IMG },
    env: { snapclaim_data: db } as never,
  });
  assert.equal(res.status, 400);
});

test("collect rejects non-image payloads", async () => {
  const db = fakeDb();
  const res = await handleRequest({
    method: "POST", path: "/v1/collect",
    body: { consent: true, image: "https://example.com/x.jpg" },
    env: { snapclaim_data: db } as never,
  });
  assert.equal(res.status, 400);
});

test("collect stores a donation and count reflects it", async () => {
  const db = fakeDb();
  const env = { snapclaim_data: db } as never;
  const res = await handleRequest({
    method: "POST", path: "/v1/collect",
    body: { consent: true, image: IMG, label: "crack", coinMm: 27, userAgent: "test" },
    env,
  });
  assert.equal(res.status, 200);
  assert.equal(db.rows.length, 1);
  const count = await handleRequest({ method: "GET", path: "/v1/collect/count", env });
  assert.equal(count.status, 200);
  assert.equal((count.body as { result: { count: number } }).result.count, 1);
});

test("collect without a D1 binding fails closed with 503", async () => {
  const res = await handleRequest({
    method: "POST", path: "/v1/collect",
    body: { consent: true, image: IMG },
    env: {},
  });
  assert.equal(res.status, 503);
});
