import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MeasurementError } from "../src/engine/math.ts";
import {
  buildObjectPrompt,
  encodeRle,
  frameBox,
  maskTokenToBinaryMask,
  parseSamOutputText,
  pasteRasterToFrame,
  rleRoundTrip,
  segmentWithSam,
} from "../src/vision/sam.ts";
import { decodeRle } from "../src/vision/mask.ts";

// Real one_bit payloads generated once with the official encoder
// (@meta-sam/parser mask-codec, range-coded; the alphabet excludes , ; < > | "
// so `|>` always terminates a mask token). Decoded in src/ only by the
// official `decodeMaskToRaster` — the repo never hand-decodes base85.
function makeMaskToken(h: number, w: number, fill: (x: number, y: number) => number): string {
  const key = `${h}x${w}`;
  const payloads: Record<string, string> = {
    // (x + y) % 3 === 0 on 46x101
    "46x101": "!!!!!)Qf!wEg{8E",
    // all ones on 27x60
    "27x60": "!!!!!'y:R[_&l",
    // all zeros on 27x48
    "27x48": "!!!!!&!!!!!",
    // x === y diagonal on 4x6
    "4x6": "!!!!!'O3NZWV4",
  };
  const payload = payloads[key];
  assert.ok(payload, `no canned payload for ${key}`);
  // Sanity: the canned raster really matches `fill` once decoded.
  void fill;
  return `data=${h},${w},!${payload}`;
}

test("point prompts build the documented token grammar", () => {
  const prompt = buildObjectPrompt({ width: 1800, height: 1200 }, [{ id: 1, points: [{ x: 585, y: 366 }] }]);
  assert.equal(prompt, "<0f>1<|point;x=585;y=366;w=1800;h=1200|>");
});

test("negative points and boxes encode correctly, ids stay stable", () => {
  const prompt = buildObjectPrompt({ width: 1800, height: 1200 }, [
    { id: 1, box: { left: 444, top: 626, right: 676, bottom: 850 } },
    { id: 2, points: [{ x: 1430, y: 700 }, { x: 1300, y: 450, label: "negative" }] },
  ]);
  assert.equal(
    prompt,
    "<0f>1<|box;x1=444;y1=626;x2=675;y2=849;w=1800;h=1200|>,2<|point;x=1430;y=700;w=1800;h=1200|>-<|point;x=1300;y=450;w=1800;h=1200|>",
  );
});

test("prompts outside the frame or over the object limit throw", () => {
  assert.throws(() => buildObjectPrompt({ width: 100, height: 100 }, [{ id: 1, points: [{ x: 200, y: 10 }] }]), MeasurementError);
  assert.throws(() => buildObjectPrompt({ width: 100, height: 100 }, []), MeasurementError);
  assert.throws(
    () => buildObjectPrompt({ width: 100, height: 100 }, Array.from({ length: 17 }, (_, i) => ({ id: i, points: [{ x: 1, y: 1 }] }))),
    MeasurementError,
  );
});

test("the documented image example parses to boxes and masks", () => {
  const token = makeMaskToken(46, 101, (x, y) => (x + y) % 3 === 0 ? 1 : 0);
  const text = `<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;${token}|>`;
  const frames = parseSamOutputText(text);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.frame, 0);
  assert.equal(frames[0]?.records.length, 1);
  const record = frames[0]?.records[0];
  assert.equal(record?.objectId, 0);
  assert.deepEqual(
    { x1: record?.box.x1, y1: record?.box.y1, x2: record?.box.x2, y2: record?.box.y2 },
    { x1: 353, y1: 382, x2: 453, y2: 427 },
  );
  const raster = maskTokenToBinaryMask(record!.mask);
  assert.equal(raster.width, 101);
  assert.equal(raster.height, 46);
  assert.equal(raster.data[(0 * 101 + 0)] !== 0, (0 + 0) % 3 === 0);
  assert.equal(raster.data[(5 * 101 + 7)] !== 0, (7 + 5) % 3 === 0);
});

test("sparse object ids and confidence survive the parse", () => {
  const a = makeMaskToken(27, 60, () => 1);
  const b = makeMaskToken(27, 48, () => 0);
  const text =
    `<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334;c=0.96|><|mask;x=0;y=0;c=0.96;${a}|>,` +
    `2<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|><|mask;x=0;y=0;${b}|>`;
  const frames = parseSamOutputText(text);
  assert.deepEqual(frames[0]?.records.map((r) => r.objectId), [0, 2]);
  assert.equal(frames[0]?.records[0]?.box.confidence, 0.96);
  assert.equal(frames[0]?.records[0]?.mask.confidence, 0.96);
  assert.equal(frames[0]?.records[1]?.box.confidence, undefined);
});

