import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_BACKEND_HOST, isAllowedBackendUrl } from "../react/src/lib/api.ts";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

function connectSrc(html: string): string {
  const m = html.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/);
  assert.ok(m, "CSP meta tag exists");
  const csp = m[1]!;
  const dir = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("connect-src"));
  assert.ok(dir, "connect-src directive exists");
  return dir;
}

for (const htmlPath of ["pwa/index.html", "react/index.html"]) {
  test(`${htmlPath}: CSP connect-src covers the allowlisted backend, nothing more`, () => {
    const html = read(htmlPath);
    const dir = connectSrc(html);
    // The default backend host must be an explicit https: source.
    assert.ok(dir.includes(`https://${DEFAULT_BACKEND_HOST}`), `CSP allows https://${DEFAULT_BACKEND_HOST}`);
    // Local dev backends stay reachable.
    assert.ok(dir.includes("http://localhost:8787"), "CSP allows http://localhost:8787");
    assert.ok(dir.includes("http://127.0.0.1:8787"), "CSP allows http://127.0.0.1:8787");
    // No wildcard https: that would let validation pass what the CSP blocks (or vice versa).
    const sources = dir.replace(/^connect-src\s+/, "").split(/\s+/);
    assert.ok(!sources.includes("https:"), "no bare https: wildcard in connect-src");
    assert.ok(!sources.some((s) => s.includes("*") && s.startsWith("https://") && !s.includes("huggingface")), "no https://* wildcard in connect-src");
  });
}

for (const srcPath of ["pwa/app.js", "react/src/lib/api.ts"]) {
  test(`${srcPath}: backend allowlist is strict and names the default host`, () => {
    const src = read(srcPath);
    assert.ok(src.includes("DEFAULT_BACKEND_HOST"), "names DEFAULT_BACKEND_HOST");
    assert.ok(src.includes(DEFAULT_BACKEND_HOST), "pins the default Worker host");
    assert.ok(
      src.includes("=== DEFAULT_BACKEND_HOST") || src.includes("===  DEFAULT_BACKEND_HOST"),
      "https: is gated on the default host, not open",
    );
    assert.ok(
      !src.includes('if (url.protocol === "https:") return true;'),
      "no blanket https: acceptance (would pass URLs the CSP blocks)",
    );
    assert.ok(
      src.includes("This backend isn't allowed by the app's security policy"),
      "rejection message names the security policy",
    );
  });
}

test("allowlist and CSP connect-src never diverge", () => {
  for (const htmlPath of ["pwa/index.html", "react/index.html"]) {
    const dir = connectSrc(read(htmlPath));
    // Every https backend host the allowlist accepts must appear in the CSP.
    assert.ok(
      dir.includes(`https://${DEFAULT_BACKEND_HOST}`),
      `${htmlPath} connect-src must list the allowlisted backend host (edit both together; see README "Self-hosted backend")`,
    );
  }
  // Functional contract of the shared allowlist (imported from the React copy;
  // pwa/app.js carries the identical logic but cannot be imported in Node — it
  // touches the DOM at module top level — so the source-text checks above pin it).
  assert.equal(isAllowedBackendUrl(`https://${DEFAULT_BACKEND_HOST}/v1/health`), true);
  assert.equal(isAllowedBackendUrl("https://evil.example.com/v1/health"), false);
  assert.equal(isAllowedBackendUrl("https://snapclaim-backend.parithosh.workers.dev.evil.com/"), false);
  assert.equal(isAllowedBackendUrl("http://localhost:8787/v1/health"), true);
  assert.equal(isAllowedBackendUrl("http://127.0.0.1:8787/v1/health"), true);
  assert.equal(isAllowedBackendUrl("http://192.168.1.5:8787/v1/health"), false);
  assert.equal(isAllowedBackendUrl("https://user:pass@snapclaim-backend.parithosh.workers.dev/"), false);
  assert.equal(isAllowedBackendUrl("data:text/plain,hi"), false);
});
