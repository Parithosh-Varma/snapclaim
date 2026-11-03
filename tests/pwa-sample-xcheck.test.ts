import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const app = readFileSync(new URL("../pwa/app.js", import.meta.url), "utf8");

test("sample run resolves the cross-check so the report unlocks", () => {
  const xcheck = app.match(/async function runXcheck\(auto\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const sampleBranch = xcheck.indexOf("if (sampleRun && !dmg.mask)");
  const earlyReturn = xcheck.indexOf('"Mark the damage first."');
  assert.ok(sampleBranch > 0, "runXcheck has a sample branch");
  assert.ok(sampleBranch < earlyReturn, "sample branch runs before the no-mask early return");
  assert.ok(xcheck.slice(sampleBranch, earlyReturn).includes('setCheck("xcheck", "ok")'), "sample branch settles the check");
});

test("sampleRun is set by the sample and cleared by a real photo", () => {
  const sample = app.match(/async function loadSample\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(sample.includes("sampleRun = true"), "loadSample sets sampleRun");
  const mark = app.match(/function setupMarkPhoto\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(mark.includes("sampleRun = false"), "setupMarkPhoto clears sampleRun");
});