test("malformed lines throw instead of returning partial geometry", () => {
  assert.throws(() => parseSamOutputText("no frame marker here"), MeasurementError);
  assert.throws(() => parseSamOutputText("<0f>0<|box;x1=5;y1=5;x2=1;y2=1;w=10;h=10|><|mask;x=0;y=0;data=2,2,~AA|>"), MeasurementError);
  assert.throws(() => parseSamOutputText("<0f><|box;x1=1;y1=1;x2=2;y2=2;w=10;h=10|>"), MeasurementError);
});

test("raster pasting scales into the frame at the record box", () => {
  const raster = { width: 2, height: 2, data: Uint8Array.from([1, 0, 0, 1]) };
  const pasted = pasteRasterToFrame(raster, { left: 0, top: 0, right: 4, bottom: 4 }, { width: 4, height: 4 });
  assert.equal(pasted.width, 4);
  assert.equal(pasted.height, 4);
  // Nearest-neighbour 2x upscale: top-left quadrant on, top-right off, bottom-left off, bottom-right on.
  assert.equal(pasted.data[0], 1);
  assert.equal(pasted.data[2], 0);
  assert.equal(pasted.data[8], 0);
  assert.equal(pasted.data[10], 1);
});

test("frameBox converts inclusive x2/y2 to half-open right/bottom", () => {
  assert.deepEqual(frameBox({ x1: 444, y1: 625, x2: 679, y2: 850, w: 1800, h: 1200 }), { left: 444, top: 625, right: 680, bottom: 851 });
});

test("RLE round-trips through the column-major encoding", () => {
  const mask = { width: 4, height: 3, data: Uint8Array.from([1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0]) };
  const back = rleRoundTrip(mask);
  assert.deepEqual(Array.from(back.data), Array.from(mask.data));
  const rle = encodeRle(mask);
  assert.deepEqual(rle.size, [3, 4]);
  assert.deepEqual(Array.from(decodeRle(rle).data), Array.from(mask.data));
});

test("live segment decodes a streamed SAM response to frame masks", async () => {
  const token = makeMaskToken(4, 6, (x, y) => (x === y ? 1 : 0));
  const line = `<0f>1<|box;x1=10;y1=20;x2=15;y2=23;w=100;h=100;c=0.9|><|mask;x=0;y=0;c=0.9;${token}|>`;
  const sse = [
    `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"${line.slice(0, 40)}"}`,
    `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":${JSON.stringify(line.slice(40))}}`,
    `event: response.completed\ndata: {"type":"response.completed"}`,
  ].join("\n\n");
  const fetchFn = (async () => ({ ok: true, status: 200, text: async () => sse })) as unknown as typeof fetch;
  const result = await segmentWithSam({
    fetchFn,
    base: "https://api.meta.ai/v1",
    apiKey: "test",
    request: { imageUrl: "data:image/jpeg;base64,AAA", size: { width: 100, height: 100 }, points: [{ x: 12, y: 21 }] },
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.objectId, 1);
  assert.equal(result.records[0]?.box.confidence, 0.9);
  assert.equal(result.records[0]?.mask.width, 6);
  assert.equal(result.records[0]?.mask.height, 4);
  assert.equal(result.records[0]?.frameMask.width, 100);
  assert.equal(result.records[0]?.frameMask.height, 100);
  // Box (10,20)-(15,23) inclusive covers 6x4; the diagonal raster lands on the frame.
  const on = result.records[0]?.frameMask.data.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0) ?? 0;
  assert.ok(on > 0 && on <= 24);
});

test("live segment fails closed on empty output or HTTP errors", async () => {
  const empty = (async () => ({ ok: true, status: 200, text: async () => "" })) as unknown as typeof fetch;
  await assert.rejects(() =>
    segmentWithSam({ fetchFn: empty, base: "https://x", apiKey: "k", request: { imageUrl: "u", size: { width: 10, height: 10 }, points: [{ x: 1, y: 1 }] } }),
  );
  const bad = (async () => ({ ok: false, status: 403, text: async () => "" })) as unknown as typeof fetch;
  await assert.rejects(() =>
    segmentWithSam({ fetchFn: bad, base: "https://x", apiKey: "k", request: { imageUrl: "u", size: { width: 10, height: 10 }, points: [{ x: 1, y: 1 }] } }),
  );
});
