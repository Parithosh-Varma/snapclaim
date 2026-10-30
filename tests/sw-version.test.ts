import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { encoding: "utf8" }).trim();
  } catch {
    return null; // no git (tarball checkout): fall back to on-disk checks below
  }
}

function headBytes(path: string): Buffer | null {
  try {
    return execSync(`git show HEAD:${path}`, { maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return null;
  }
}

const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

function parseSw(src: string): { cache: string; shell: string[] } {
  const cache = src.match(/const CACHE = "([^"]+)"/)?.[1];
  assert.ok(cache, "service worker names a CACHE version");
  const body = src.match(/const SHELL = \[([\s\S]*?)\];/)?.[1];
  assert.ok(body, "service worker lists a SHELL");
  const shell = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(shell.length > 0, "SHELL is not empty");
  return { cache, shell };
}

/** SHELL entry ("./x") -> repo-relative file backing it. Null = unresolvable. */
function resolveShell(swPath: string, entry: string): string | null {
  if (swPath === "pwa/sw.js") {
    return entry === "./" ? "pwa/index.html" : `pwa/${entry.slice(2)}`;
  }
  // react/public/sw.js: built index.html is a Vite artifact, so the source
  // react/index.html is the honest proxy for both "./" and "./index.html".
  if (swPath === "react/public/sw.js") {
    if (entry === "./" || entry === "./index.html") return "react/index.html";
    return `react/public/${entry.slice(2)}`;
  }
  return null;
}

for (const swPath of ["pwa/sw.js", "react/public/sw.js"]) {
  test(`${swPath}: shell edits ship with a cache bump`, () => {
    const src = read(swPath);
    const { cache, shell } = parseSw(src);
    assert.match(cache, /^snapclaim-(shell|react)-v\d+$/, "CACHE stays versioned");

    // Every precached file must exist on disk (a typo here ships an offline hole).
    for (const entry of shell) {
      const file = resolveShell(swPath, entry);
      assert.ok(file && existsSync(new URL(file, root)), `${swPath} SHELL entry ${entry} exists (${file})`);
    }

    const headSrc = headBytes(swPath);
    if (headSrc === null) return; // no git history: on-disk checks above are the best we can do
    const headCache = headSrc.toString("utf8").match(/const CACHE = "([^"]+)"/)?.[1];
    if (headCache !== cache) return; // CACHE was bumped: this delivery's shell changes are covered

    // CACHE untouched since HEAD, so every SHELL file must be byte-identical
    // to HEAD. A mismatch means the shell changed but phones would keep the
    // old cached copy — bump CACHE (pwa: snapclaim-shell-vN+1).
    const changed: string[] = [];
    for (const entry of shell) {
      const file = resolveShell(swPath, entry)!;
      const oldB = headBytes(file);
      if (oldB === null) {
        changed.push(`${entry} (new file, not in HEAD)`);
        continue;
      }
      const cur = readFileSync(new URL(file, root));
      if (sha(Buffer.from(cur)) !== sha(oldB)) changed.push(entry);
    }
    assert.deepEqual(
      changed,
      [],
      `${swPath}: ${changed.join(", ")} changed but CACHE is still "${cache}". ` +
        `Bump CACHE so phones fetch the new shell (and update this test's expectation).`,
    );
  });
}

test("pwa shell coverage: every runtime script is precached, no dead weight", () => {
  const sw = read("pwa/sw.js");
  const { shell } = parseSw(sw);
  const html = read("pwa/index.html");
  const app = read("pwa/app.js");

  // ESM imports in app.js must be precached or the offline shell breaks.
  for (const m of app.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const dep = m[1]!;
    assert.ok(shell.includes(dep), `app.js import ${dep} is in the SW SHELL`);
  }
  // Classic scripts + workers + manifest are runtime too.
  for (const dep of ["./coin-model.js", "./theme.js", "./sam-worker.js", "./voice-worker.js"]) {
    assert.ok(shell.includes(dep), `${dep} is in the SW SHELL`);
  }
  assert.ok(html.includes('rel="manifest"'), "manifest is linked");
  assert.ok(shell.includes("./manifest.webmanifest"), "manifest is precached");

  // coin-detect.js was pure test-only code sitting in the shipped folder: it
  // is not imported by app.js, not loaded by index.html, and not in SHELL.
  // It now lives at src/vision/coin-detect.js (algorithm harness, no DOM) so
  // pwa/ ships only runtime. This pins that decision: do not re-add it.
  assert.ok(!existsSync(new URL("pwa/coin-detect.js", root)), "pwa/coin-detect.js stays out of the shipped folder");
  assert.ok(existsSync(new URL("src/vision/coin-detect.js", root)), "detector harness lives at src/vision/coin-detect.js");
  assert.ok(!shell.some((s) => s.includes("coin-detect")), "no dead detector in the precache");
});
