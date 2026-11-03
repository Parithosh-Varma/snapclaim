import { strict as assert } from "node:assert";
import { test } from "node:test";
import { META_API_BASE, META_MODELS, metaApiKey, metaChatCompletions, verifyMetaConnectivity } from "../backend/metaApi.ts";
import { HttpError } from "../backend/providers.ts";

test("meta endpoint + model ids are the official Meta surface", () => {
  assert.equal(META_API_BASE, "https://api.meta.ai/v1");
  assert.equal(META_MODELS.spark, "muse-spark-1.3");
  assert.equal(META_MODELS.sam, "sam-3.1");
  assert.equal(META_MODELS.voice, "muse-voice-transcribe-1.0");
  assert.ok(typeof META_MODELS.glimmer === "string" && META_MODELS.glimmer.length > 0);
  assert.ok(typeof META_MODELS.sparkOpen === "string" && META_MODELS.sparkOpen.length > 0);
});

test("metaApiKey reads META_API_KEY and fails closed without it", () => {
  assert.equal(metaApiKey({ META_API_KEY: "k" }), "k");
  assert.throws(() => metaApiKey({}), (e) => e instanceof HttpError && e.status === 503);
});

const okFetch = (body: unknown, status = 200) =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response) as typeof fetch;

test("metaChatCompletions sends endpoint, Bearer auth, model and caps", async () => {
  let seen: { url: unknown; init: { headers?: Record<string, string>; body?: string } } | null = null;
  const fetchFn = (async (url: unknown, init: { headers?: Record<string, string>; body?: string }) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) } as unknown as Response;
  }) as typeof fetch;
  const out = await metaChatCompletions({ apiKey: "k", model: "muse-spark-1.3", messages: [{ role: "user", content: "x" }], maxTokens: 100, fetchFn });
  assert.equal(seen!.url, "https://api.meta.ai/v1/chat/completions");
  assert.equal(seen!.init.headers!["authorization"], "Bearer k");
  const body = JSON.parse(seen!.init.body!);
  assert.equal(body.model, "muse-spark-1.3");
  assert.equal(body.max_tokens, 100);
  assert.equal(out.ok, true);
  assert.equal(out.status, 200);
  assert.equal(out.data.choices?.[0]?.message?.content, "hi");
  assert.deepEqual(out.data.usage, { prompt_tokens: 10, completion_tokens: 5 });
});

test("metaChatCompletions returns raw wire data for callers to map", async () => {
  const out = await metaChatCompletions({
    apiKey: "k",
    model: "m",
    messages: [],
    fetchFn: okFetch({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }], usage: {} }),
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.data.choices?.[0]?.message?.content, [{ type: "text", text: "a" }, { type: "text", text: "b" }]);
});

test("metaChatCompletions surfaces HTTP statuses for caller mapping", async () => {
  const out = await metaChatCompletions({
    apiKey: "k",
    model: "m",
    messages: [],
    fetchFn: okFetch({ error: { message: "bad key" } }, 401),
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
  assert.equal(out.data.error?.message, "bad key");
});

test("metaChatCompletions propagates transport errors raw for timeout mapping", async () => {
  const boom = Object.assign(new Error("aborted due to timeout"), { name: "TimeoutError" });
  await assert.rejects(
    () => metaChatCompletions({ apiKey: "k", model: "m", messages: [], fetchFn: (async () => { throw boom; }) as typeof fetch }),
    (e) => e === boom,
  );
});

test("metaChatCompletions requires a key", async () => {
  await assert.rejects(() => metaChatCompletions({ apiKey: "  ", model: "m", messages: [] }), (e) => e instanceof HttpError && e.status === 503);
});

test("verifyMetaConnectivity lists models without spending", async () => {
  let seenUrl = "";
  const out = await verifyMetaConnectivity({
    apiKey: "k",
    fetchFn: (async (url: unknown) => {
      seenUrl = String(url);
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "muse-spark-1.3" }, { id: "x" }] }) } as unknown as Response;
    }) as typeof fetch,
  });
  assert.ok(seenUrl.endsWith("/models"), seenUrl);
  assert.equal(seenUrl, "https://api.meta.ai/v1/models");
  assert.deepEqual(out.models, ["muse-spark-1.3", "x"]);
  assert.equal(out.ok, true);
});

test("verifyMetaConnectivity fails closed on 401", async () => {
  await assert.rejects(() => verifyMetaConnectivity({ apiKey: "bad", fetchFn: okFetch({}, 401) }), (e) => e instanceof HttpError && e.status === 401);
});
