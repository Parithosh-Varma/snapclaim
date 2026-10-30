import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

test("PWA backend URL has one source of truth and one visible input", () => {
  const html = read("pwa/index.html");
  const app = read("pwa/app.js");

  // One editable input (Settings). The Report developer panel only shows the value.
  assert.ok(html.includes('id="baseUrl2"'), "Settings keeps the single editable backend input");
  assert.ok(!html.match(/<input[^>]*id="baseUrl"[^>]*>/), "no second editable backend input in the developer panel");
  assert.ok(html.includes('id="baseUrlShow"'), "developer panel shows the value instead of editing it");
  assert.ok(!html.match(/<input[^>]*id="baseUrl2"[^>]*style=/), "backend input carries no inline light-only style");

  // Single source of truth in JS: a persisted variable, not the DOM.
  assert.ok(app.includes('BACKEND_KEY = "snapclaim.backendUrl"'), "backend URL persists to one localStorage key");
  assert.ok(app.includes("let backendUrl"), "one backendUrl variable is the source of truth");
  const baseBody = app.match(/function base\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(!baseBody.includes("$("), "base() reads the variable, never the DOM");
  assert.ok(!app.includes('$("baseUrl")'), "no references left to the removed input");
  assert.ok(app.includes("syncBackendInputs"), "views sync from the variable, not from each other");
});

test("PWA inputs, labels and checkboxes are theme-styled with a visible focus ring", () => {
  const html = read("pwa/index.html");
  assert.ok(html.includes("input[type=\"checkbox\"]{accent-color:var(--coin)"), "native checkbox uses accent-color");
  assert.ok(html.includes("html[data-theme=\"dark\"] label.field"), "labels stay readable in dark mode");
  assert.ok(html.includes("html[data-theme=\"auto\"] label.field"), "labels stay readable in auto-dark mode");
  assert.ok(html.includes("html[data-theme=\"dark\"] .field-input"), "backend input is dark-styled");
  assert.ok(html.includes("input:focus-visible"), "keyboard focus ring covers inputs");
  assert.ok(html.includes(".field-input{min-height:46px"), "backend input keeps a 44px+ touch target");
});

test("React mirrors the single backend input and theme-styled fields", () => {
  const report = read("react/src/screens/Report.tsx");
  const tabs = read("react/src/screens/Tabs.tsx");
  const css = read("react/src/styles.css");
  assert.ok(!report.match(/<input[^>]*id="baseUrl"/), "React developer panel no longer edits the backend inline");
  assert.ok(report.includes('id="baseUrl"'), "React developer panel still displays the backend value");
  assert.ok(report.includes('id="healthBtn"') && report.includes('id="healthOut"'), "React Check backend button and status stay");
  assert.ok(tabs.includes('id="baseUrl2"') && tabs.includes("text-input"), "React Settings keeps the styled editable input");
  assert.ok(css.includes(".text-input"), "backend input styled via CSS theme variables");
  assert.ok(css.includes("html[data-theme=\"dark\"] .text-input"), "backend input is dark-styled");
  assert.ok(css.includes("input:focus-visible"), "React keyboard focus ring covers inputs");
});
