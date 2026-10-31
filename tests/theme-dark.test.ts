import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

// Warm graphite dark palette (design contract, not an accident of one file).
const BG = "#141310";
const SURFACE = "#1d1b17";
const RAISED = "#27241e";
const TEXT = "#ece7dc";
const MUTED = "#ada595";
const ACCENT = "#52d18a";

const APPS = [
  { name: "pwa", theme: "pwa/theme.js", html: "pwa/index.html", css: "pwa/index.html" },
  { name: "react", theme: "react/public/theme.js", html: "react/index.html", css: "react/src/styles.css" },
] as const;

/** Everything from the dark-theme marker onward: both the forced-dark rules
 *  and the auto-dark copy live there. */
function darkSection(htmlPath: string): string {
  const css = read(htmlPath);
  const at = css.indexOf("/* ---------- dark theme");
  assert.ok(at >= 0, `${htmlPath} has a dark theme section`);
  return css.slice(at);
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const channel = (i: number): number => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

test("dark theme is warm graphite in both apps, forced and auto", () => {
  for (const app of APPS) {
    const css = darkSection(app.css);
    for (const token of [BG, SURFACE, RAISED, TEXT, MUTED, ACCENT, "#ece7dc"]) {
      const uses = css.split(token).length - 1;
      assert.ok(uses >= 2, `${app.name}: ${token} appears in both the dark and auto-dark blocks (found ${uses})`);
    }
    const schemes = css.split("color-scheme:dark").length - 1;
    assert.ok(schemes >= 2, `${app.name}: native controls get color-scheme:dark for dark and auto`);
    // The old blue-navy dark theme must not survive a half-applied repaint.
    for (const navy of ["#0a1120", "#121a2e", "#1a2340", "#26314d", "#354163", "#9aa7c2"]) {
      assert.ok(!css.includes(navy), `${app.name}: old navy dark token ${navy} is gone`);
    }
  }
});

test("dark palette keeps AA text contrast", () => {
  const pairs: Array<[string, string, string]> = [
    ["body text on page", TEXT, BG],
    ["body text on card", TEXT, SURFACE],
    ["muted text on page", MUTED, BG],
    ["muted text on card", MUTED, SURFACE],
    ["accent on card", ACCENT, SURFACE],
    ["accent on raised", ACCENT, RAISED],
  ];
  for (const [name, fg, bg] of pairs) {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= 4.5, `${name}: ${ratio.toFixed(2)}:1 should be at least 4.5:1`);
  }
  // #fff labels on the dark-mode primary button.
  assert.ok(contrast("#ffffff", "#0f7a4c") >= 4.5, "primary button label passes AA");
});

test("browser chrome follows the chosen theme, not just the OS", () => {
  assert.equal(read("pwa/theme.js"), read("react/public/theme.js"), "theme.js stays one implementation");
  const js = read("pwa/theme.js");
  for (const part of ["meta[name=\"theme-color\"]", "(prefers-color-scheme: dark)", BG, "MutationObserver"]) {
    assert.ok(js.includes(part), `theme.js handles ${part}`);
  }
  for (const app of [APPS[0], APPS[1]]) {
    const html = read(app.html);
    assert.equal((html.match(/name="theme-color"/g) ?? []).length, 1, `${app.name}: one theme-color tag`);
    assert.ok(!/name="theme-color"[^>]*media=/.test(html), `${app.name}: theme-color is not pinned to the OS`);
    assert.ok(html.includes('<meta name="color-scheme" content="light dark" />'), `${app.name}: declares both color schemes`);
  }
});
