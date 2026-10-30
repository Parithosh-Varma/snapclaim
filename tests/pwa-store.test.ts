import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createCaseStore, type StorageLike } from "../pwa/store.js";

function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

test("case store saves, lists newest first, updates in place", () => {
  let tick = 0;
  const store = createCaseStore(memStorage(), { now: () => `2026-10-0${++tick}T00:00:00Z`, makeId: () => `id-${tick}` });
  const a = store.save({ name: "A", label: "crack", percent: 5 });
  store.save({ name: "B", label: "stain", percent: 2 });
  assert.equal(store.list().length, 2);
  assert.equal(store.list()[0]?.name, "B", "newest first");
  const a2 = store.save({ id: a.id, name: "A edited" });
  assert.equal(a2.createdAt, a.createdAt, "createdAt survives edits");
  assert.equal(store.list().length, 2, "edit does not duplicate");
  assert.equal(store.get(a.id)?.name, "A edited");
});

test("case store removes, clears and exports", () => {
  const store = createCaseStore(memStorage(), { makeId: () => "x1" });
  store.save({ name: "Only" });
  store.remove("x1");
  assert.equal(store.list().length, 0);
  store.save({ name: "Again" });
  const exported = JSON.parse(store.exportAll()) as { app: string; cases: unknown[] };
  assert.equal(exported.app, "snapclaim");
  assert.equal(exported.cases.length, 1);
  store.clear();
  assert.equal(store.list().length, 0);
  assert.ok(store.bytesUsed() >= 0);
});

test("case store drops the photo instead of losing the case on quota", () => {
  const small: StorageLike = {
    getItem: () => null,
    setItem: (_k, v) => { if (v.length > 200) throw new Error("quota"); },
    removeItem: () => {},
  };
  // getItem always null means each write starts empty; the photo makes it exceed.
  const store = createCaseStore(small, { makeId: () => "q1" });
  const saved = store.save({ name: "Big photo", photo: `data:image/jpeg;base64,${"A".repeat(500)}` });
  assert.equal(saved.photo, null);
  assert.equal(saved.photoDropped, true);
});

test("case store settings round-trip and survive case wipe", () => {
  const storage = memStorage();
  const store = createCaseStore(storage);
  assert.deepEqual(store.getSettings(), {});
  store.setSettings({ theme: "dark" });
  store.setSettings({ donate: true });
  assert.deepEqual(store.getSettings(), { theme: "dark", donate: true });
  store.save({ name: "C" });
  store.clear();
  assert.deepEqual(store.getSettings(), { theme: "dark", donate: true }, "wipe clears cases, not settings");
});

test("case store tolerates corrupt stored JSON", () => {
  const storage = memStorage();
  storage.setItem("snapclaim.cases.v1", "{not json");
  const store = createCaseStore(storage);
  assert.deepEqual(store.list(), []);
});
