import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleRequest } from "../backend/app.ts";
import { D1Store, MemoryStore, SESSION_LIST_LIMIT, type D1Database, type D1PreparedStatement, type SavedSession } from "../backend/store.ts";

function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_sessions.sql", import.meta.url), "utf8"));
  const make = (sql: string, args: unknown[]): D1PreparedStatement => ({
    bind: (...v: unknown[]) => make(sql, v),
    run: async () => db.prepare(sql).run(...(args as never[])),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
  });
  return { prepare: (sql: string) => make(sql, []) };
}

const sess = (n: number): SavedSession => ({
  id: `id-${n}`,
  at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  findings: n,
  mode: "absolute",
});

test("D1Store round-trip", async () => {
  const store = new D1Store(fakeD1());
  await store.save(sess(1));
  assert.deepEqual(await store.list(), [sess(1)]);
});

test("D1Store caps at 50, latest first", async () => {
  const store = new D1Store(fakeD1());
  for (let i = 0; i < 60; i++) await store.save(sess(i));
  const out = await store.list();
  assert.equal(out.length, SESSION_LIST_LIMIT);
  assert.equal(out[0]?.id, "id-59");
  assert.equal(out[49]?.id, "id-10");
});

test("MemoryStore caps at 50, latest first", async () => {
  const store = new MemoryStore();
  for (let i = 0; i < 60; i++) await store.save(sess(i));
  const out = await store.list();
  assert.equal(out.length, SESSION_LIST_LIMIT);
  assert.equal(out[0]?.id, "id-59");
  assert.equal(out[49]?.id, "id-10");
});

test("POST then GET /v1/sessions through the D1-backed store", async () => {
  const store = new D1Store(fakeD1());
  const post = await handleRequest({ method: "POST", path: "/v1/sessions", body: { findings: 3, mode: "percent-only", extra: "x" }, store });
  assert.equal(post.status, 200);
  const saved = (post.body as { result: SavedSession }).result;
  assert.equal(saved.findings, 3);
  assert.ok(saved.id && !Number.isNaN(Date.parse(saved.at)));
  assert.equal("extra" in saved, false);
  const get = await handleRequest({ method: "GET", path: "/v1/sessions", store });
  assert.equal(get.status, 200);
  assert.deepEqual((get.body as { result: { sessions: SavedSession[] } }).result.sessions, [saved]);
});

test("POST /v1/sessions rejects bad bodies with 400", async () => {
  const store = new MemoryStore();
  const bad: unknown[] = [
    null, "x", [1],
    { findings: -1, mode: "absolute" },
    { findings: 1.5, mode: "absolute" },
    { findings: "2", mode: "absolute" },
    { findings: 1, mode: "bogus" },
    { findings: 1 },
    // NOTE: client-supplied id is ignored (server mints UUIDs), so {id: 5}
    // is no longer in the bad list — it saves with a fresh id.
    { findings: 1, mode: "absolute", at: 5 },
    { findings: 1, mode: "absolute", at: "not a date" },
  ];
  for (const body of bad) {
    const r = await handleRequest({ method: "POST", path: "/v1/sessions", body, store });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(await store.list(), []);
});

test("unknown route is still 404", async () => {
  const r = await handleRequest({ method: "GET", path: "/v1/nope", env: {} });
  assert.equal(r.status, 404);
});
