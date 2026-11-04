import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createCaseStore, type StorageLike } from "../react/src/lib/store.ts";

function failingStorage(): StorageLike {
  return {
    getItem: () => null,
    setItem: (_k, v) => { if (v.length > 200) throw new Error("quota"); },
    removeItem: () => {},
  };
}

test("react case store drops the location photo instead of losing the case on quota", () => {
  const store = createCaseStore(failingStorage(), { makeId: () => "q1" });
  const saved = store.save({
    name: "Big location",
    photo: `data:image/jpeg;base64,${"A".repeat(250)}`,
    locationPhoto: `data:image/jpeg;base64,${"B".repeat(250)}`,
  });
  assert.equal(saved.photo, null);
  assert.equal(saved.photoDropped, true);
  assert.equal(saved.locationPhoto, null);
  assert.equal(saved.locationDropped, true);
});

test("react case store serves repeat lists from a memo, not a re-parse", () => {
  const map = new Map<string, string>();
  const store = createCaseStore({
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  }, { makeId: () => "m1" });
  store.save({ name: "Memo", photo: `data:image/jpeg;base64,${"D".repeat(100)}` });
  // The memo skips JSON.parse of the photo payloads, not the cheap
  // storage read (getItem runs first as the cache key), so count parses.
  const realParse = JSON.parse;
  let parses = 0;
  JSON.parse = ((...args: [text: string]) => { parses++; return realParse(...args); }) as typeof JSON.parse;
  try {
    store.list();
    store.list();
    store.get("m1");
  } finally {
    JSON.parse = realParse;
  }
  assert.equal(parses, 1, "one parse feeds every repeat read");
  store.save({ name: "Memo 2" });
  const before = parses;
  JSON.parse = ((...args: [text: string]) => { parses++; return realParse(...args); }) as typeof JSON.parse;
  try {
    store.list();
  } finally {
    JSON.parse = realParse;
  }
  assert.ok(parses > before, "a write invalidates the memo");
});

test("react case store drops an oversized location photo but keeps the case", () => {
  const map = new Map<string, string>();
  const store = createCaseStore({
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  }, { makeId: () => "big-loc" });
  const huge = `data:image/jpeg;base64,${"C".repeat(800_000)}`;
  const saved = store.save({ name: "Huge location", locationPhoto: huge });
  assert.equal(saved.locationPhoto, null);
  assert.equal(saved.locationDropped, true);
  assert.equal(saved.name, "Huge location");
});
