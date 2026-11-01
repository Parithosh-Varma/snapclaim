import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeBody, handleRequest } from "../backend/app.ts";

function stubFetch(reply: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => reply,
  })) as unknown as typeof fetch;
}

const tinyJpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

test("mock describe needs a fixture and invents nothing", async () => {
  const missing = await handleRequest({ method: "POST", path: "/v1/describe", body: {}, env: {} });
  assert.equal(missing.status, 400);
  const ok = await handleRequest({
    method: "POST",
    path: "/v1/describe",
    body: { fixtureDescription: "cracked plaster, coin for scale" },
    env: {},
  });
  assert.equal(ok.status, 200);
  assert.equal((ok.body as { result: { description: string } }).result.description, "cracked plaster, coin for scale");
});

test("live describe sends the photo to Meta chat and returns one sentence", async () => {
  const out = await describeBody(
    { imageUrl: tinyJpeg },
    { MOCK_MODE: "0", META_API_KEY: "test-key" },
    "test-request",
    stubFetch({
      choices: [{ message: { content: "  A diagonal crack runs across the wall, with a coin taped beside it.  " } }],
      usage: { prompt_tokens: 1200, completion_tokens: 24 },
    }),
  );
  assert.equal(
    (out.result as { description: string }).description,
    "A diagonal crack runs across the wall, with a coin taped beside it.",
  );
});

test("live describe extends a reporter note instead of describing cold", async () => {
  const out = await describeBody(
    { imageUrl: tinyJpeg, note: "crack by the window" },
    { MOCK_MODE: "0", META_API_KEY: "test-key" },
    "test-request",
    stubFetch({
      choices: [{ message: { content: "A crack runs by the window, spreading across the plaster." } }],
      usage: { prompt_tokens: 1300, completion_tokens: 40 },
    }),
  );
  assert.equal(
    (out.result as { description: string }).description,
    "A crack runs by the window, spreading across the plaster.",
  );
});

test("live describe fails closed on HTTP errors, empty content or bad images", async () => {
  const env = { MOCK_MODE: "0", META_API_KEY: "k" };
  await assert.rejects(() => describeBody({ imageUrl: tinyJpeg }, env, "r", stubFetch({}, 403)));
  await assert.rejects(() =>
    describeBody({ imageUrl: tinyJpeg }, env, "r", stubFetch({ choices: [] })),
  );
  await assert.rejects(() => describeBody({ imageUrl: "https://evil.example/x.jpg'); DROP" }, env, "r"));
  await assert.rejects(() => describeBody({ imageUrl: "not-a-url" }, env, "r"));
});
