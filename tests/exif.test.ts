import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ImageIntakeError, detectFormat, stripMetadata } from "../src/vision/exif.ts";

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/** Minimal EXIF payload: one IFD0 with Orientation and a GPS IFD pointer. */
function exifPayload(orientation: number, little: boolean): number[] {
  const u16 = (v: number): number[] => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number): number[] =>
    little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  return [
    ...ascii("Exif"), 0, 0,
    ...(little ? ascii("II") : ascii("MM")), ...u16(42), ...u32(8),
    ...u16(2),
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0,
    ...u16(0x8825), ...u16(4), ...u32(1), ...u32(38),
    ...u32(0),
    ...ascii("GPS 49.2827N 123.1207W"),
  ];
}

const SCAN = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0x00, 0x33, 0xff, 0xd9];
const JFIF = segment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const ICC = segment(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, 9, 9]);

function jpeg(orientation: number, little: boolean): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    ...JFIF,
    ...segment(0xe1, exifPayload(orientation, little)),
    ...ICC,
    ...segment(0xfe, ascii("shot on Pixel 9, serial 1234")),
    ...SCAN,
  ]);
}

test("JPEG: EXIF and comments are removed, image data is byte-identical", () => {
  const input = jpeg(6, true);
  const out = stripMetadata(input);

  assert.equal(out.format, "jpeg");
  assert.equal(out.orientation, 6);
  assert.deepEqual(out.removed.map((r) => r.kind), ["APP1 (EXIF/XMP)", "COM"]);
  assert.deepEqual([...out.bytes], [0xff, 0xd8, ...JFIF, ...ICC, ...SCAN]);

  const text = new TextDecoder("latin1").decode(out.bytes);
  assert.ok(!text.includes("GPS") && !text.includes("serial"));
});

test("JPEG: big-endian EXIF reads the same orientation", () => {
  assert.equal(stripMetadata(jpeg(8, false)).orientation, 8);
});

test("JPEG without EXIF passes through with orientation 1", () => {
  const input = Uint8Array.from([0xff, 0xd8, ...JFIF, ...SCAN]);
  const out = stripMetadata(input);
  assert.deepEqual(out.bytes, input);
  assert.equal(out.orientation, 1);
  assert.equal(out.removed.length, 0);
});

function pngChunk(type: string, data: number[]): number[] {
  const n = data.length;
  // CRC is not checked by the stripper; kept chunks are copied with theirs intact.
  return [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, ...ascii(type), ...data, 1, 2, 3, 4];
}

test("PNG: text, EXIF and time chunks are removed, the rest is kept in order", () => {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = pngChunk("IHDR", Array(13).fill(0));
  const idat = pngChunk("IDAT", [9, 8, 7]);
  const iend = pngChunk("IEND", []);
  const input = Uint8Array.from([
    ...header,
    ...ihdr,
    ...pngChunk("tEXt", ascii("Author\0Tariq")),
    ...pngChunk("eXIf", [1, 2, 3]),
    ...idat,
    ...pngChunk("tIME", [7, 234, 10, 28, 9, 0, 0]),
    ...iend,
  ]);

  const out = stripMetadata(input);
  assert.equal(out.format, "png");
  assert.deepEqual(out.removed.map((r) => r.kind), ["tEXt", "eXIf", "tIME"]);
  assert.deepEqual([...out.bytes], [...header, ...ihdr, ...idat, ...iend]);
});

test("unknown, truncated or malformed files are refused", () => {
  assert.throws(() => detectFormat(Uint8Array.from(ascii("GIF89a"))), ImageIntakeError);
  assert.throws(() => stripMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, 1, 2])), ImageIntakeError);
  assert.throws(() => stripMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0])), ImageIntakeError);
});
