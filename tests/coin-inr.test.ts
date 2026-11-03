import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

function parseCoinModel(src: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of src.matchAll(/id:\s*'INR-(\d+)'[^}]*?diam:\s*([\d.]+)/g)) {
    out.set(m[1]!, Number(m[2]));
  }
  return out;
}

function parsePwaOptions(html: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of html.matchAll(/<option value="([\d.]+)">India ₹(\d+) · ([\d.]+) mm[^<]*<\/option>/g)) {
    assert.equal(Number(m[1]), Number(m[3]), `option value matches label for ₹${m[2]}`);
    out.set(m[2]!, Number(m[1]));
  }
  return out;
}

function parseSessionOptions(src: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of src.matchAll(/\{\s*value:\s*([\d.]+),\s*label:\s*"India ₹(\d+) · ([\d.]+) mm[^"]*"/g)) {
    assert.equal(Number(m[1]), Number(m[3]), `COIN_OPTIONS value matches label for ₹${m[2]}`);
    out.set(m[2]!, Number(m[1]));
  }
  return out;
}

test("INR coin diameters agree across pickers and coin-model tables", () => {
  const sources: Record<string, Map<string, number>> = {
    "pwa/coin-model.js": parseCoinModel(read("pwa/coin-model.js")),
    "react/public/coin-model.js": parseCoinModel(read("react/public/coin-model.js")),
    "pwa/index.html": parsePwaOptions(read("pwa/index.html")),
    "react/src/lib/session.ts": parseSessionOptions(read("react/src/lib/session.ts")),
  };
  for (const [name, table] of Object.entries(sources)) {
    assert.ok(table.size >= 4, `${name} lists the four INR denominations (got ${table.size})`);
  }
  const denoms = [...sources["pwa/coin-model.js"]!.keys()].sort();
  for (const [name, table] of Object.entries(sources)) {
    assert.deepEqual([...table.keys()].sort(), denoms, `${name} covers the same INR denominations`);
  }
  for (const [name, table] of Object.entries(sources)) {
    assert.equal(table.get("2"), 25, `${name}: INR-2 is 25 mm nominal`);
    assert.equal(table.get("5"), 27, `${name}: INR-5 is 27 mm measured`);
  }
  for (const d of denoms) {
    const values = new Set(Object.values(sources).map((t) => t.get(d)));
    assert.equal(values.size, 1, `INR-${d} agrees everywhere (got ${[...values].join(", ")})`);
  }
});

test("Rs 2 keeps varies-by-issue note and custom diameter input exists", () => {
  assert.match(read("pwa/index.html"), /sizes vary by issue/, "PWA picker says sizes vary by issue");
  assert.match(read("pwa/index.html"), /id="coinCustomMm"/, "PWA has custom diameter input");
  assert.match(read("react/src/screens/Mark.tsx"), /id="coinCustomMm"/, "React has custom diameter input");
  for (const f of ["pwa/coin-model.js", "react/public/coin-model.js"] as const) {
    assert.match(read(f), /varies by issue/, `${f} notes the coin varies by issue`);
  }
});
