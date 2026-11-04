import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

const BILLABLE = ["/v1/segment", "/v1/transcribe", "/v1/report", "/v1/skeptic", "/v1/render"];
const KEYLESS = ["/v1/measure", "/v1/observe", "/v1/crosscheck"];

/** The fetch(...) call for a route, up to its options object's headers. */
function fetchCall(app: string, route: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`fetch\\(base\\(\\) \\+ "${route.replace(/\//g, "\\/")}"[\\s\\S]{0,200}?headers: ([^,}]+(?:\\})?)`, "g");
  for (const m of app.matchAll(re)) out.push(m[1] ?? "");
  return out;
}

test("PWA settings has a BYOK block with masked inputs", () => {
  const html = read("pwa/index.html");
  for (const id of ["byokMeta", "byokBaseten", "byokRemember", "byokSave", "byokClear", "byokStatus"]) {
    assert.ok(html.includes(`id="${id}"`), `Settings has #${id}`);
  }
  assert.match(html, /<input id="byokMeta"[^>]*type="password"[^>]*autocomplete="off"/);
  assert.match(html, /<input id="byokBaseten"[^>]*type="password"[^>]*autocomplete="off"/);
});

test("billable routes send caller keys, keyless routes do not", () => {
  const app = read("pwa/app.js");
  for (const route of BILLABLE) {
    const calls = fetchCall(app, route);
    assert.ok(calls.length > 0, `found the ${route} fetch`);
    for (const h of calls) assert.equal(h.trim(), "apiHeaders()", `${route} uses apiHeaders()`);
  }
  for (const route of KEYLESS) {
    for (const h of fetchCall(app, route)) assert.ok(!h.includes("apiHeaders"), `${route} never carries caller keys`);
  }
  assert.ok(app.includes('h["x-meta-key"] = meta'), "apiHeaders sets x-meta-key");
  assert.ok(app.includes('h["x-baseten-key"] = baseten'), "apiHeaders sets x-baseten-key");
});

test("caller keys default to sessionStorage and match the worker's length cap", () => {
  const app = read("pwa/app.js");
  assert.match(app, /byokRemembered\(\) \? localStorage : sessionStorage/);
  assert.ok(app.includes("BYOK_MAX_CHARS = 512"), "client cap matches MAX_CALLER_KEY_CHARS");
  const backend = read("backend/app.ts");
  assert.ok(backend.includes("MAX_CALLER_KEY_CHARS = 512"), "worker cap is still 512");
  assert.ok(backend.includes("x-meta-key, x-baseten-key"), "CORS still allows both headers");
});
