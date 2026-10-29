import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleRequest } from "../backend/app.ts";
import { handleHolderRequest } from "../backend/r2-holder.ts";
import { encodeBytesToBase64, validateR2Key } from "../backend/r2-proxy.ts";

const IMG_B64 = Buffer.from("fake-jpeg-bytes").toString("base64");
const KEY_ENV: Record<string, string> = { R2_PROXY_KEY: "secret" };

function fakeBucket() {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    files,
    async put(key: string, data: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<void> {
      files.set(key, { bytes: Uint8Array.from(data), contentType: opts?.httpMetadata?.contentType ?? "application/octet-stream" });
    },
    async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string }; size: number } | null> {
      const hit = files.get(key);
      if (!hit) return null;
      const copy = Uint8Array.from(hit.bytes);
      return { httpMetadata: { contentType: hit.contentType }, size: copy.length, arrayBuffer: async () => copy.buffer as ArrayBuffer };
    },
  };
}

function stubFetch(handler: (url: string, init: { headers: Record<string, string>; body?: string }) => unknown): typeof fetch {
  return (async (url: unknown, init: unknown) => {
    const out = handler(String(url), (init ?? {}) as { headers: Record<string, string>; body?: string });
    return { ok: true, status: 200, json: async () => out } as unknown as Response;
  }) as typeof fetch;
}

test("r2 key validation fails closed on traversal and absolute paths", async () => {
  for (const bad of ["../evil", "/abs", "a/", "", "a".repeat(257), "has space"]) {
    assert.throws(() => validateR2Key(bad), /key must be/);
  }
  assert.equal(validateR2Key("donations/abc123.jpg"), "donations/abc123.jpg");
});

test("holder put/get round-trips bytes with the right key", async () => {
  const bucket = fakeBucket();
  const env = { R2_PROXY_KEY: "secret", snapclaim_images: bucket } as never;
  const put = await handleHolderRequest({
    method: "POST", path: "/put",
    body: { key: "donations/x.jpg", contentType: "image/jpeg", dataBase64: IMG_B64 },
    auth: "Bearer secret", env,
  });
  assert.equal(put.status, 200);
  const get = await handleHolderRequest({
    method: "GET", path: "/object", query: { key: "donations/x.jpg" },
    auth: "Bearer secret", env,
  });
  assert.equal(get.status, 200);
  assert.equal((get.body as { result: { dataBase64: string } }).result.dataBase64, IMG_B64);
});

test("holder fails closed: wrong key 403, missing key config 503, missing object 404", async () => {
  const bucket = fakeBucket();
  const denied = await handleHolderRequest({
    method: "POST", path: "/put",
    body: { key: "a/b.jpg", contentType: "image/jpeg", dataBase64: IMG_B64 },
    auth: "Bearer wrong", env: { R2_PROXY_KEY: "secret", snapclaim_images: bucket } as never,
  });
  assert.equal(denied.status, 403);
  const unconfigured = await handleHolderRequest({
    method: "POST", path: "/put",
    body: { key: "a/b.jpg", contentType: "image/jpeg", dataBase64: IMG_B64 },
    auth: "Bearer secret", env: { snapclaim_images: bucket } as never,
  });
  assert.equal(unconfigured.status, 503);
  const missing = await handleHolderRequest({
    method: "GET", path: "/object", query: { key: "nope.jpg" },
    auth: "Bearer secret", env: { R2_PROXY_KEY: "secret", snapclaim_images: bucket } as never,
  });
  assert.equal(missing.status, 404);
});

test("main /v1/r2/put|get work on the native bucket binding", async () => {
  const bucket = fakeBucket();
  const env = { ...KEY_ENV, snapclaim_images: bucket } as never;
  const put = await handleRequest({
    method: "POST", path: "/v1/r2/put",
    body: { auth: "secret", key: "donations/n1.jpg", contentType: "image/jpeg", dataBase64: IMG_B64 },
    env,
  });
  assert.equal(put.status, 200);
  const get = await handleRequest({ method: "POST", path: "/v1/r2/get", body: { auth: "secret", key: "donations/n1.jpg" }, env });
  assert.equal(get.status, 200);
  assert.equal((get.body as { result: { dataBase64: string } }).result.dataBase64, IMG_B64);
});

test("main /v1/r2 forwards to the holder in the other account", async () => {
  let sawUrl = "", sawAuth = "";
  const fetchFn = stubFetch((url, init) => {
    sawUrl = url;
    sawAuth = init.headers.authorization ?? "";
    if (url.endsWith("/put")) return { ok: true, result: { key: "donations/r1.jpg", size: 16 } };
    return { ok: true, result: { key: "donations/r1.jpg", contentType: "image/jpeg", dataBase64: IMG_B64, size: 16 } };
  });
  const env = { R2_PROXY_KEY: "secret", R2_PROXY_URL: "https://holder.example.workers.dev" } as never;
  const put = await handleRequest({
    method: "POST", path: "/v1/r2/put",
    body: { auth: "secret", key: "donations/r1.jpg", contentType: "image/jpeg", dataBase64: IMG_B64 },
    env, fetchFn,
  });
  assert.equal(put.status, 200);
  assert.ok(sawUrl.endsWith("/put"));
  assert.equal(sawAuth, "Bearer secret");
  const get = await handleRequest({
    method: "POST", path: "/v1/r2/get", body: { auth: "secret", key: "donations/r1.jpg" }, env, fetchFn,
  });
  assert.equal(get.status, 200);
  assert.ok(sawUrl.includes("/object?key="));
});

test("main /v1/r2 fails closed without configuration and on a bad operator key", async () => {
  const unconfigured = await handleRequest({
    method: "POST", path: "/v1/r2/put",
    body: { auth: "x", key: "a.jpg", contentType: "image/jpeg", dataBase64: IMG_B64 }, env: {},
  });
  assert.equal(unconfigured.status, 503);
  const bucket = fakeBucket();
  const wrongKey = await handleRequest({
    method: "POST", path: "/v1/r2/get", body: { auth: "wrong", key: "a.jpg" },
    env: { R2_PROXY_KEY: "secret", snapclaim_images: bucket } as never,
  });
  assert.equal(wrongKey.status, 403);
  const missing = await handleRequest({
    method: "POST", path: "/v1/r2/get", body: { auth: "secret", key: "ghost.jpg" },
    env: { R2_PROXY_KEY: "secret", snapclaim_images: bucket } as never,
  });
  assert.equal(missing.status, 404);
});

test("collect spills image bytes to the bound bucket and stores an r2: pointer", async () => {
  const bucket = fakeBucket();
  const rows: Record<string, unknown>[] = [];
  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run(): Promise<unknown> {
              if (/INSERT INTO donations/i.test(query)) {
                const image = values[2];
                rows.push({ id: values[0], created_at: values[1], image });
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  const IMG = `data:image/jpeg;base64,${IMG_B64}`;
  const res = await handleRequest({
    method: "POST", path: "/v1/collect",
    body: { consent: true, image: IMG, label: "crack" },
    env: { snapclaim_data: db, R2_PROXY_KEY: "secret", snapclaim_images: bucket } as never,
  });
  assert.equal(res.status, 200);
  assert.equal(rows.length, 1);
  const stored = rows[0]?.["image"] as string;
  assert.match(stored, /^r2:donations\/.+\.jpg$/);
  const r2Key = stored.slice("r2:".length);
  assert.ok(bucket.files.has(r2Key));
  assert.equal(encodeBytesToBase64(bucket.files.get(r2Key)!.bytes), IMG_B64);
});
