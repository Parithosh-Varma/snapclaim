import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleRequest } from "../backend/app.ts";
import { estimateAudioUsd, transcribeWithMuse } from "../backend/transcribe.ts";
import { LIVE_ENV } from "./helpers.ts";

function wavBytes(seconds = 1): Uint8Array {
  // 16 kHz mono 16-bit PCM: 32000 bytes per second.
  return new Uint8Array(seconds * 32000);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function stubFetch(reply: unknown): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => reply,
  })) as unknown as typeof fetch;
}

test("transcribe parses the Muse response and charges audio time", async () => {
  const charges: Array<{ label: string; usd: number }> = [];
  const result = await transcribeWithMuse({
    fetchFn: stubFetch({ transcript: "wall crack near the window", audioDurationMs: 8000, turns: [] }),
    base: "https://api.meta.ai/v1",
    apiKey: "test",
    audio: { audio: wavBytes(8) },
    charge: (label, usd) => charges.push({ label, usd }),
  });
  assert.equal(result.transcript, "wall crack near the window");
  assert.equal(result.audioDurationMs, 8000);
  assert.equal(charges.length, 1);
  assert.ok(Math.abs((charges[0]?.usd ?? 0) - estimateAudioUsd(8000)) < 1e-12);
});

test("transcribe fails closed on HTTP errors or missing transcripts", async () => {
  const bad = (async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;
  await assert.rejects(() => transcribeWithMuse({ fetchFn: bad, base: "https://x", apiKey: "k", audio: { audio: wavBytes() } }));
  await assert.rejects(() =>
    transcribeWithMuse({ fetchFn: stubFetch({}), base: "https://x", apiKey: "k", audio: { audio: wavBytes() } }),
  );
});

test("audio pricing is $0.18/hour", () => {
  assert.equal(estimateAudioUsd(3_600_000), 0.18);
  assert.equal(estimateAudioUsd(10_000), 0.0005);
  assert.equal(estimateAudioUsd(-5), 0);
});

test("mock transcribe needs a fixture and invents nothing", async () => {
  const missing = await handleRequest({ method: "POST", path: "/v1/transcribe", body: {}, env: {} });
  assert.equal(missing.status, 400);
  const ok = await handleRequest({
    method: "POST",
    path: "/v1/transcribe",
    body: { fixtureTranscript: "paani ka daag, coin for scale" },
    env: {},
  });
  assert.equal(ok.status, 200);
  assert.equal((ok.body as { result: { transcript: string } }).result.transcript, "paani ka daag, coin for scale");
});

test("live transcribe without a key fails closed with 503", async () => {
  const res = await handleRequest({
    method: "POST",
    path: "/v1/transcribe",
    body: { audioBase64: toBase64(wavBytes()) },
    env: { MOCK_MODE: "0" },
  });
  assert.equal(res.status, 503);
});

test("live transcribe proxies multipart and returns the transcript", async () => {
  const seen: { url?: string; headers?: unknown } = {};
  const fetchFn = (async (url: unknown, init: unknown) => {
    seen.url = String(url);
    seen.headers = (init as { headers?: unknown }).headers;
    return { ok: true, status: 200, json: async () => ({ transcript: "seepage on the ceiling", audioDurationMs: 4000, turns: [] }) };
  }) as unknown as typeof fetch;
  const res = await handleRequest(
    { method: "POST", path: "/v1/transcribe", body: { audioBase64: toBase64(wavBytes(4)) }, env: LIVE_ENV, fetchFn },
  );
  assert.equal(res.status, 200);
  assert.equal(seen.url, "https://api.meta.ai/v1/asr/transcribe");
  assert.equal((res.body as { result: { transcript: string } }).result.transcript, "seepage on the ceiling");
});

test("live segment without points or image fails fast, never fakes a mask", async () => {
  const noImage = await handleRequest({ method: "POST", path: "/v1/segment", body: { points: [{ x: 1, y: 1 }] }, env: LIVE_ENV });
  assert.equal(noImage.status, 400);
  const noPoints = await handleRequest({
    method: "POST",
    path: "/v1/segment",
    body: { imageUrl: "https://example.com/p.jpg", width: 100, height: 100, points: [] },
    env: LIVE_ENV,
  });
  assert.equal(noPoints.status, 400);
});

test("live segment at $0 remaining refuses before any fetch", async () => {
  let called = false;
  const fetchFn = (async () => {
    called = true;
    return { ok: true, status: 200, text: async () => "" };
  }) as unknown as typeof fetch;
  const res = await handleRequest(
    {
      method: "POST",
      path: "/v1/segment",
      body: { imageUrl: "data:image/jpeg;base64,AAA", width: 100, height: 100, points: [{ x: 12, y: 21 }] },
      env: { ...LIVE_ENV, SPEND_GUARD_USD: "0" },
      fetchFn,
    },
  );
  assert.equal(res.status, 429);
  assert.equal(called, false);
});

test("live segment decodes a streamed SAM response to frame RLE", async () => {
  const line = `<0f>1<|box;x1=10;y1=20;x2=15;y2=23;w=100;h=100;c=0.9|><|mask;x=0;y=0;c=0.9;data=4,6,!!!!!!'O3NZWV4|>`;
  const sse = [
    `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":${JSON.stringify(line)}}`,
    `event: response.completed\ndata: {"type":"response.completed"}`,
  ].join("\n\n");
  const fetchFn = (async () => ({ ok: true, status: 200, text: async () => sse })) as unknown as typeof fetch;
  const res = await handleRequest(
    {
      method: "POST",
      path: "/v1/segment",
      body: { imageUrl: "data:image/jpeg;base64,AAA", width: 100, height: 100, points: [{ x: 12, y: 21 }] },
      env: LIVE_ENV,
      fetchFn,
    },
  );
  assert.equal(res.status, 200);
  const records = (res.body as { result: { records: Array<{ objectId: number; confidence: number; rle: { size: [number, number] } }> } }).result.records;
  assert.equal(records.length, 1);
  assert.equal(records[0]?.objectId, 1);
  assert.equal(records[0]?.confidence, 0.9);
  assert.deepEqual(records[0]?.rle.size, [100, 100]);
});
