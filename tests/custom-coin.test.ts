import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  customCoinError,
  loadLastCustomCoin,
  parseCustomCoinMm,
  saveLastCustomCoin,
} from "../react/src/lib/session.ts";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

function stubStorage(): Map<string, string> {
  const m = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
  return m;
}

test("custom coin accepts 15–40 with at most one decimal", () => {
  for (const ok of ["15", "15.0", "24.3", "27", "40", "40.0", " 24.3 "]) {
    assert.notEqual(parseCustomCoinMm(ok), null, `${ok} valid`);
    assert.equal(customCoinError(ok), null, `${ok} no error`);
  }
  assert.equal(parseCustomCoinMm("27"), 27);
  assert.equal(parseCustomCoinMm("24.3"), 24.3);
});

test("custom coin rejects out-of-range and two-decimal values with a message", () => {
  for (const bad of ["14.9", "14", "40.1", "41", "0", "24.26", "24.33", "abc", "24,3", "15.00", "--20", ""]) {
    if (bad === "") {
      assert.equal(parseCustomCoinMm(bad), null);
      assert.equal(customCoinError(bad), null, "empty means no custom, no error");
      continue;
    }
    assert.equal(parseCustomCoinMm(bad), null, `${bad} invalid`);
    assert.match(customCoinError(bad) ?? "", /15–40.*one decimal/, `${bad} explains the rule`);
  }
});

test("custom coin remembers the last valid value the way last-coin does", () => {
  stubStorage();
  assert.equal(loadLastCustomCoin(), null);
  saveLastCustomCoin("24.3");
  assert.equal(loadLastCustomCoin(), 24.3);
  saveLastCustomCoin("99");
  assert.equal(loadLastCustomCoin(), 24.3, "invalid does not overwrite");
  saveLastCustomCoin("");
  assert.equal(loadLastCustomCoin(), 24.3, "empty input keeps the remembered value in session helper");
});

test("both apps validate the same rule and surface an inline message", () => {
  const pwa = read("pwa/app.js");
  assert.match(pwa, /15.*40/, "PWA names the range");
  assert.match(pwa, /one decimal at most/, "PWA explains one decimal");
  assert.match(pwa, /coinHintMark/, "PWA shows the message inline under the picker");
  assert.ok(pwa.includes("parseCustomCoinMm") && pwa.includes("customCoinError"), "PWA carries the shared rule");
  assert.ok(pwa.includes("snapclaim.lastCustomCoin"), "PWA remembers custom separately like last-coin");
  const mark = read("react/src/screens/Mark.tsx");
  assert.match(mark, /coinCustomErr/, "React renders the inline error");
  assert.match(mark, /id="coinCustomErr"/, "React error has a stable id");
  assert.ok(mark.includes("parseCustomCoinMm") && mark.includes("saveLastCustomCoin"), "React uses the shared helpers");
});
