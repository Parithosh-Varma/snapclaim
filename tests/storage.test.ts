import { strict as assert } from "node:assert";
import { test } from "node:test";
import { archiveSegmentImage, storageConfigured } from "../backend/storage.ts";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://xyzcompany.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

test("storage is unconfigured without the Supabase vars", () => {
  assert.equal(storageConfigured({}), false);
  assert.equal(storageConfigured({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" }), false);
  assert.equal(storageConfigured(ENV), true);
});

test("archival is a no-op without config and never throws", async () => {
  let called = false;
  const fetchFn = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  assert.equal(await archiveSegmentImage({}, TINY_PNG, "req-1", fetchFn), null);
  assert.equal(called, false);
});

test("archival skips non-inline URLs", async () => {
  let called = false;
  const fetchFn = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  assert.equal(await archiveSegmentImage(ENV, "https://example.com/a.jpg", "req-1", fetchFn), null);
  assert.equal(called, false);
});

test("archival uploads bytes and returns the public URL", async () => {
  let seen: { url: string; headers: Record<string, string>; bytes: number } | null = null;
  const fetchFn = (async (url: string, init: { headers: Record<string, string>; body: Uint8Array }) => {
    seen = { url, headers: init.headers, bytes: init.body.length };
    return new Response(JSON.stringify({ Id: "x", Key: "y" }), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await archiveSegmentImage(ENV, TINY_PNG, "req-abc-123", fetchFn);
  assert.ok(out?.startsWith("https://xyzcompany.supabase.co/storage/v1/object/public/images/segments/"));
  assert.ok(out?.endsWith("/req-abc-123.png"));
  assert.equal(seen!.headers.apikey, "sb_publishable_test");
  assert.equal(seen!.headers.Authorization, "Bearer sb_publishable_test");
  assert.equal(seen!.headers["content-type"], "image/png");
  assert.ok(seen!.bytes > 0);
});

test("archival failure returns null instead of throwing", async () => {
  const denied = (async () => new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
  assert.equal(await archiveSegmentImage(ENV, TINY_PNG, "req-1", denied), null);
  const down = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
  assert.equal(await archiveSegmentImage(ENV, TINY_PNG, "req-1", down), null);
  assert.equal(await archiveSegmentImage(ENV, "data:image/png;base64", "req-1", denied), null);
});
