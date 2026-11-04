import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MetaFindingsProvider } from "../backend/providers.ts";
import { handleRequest } from "../backend/app.ts";
import { citingDrafts, LIVE_ENV, wallSession } from "./helpers.ts";

/** Captures the chat-completions request body the provider sends. */
function captureFetch(drafts: unknown) {
  let seen: { body?: string } | null = null;
  const fetchFn = (async (_url: unknown, init: { body?: string }) => {
    seen = { body: init.body };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(drafts) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as unknown as Response;
  }) as typeof fetch;
  return { fetchFn, seen: () => seen };
}

test("multimodal findings send the photo to Muse Spark with structured output", async () => {
  const session = wallSession();
  const { fetchFn, seen } = captureFetch(citingDrafts(session.findings));
  const provider = new MetaFindingsProvider({
    apiKey: "k",
    base: "https://api.meta.ai/v1",
    model: "muse-spark-1.3",
    fetchFn,
  });
  await provider.draftFindings({
    transcript: "crack",
    findings: session.findings,
    receipts: session.receipts,
    imageUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
  });
  const body = JSON.parse(seen()!.body!);
  assert.equal(body.model, "muse-spark-1.3");
  assert.deepEqual(body.response_format, { type: "json_object" });
  const user = body.messages.find((m: { role: string }) => m.role === "user");
  assert.ok(Array.isArray(user.content), "multimodal user content is an array");
  assert.ok(user.content.some((p: { type: string }) => p.type === "image_url"), "photo travels as image_url");
});

test("text-only findings stay text-only when no photo is given", async () => {
  const session = wallSession();
  const { fetchFn, seen } = captureFetch(citingDrafts(session.findings));
  const provider = new MetaFindingsProvider({
    apiKey: "k",
    base: "https://api.meta.ai/v1",
    model: "muse-spark-1.3",
    fetchFn,
  });
  await provider.draftFindings({ transcript: "crack", findings: session.findings, receipts: session.receipts });
  const body = JSON.parse(seen()!.body!);
  assert.equal(body.model, "muse-spark-1.3");
  assert.deepEqual(body.response_format, { type: "json_object" });
  const user = body.messages.find((m: { role: string }) => m.role === "user");
  assert.equal(typeof user.content, "string", "no photo means plain text content");
});

test("report accepts an optional photo and grounds Spark multimodally", async () => {
  const { loadWallFixture } = await import("./helpers.ts");
  const f = loadWallFixture();
  const session = wallSession();
  const { fetchFn, seen } = captureFetch(citingDrafts(session.findings));
  const res = await handleRequest({
    method: "POST",
    path: "/v1/report",
    body: {
      component: f.component,
      masks: f.masks,
      scaleReference: f.scaleReference,
      transcript: "crack",
      imageUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    },
    env: LIVE_ENV,
    fetchFn,
  });
  assert.equal(res.status, 200);
  const body = JSON.parse(seen()!.body!);
  const user = body.messages.find((m: { role: string }) => m.role === "user");
  assert.ok(Array.isArray(user.content), "report photo reaches Spark as vision input");
});

test("react Say screen sends the photo with /v1/report for multimodal findings", async () => {
  const { readFileSync } = await import("node:fs");
  const say = readFileSync(new URL("../react/src/screens/Say.tsx", import.meta.url), "utf8");
  assert.ok(say.includes("body.imageUrl = photoDataUrl"), "report body carries the photo for vision-grounded findings");
  assert.ok(say.includes("/v1/report"), "report route still used");
});

test("segment accepts negative points and multi-object prompts in one image", async () => {
  // Negative-label points must pass validation (fail later at fetch, not 400).
  const neg = await handleRequest({
    method: "POST",
    path: "/v1/segment",
    body: { imageUrl: "data:image/jpeg;base64,AAA", width: 100, height: 100, points: [{ x: 10, y: 10 }, { x: 90, y: 90, label: "negative" }] },
    env: LIVE_ENV,
    fetchFn: (async () => { throw new Error("stop here - validation passed"); }) as typeof fetch,
  });
  assert.equal((neg.body as { error: string }).error, "stop here - validation passed");

  // Multi-object (damage + coin) validates and reaches SAM as one prompt.
  let prompt = "";
  const multi = await handleRequest({
    method: "POST",
    path: "/v1/segment",
    body: {
      imageUrl: "data:image/jpeg;base64,AAA",
      width: 100,
      height: 100,
      objects: [
        { id: 1, points: [{ x: 10, y: 10 }] },
        { id: 2, points: [{ x: 80, y: 80 }] },
      ],
    },
    env: LIVE_ENV,
    fetchFn: (async (_url: unknown, init: { body?: string }) => {
      prompt = String(JSON.parse(String(init.body)).input[0].content[0].text);
      throw new Error("stop here - validation passed");
    }) as typeof fetch,
  });
  assert.equal((multi.body as { error: string }).error, "stop here - validation passed");
  assert.ok(prompt.includes("<0f>"), "SAM prompt built");
  assert.ok(prompt.includes("1<|point") && prompt.includes("2<|point"), "both objects in one prompt");
});
