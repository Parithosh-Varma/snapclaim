import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

// Each app ships the same policy twice: once as markup (works on any static
// host) and once as a real header (the only form browsers honour for
// frame-ancestors). Both copies must stay identical apart from frame-ancestors.
const APPS = [
  { name: "pwa", html: "pwa/index.html", headers: "pwa/_headers" },
  { name: "react", html: "react/index.html", headers: "react/public/_headers" },
] as const;

function metaCsp(html: string): string {
  const m = html.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/);
  assert.ok(m, "CSP meta tag exists");
  return m[1]!;
}

function headerCsp(file: string): string {
  const m = read(file).match(/^\s*Content-Security-Policy:\s*(.+)$/im);
  assert.ok(m, `${file} sends a CSP response header`);
  return m[1]!.trim();
}

function directives(csp: string): Array<[string, string]> {
  return csp
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...sources] = part.split(/\s+/);
      return [name!.toLowerCase(), sources.join(" ")] as [string, string];
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

for (const app of APPS) {
  test(`${app.name}: frame-ancestors is a header, never a <meta> directive`, () => {
    assert.ok(
      !metaCsp(read(app.html)).includes("frame-ancestors"),
      "meta CSP omits frame-ancestors (browsers ignore it there and log a warning)",
    );
    const header = new Map(directives(headerCsp(app.headers)));
    assert.equal(header.get("frame-ancestors"), "'self'", "header CSP blocks cross-origin framing");
    assert.match(read(app.headers), /^\s*X-Frame-Options:\s*SAMEORIGIN\s*$/im, "legacy framing fallback");
  });

  test(`${app.name}: header and meta CSP stay in sync`, () => {
    const meta = directives(metaCsp(read(app.html)));
    const header = directives(headerCsp(app.headers)).filter(([name]) => name !== "frame-ancestors");
    assert.deepEqual(header, meta, "header CSP must mirror the meta CSP plus frame-ancestors");
  });
}
