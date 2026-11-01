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
