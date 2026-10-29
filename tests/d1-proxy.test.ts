import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleRequest } from "../backend/app.ts";
import { executeRemoteD1 } from "../backend/d1-proxy.ts";

const IMG = "data:image/jpeg;base64," + "B".repeat(100);
const ACCT = "18c0b10f1f40932c837b55bc008e78e1";
const DBID = "025734a5-ba8b-4e8d-8736-270987c2f181";
const PROXY_ENV = {
  D1_PROXY_TOKEN: "tok",
  D1_PROXY_ACCOUNT_ID: ACCT,
  D1_PROXY_DATABASE_ID: DBID,
} as never;

function stubFetch(handler: (url: string, init: { headers: Record<string, string>; body: string }) => unknown): typeof fetch {
  return (async (url: unknown, init: unknown) => {
    const out = handler(String(url), init as { headers: Record<string, string>; body: string });
    return { ok: true, status: 200, json: async () => out } as unknown as Response;
  }) as typeof fetch;
}

test("collect falls back to the cross-account D1 proxy without a binding", async () => {
  let sawUrl = "", sawAuth = "", sawBody = "";
  const fetchFn = stubFetch((url, init) => {
    sawUrl = url; sawAuth = init.headers.authorization ?? ""; sawBody = String(init.body);
    return { success: true, errors: [], result: [{ results: [] }] };
  });
  const res = await handleRequest({
    method: "POST", path: "/v1/collect",
    body: { consent: true, image: IMG, label: "crack" },
    env: PROXY_ENV, fetchFn,
  });
  assert.equal(res.status, 200);
  assert.ok(sawUrl.includes(`/accounts/${ACCT}/d1/database/${DBID}/query`));
  assert.equal(sawAuth, "Bearer tok");
  assert.ok(sawBody.includes("INSERT INTO donations"));
});

test("collect count falls back to the proxy without a binding", async () => {
  const fetchFn = stubFetch(() => ({ success: true, errors: [], result: [{ results: [{ n: 7 }] }] }));
  const res = await handleRequest({ method: "GET", path: "/v1/collect/count", env: PROXY_ENV, fetchFn });
  assert.equal(res.status, 200);
  assert.equal((res.body as { result: { count: number } }).result.count, 7);
});

test("d1 relay fails closed without a configured key", async () => {
  const res = await handleRequest({
    method: "POST", path: "/v1/d1/query",
    body: { key: "x", apiToken: "t", accountId: ACCT, databaseId: DBID, sql: "SELECT 1" },
    env: {},
  });
  assert.equal(res.status, 503);
});

test("d1 relay rejects a wrong key with 403", async () => {
  const res = await handleRequest({
    method: "POST", path: "/v1/d1/query",
    body: { key: "wrong", apiToken: "t", accountId: ACCT, databaseId: DBID, sql: "SELECT 1" },
    env: { D1_PROXY_KEY: "right" } as never,
  });
  assert.equal(res.status, 403);
});

test("d1 relay forwards any db query with the right key", async () => {
  const fetchFn = stubFetch(() => ({ success: true, errors: [], result: [{ results: [{ n: 3 }] }] }));
  const res = await handleRequest({
    method: "POST", path: "/v1/d1/query",
    body: { key: "right", apiToken: "t", accountId: ACCT, databaseId: DBID, sql: "SELECT COUNT(*) AS n FROM donations" },
    env: { D1_PROXY_KEY: "right" } as never, fetchFn,
  });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { result: { rows: unknown[] } }).result.rows, [{ n: 3 }]);
});

test("d1 relay rejects malformed account ids", async () => {
  const res = await handleRequest({
    method: "POST", path: "/v1/d1/query",
    body: { key: "right", apiToken: "t", accountId: "not-an-id!!", databaseId: DBID, sql: "SELECT 1" },
    env: { D1_PROXY_KEY: "right" } as never,
    fetchFn: stubFetch(() => ({})),
  });
  assert.equal(res.status, 400);
});

test("remote D1 API failures surface as 502, never silent", async () => {
  const fetchFn = (async () => ({
    ok: false, status: 403, json: async () => ({ success: false, errors: [{ message: "forbidden" }] }),
  })) as unknown as typeof fetch;
  await assert.rejects(
    () => executeRemoteD1({ fetchFn, apiToken: "t", accountId: ACCT, databaseId: DBID, sql: "SELECT 1" }),
    (e: Error) => /remote D1 failed: forbidden/.test(e.message),
  );
});
