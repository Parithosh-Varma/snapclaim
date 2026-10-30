import { decodeMaskToRaster } from "@meta-sam/parser";
import { MeasurementError } from "../engine/math.ts";
import type { BinaryMask, CocoRle } from "./mask.ts";
import { MAX_MASK_PIXELS, assertMaskSize, decodeRle, encodeRle as encodeRleMask, rleRoundTrip as rleRoundTripMask } from "./mask.ts";

export { encodeRleMask as encodeRle, rleRoundTripMask as rleRoundTrip };

/**
 * SAM 3.1 over the Meta Model API Responses endpoint.
 *
 * The wire format is special-token text in the `output_text` lane
 * (see dev.meta.ai/docs/sam/reading-segmentation): one line per frame,
 * one box + one mask per record, masks base85-encoded. Prompting uses
 * point/box tokens in the same grammar. Mask rasters are decoded with
 * the official `@meta-sam/parser` package — this repo never guesses
 * the base85 packing.
 */

export interface SamSize {
  width: number;
  height: number;
}

export interface SamPoint {
  x: number;
  y: number;
  /** Positive = part of the object; negative = explicitly not. Defaults to positive. */
  label?: "positive" | "negative";
}

export interface SamBoxPrompt {
  left: number;
  top: number;
  /** Half-open, like a parsed box record: right/bottom are exclusive. */
  right: number;
  bottom: number;
}

export interface SamObjectPrompt {
  id: number;
  points?: SamPoint[];
  box?: SamBoxPrompt;
}

export interface SamBox {
  x1: number;
  y1: number;
  /** Inclusive, as the API reports them. */
  x2: number;
  y2: number;
  w: number;
  h: number;
  confidence?: number;
}

export type SamMaskEncoding = "lossless" | "one_bit";

export interface SamMaskToken {
  x: number;
  y: number;
  h: number;
  w: number;
  enc: SamMaskEncoding;
  payload: string;
  confidence?: number;
}

export interface SamRecord {
  objectId: number;
  box: SamBox;
  mask: SamMaskToken;
}

export interface SamFrame {
  frame: number;
  records: SamRecord[];
}

function assertSize(size: SamSize): void {
  assertMaskSize(size.width, size.height);
}

/** Upper bound on a decoded SAM mask raster (prevents a malicious upstream
 * from OOMing the backend with w=50000,h=50000). */
const MAX_SAM_RASTER_PIXELS = MAX_MASK_PIXELS;

function assertPointInMedia(point: SamPoint, size: SamSize): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new MeasurementError(`point must be finite numbers, got (${point.x}, ${point.y})`);
  }
  if (point.x < 0 || point.y < 0 || point.x >= size.width || point.y >= size.height) {
    throw new MeasurementError(`point (${point.x}, ${point.y}) lies outside the ${size.width}x${size.height} frame`);
  }
}

/**
 * Builds the `input_text` prompt for tap/box prompts on a single image.
 * Coordinates are media pixels; `w`/`h` are the media size, as the API requires.
 */
export function buildObjectPrompt(size: SamSize, objects: SamObjectPrompt[]): string {
  assertSize(size);
  if (objects.length === 0) throw new MeasurementError("at least one prompted object is required");
  if (objects.length > 16) throw new MeasurementError(`${objects.length} objects exceed this model's limit of 16`);
  const seen = new Set<number>();
  const parts = objects.map((object) => {
    if (!Number.isInteger(object.id) || object.id < 0) {
      throw new MeasurementError(`object id must be a non-negative integer, got ${object.id}`);
    }
    if (seen.has(object.id)) throw new MeasurementError(`object id ${object.id} is used more than once`);
    seen.add(object.id);
    const tokens: string[] = [];
    if (object.box !== undefined) {
      const box = object.box;
      for (const [name, value] of [["left", box.left], ["top", box.top], ["right", box.right], ["bottom", box.bottom]] as const) {
        if (!Number.isInteger(value)) throw new MeasurementError(`box.${name} must be an integer, got ${value}`);
      }
      if (box.left < 0 || box.top < 0 || box.right > size.width || box.bottom > size.height || box.left >= box.right || box.top >= box.bottom) {
        throw new MeasurementError(`box [${box.left},${box.top},${box.right},${box.bottom}] is outside the ${size.width}x${size.height} frame`);
      }
      // Builder takes half-open right/bottom; the wire wants inclusive x2/y2.
      tokens.push(`<|box;x1=${box.left};y1=${box.top};x2=${box.right - 1};y2=${box.bottom - 1};w=${size.width};h=${size.height}|>`);
    }
    for (const point of object.points ?? []) {
      assertPointInMedia(point, size);
      const x = Math.floor(point.x);
      const y = Math.floor(point.y);
      const token = `<|point;x=${x};y=${y};w=${size.width};h=${size.height}|>`;
      tokens.push(point.label === "negative" ? `-${token}` : token);
    }
    if (tokens.length === 0) throw new MeasurementError(`object ${object.id} has no prompts`);
    return `${object.id}${tokens.join("")}`;
  });
  return `<0f>${parts.join(",")}`;
}

const CONF = String.raw`(?:;c=(?<conf>\d+(?:\.\d+)?))?`;
const BOX_RE = new RegExp(
  String.raw`<\|box;x1=(?<x1>\d+);y1=(?<y1>\d+);x2=(?<x2>\d+);y2=(?<y2>\d+);w=(?<w>\d+);h=(?<h>\d+)${CONF}\|>`,
  "g",
);
const MASK_RE = new RegExp(
  String.raw`<\|mask;x=(?<mx>\d+);y=(?<my>\d+)${CONF};data=(?<mh>\d+),(?<mw>\d+),(?<enc>[~!])(?<payload>.*?)\|>`,
  "g",
);

function parseConfidence(value: string | undefined, where: string): number | undefined {
  if (value === undefined) return undefined;
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new MeasurementError(`${where} confidence must be between 0 and 1, got ${value}`);
  }
  return confidence;
}

/**
 * Parses SAM 3.1 output text (one line per frame) into frames and records.
 * Throws on malformed lines instead of returning partial geometry.
 * Mask payloads are returned untouched; decode them with `maskTokenToBinaryMask`.
 */
export function parseSamOutputText(outputText: string): SamFrame[] {
  const frames: SamFrame[] = [];
  const lines = outputText.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  for (const line of lines) {
    const frameMatch = line.match(/^<(\d+)f>/);
    if (!frameMatch) throw new MeasurementError(`line has no frame marker: ${line.slice(0, 40)}`);
    const frame = Number(frameMatch[1]);
    const rest = line.slice(frameMatch[0].length);
    const records: SamRecord[] = [];
    // Records are comma-separated, but mask payloads may contain commas,
    // so scan for box/mask tokens and read the object id in front of each box.
    let cursor = 0;
    let first = true;
    while (cursor < rest.length) {
      if (!first) {
        if (rest[cursor] !== ",") throw new MeasurementError(`expected "," between records: ${rest.slice(cursor, cursor + 40)}`);
        cursor += 1;
      }
      first = false;
      const idMatch = rest.slice(cursor).match(/^(\d+)/);
      if (!idMatch?.[1]) throw new MeasurementError(`record has no object id: ${rest.slice(cursor, cursor + 40)}`);
      const objectId = Number(idMatch[1]);
      cursor += idMatch[1].length;

      BOX_RE.lastIndex = cursor;
      const boxMatch = BOX_RE.exec(rest);
      if (!boxMatch?.groups || boxMatch.index !== cursor) {
        throw new MeasurementError(`object ${objectId} has no box token where expected`);
      }
      cursor = BOX_RE.lastIndex;
      MASK_RE.lastIndex = cursor;
      const maskMatch = MASK_RE.exec(rest);
      if (!maskMatch?.groups) {
        throw new MeasurementError(`object ${objectId} has no mask token after its box`);
      }
      // A mask token must follow the box directly (no comma between box and mask).
      if (maskMatch.index !== cursor) {
        throw new MeasurementError(`object ${objectId}: mask token does not follow its box`);
      }
      cursor = MASK_RE.lastIndex;

      const groups = boxMatch.groups;
      const maskGroups = maskMatch.groups;
      const box: SamBox = {
        x1: Number(groups["x1"]),
        y1: Number(groups["y1"]),
        x2: Number(groups["x2"]),
        y2: Number(groups["y2"]),
        w: Number(groups["w"]),
        h: Number(groups["h"]),
      };
      const boxConfidence = parseConfidence(groups["conf"], `object ${objectId} box`);
      if (boxConfidence !== undefined) box.confidence = boxConfidence;
      if (box.x2 < box.x1 || box.y2 < box.y1) {
        throw new MeasurementError(`object ${objectId} box is inverted: x1=${box.x1} x2=${box.x2}`);
      }
      records.push({
        objectId,
        box,
        mask: {
          x: Number(maskGroups["mx"]),
          y: Number(maskGroups["my"]),
          h: Number(maskGroups["mh"]),
          w: Number(maskGroups["mw"]),
          enc: maskGroups["enc"] === "!" ? "one_bit" : "lossless",
          payload: maskGroups["payload"] ?? "",
          confidence: parseConfidence(maskGroups["conf"], `object ${objectId} mask`),
        },
      });
    }
    frames.push({ frame, records });
  }
  return frames;
}

/** Decodes one parsed mask token to a row-major binary raster using the official parser. */
export function maskTokenToBinaryMask(mask: SamMaskToken): BinaryMask {
  assertMaskSize(mask.w, mask.h);
  if (mask.w * mask.h > MAX_SAM_RASTER_PIXELS) {
    throw new MeasurementError(`mask raster ${mask.w}x${mask.h} exceeds the ${MAX_SAM_RASTER_PIXELS}-pixel cap`);
  }
  // The wire grammar puts the encoding marker before the payload (`!`/`~`);
  // the official decoder wants the payload WITH its marker, so re-attach it.
  const marked = `${mask.enc === "one_bit" ? "!" : "~"}${mask.payload}`;
  const raster = decodeMaskToRaster({ encoding: mask.enc, payload: marked, width: mask.w, height: mask.h });
  if (raster.length !== mask.h * mask.w) {
    throw new MeasurementError(`decoded raster has ${raster.length} bytes, expected ${mask.h * mask.w}`);
  }
  return { width: mask.w, height: mask.h, data: Uint8Array.from(raster) };
}

/**
 * Pastes a decoded mask raster into a full-frame mask at the record's box,
 * nearest-neighbour scaled. The raster covers the half-open box
 * [left,top,right,bottom); use the parsed box converted with x2+1/right.
 */
export function pasteRasterToFrame(
  raster: BinaryMask,
  box: { left: number; top: number; right: number; bottom: number },
  frame: SamSize,
): BinaryMask {
  assertSize(frame);
  const out = new Uint8Array(frame.width * frame.height);
  const boxW = box.right - box.left;
  const boxH = box.bottom - box.top;
  if (boxW <= 0 || boxH <= 0) throw new MeasurementError("paste box must have positive size");
  for (let y = 0; y < frame.height; y++) {
    const sy = Math.min(raster.height - 1, Math.floor(((y - box.top) / boxH) * raster.height));
    if (y < box.top || y >= box.bottom) continue;
    for (let x = 0; x < frame.width; x++) {
      if (x < box.left || x >= box.right) continue;
      const sx = Math.min(raster.width - 1, Math.floor(((x - box.left) / boxW) * raster.width));
      if (raster.data[sy * raster.width + sx] !== 0) out[y * frame.width + x] = 1;
    }
  }
  return { width: frame.width, height: frame.height, data: out };
}

export interface SamFetchRequest {
  imageUrl: string;
  size: SamSize;
  points: SamPoint[];
  objectId?: number;
}

export interface SamFetchResult {
  records: Array<{ objectId: number; box: SamBox; mask: BinaryMask; frameMask: BinaryMask }>;
  outputText: string;
}

/**
 * Live SAM 3.1 segmentation over the Responses API.
 * Accumulates `response.output_text.delta` lanes from the SSE stream,
 * parses them with `parseSamOutputText`, and decodes every mask.
 * Throws — never returns a fake mask — on any malformed or empty output.
 */
export async function segmentWithSam(input: {
  fetchFn?: typeof fetch;
  base: string;
  apiKey: string;
  model?: string;
  request: SamFetchRequest;
}): Promise<SamFetchResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const model = input.model ?? "sam-3.1";
  const { imageUrl, size, points } = input.request;
  assertSize(size);
  if (points.length === 0) throw new MeasurementError("at least one point prompt is required");
  const prompt = buildObjectPrompt(size, [{ id: input.request.objectId ?? 1, points }]);

  const res = await (fetchFn as typeof fetch)(`${input.base}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({
      model,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
      stream: true,
      metadata: { mask_encoding: "one_bit", include_confidence: "true" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`SAM 3.1 request failed: HTTP ${res.status}`);
  const sse = await res.text();

  let outputText = "";
  const MAX_SSE_CHARS = 5_000_000;
  for (const chunk of sse.split("\n\n")) {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "" || data === "[DONE]") continue;
      let event: { type?: string; delta?: string };
      try {
        event = JSON.parse(data) as { type?: string; delta?: string };
      } catch {
        throw new Error("SAM 3.1 stream sent invalid JSON");
      }
      if (typeof event.delta === "string") {
        outputText += event.delta;
        if (outputText.length > MAX_SSE_CHARS) {
          throw new Error(`SAM 3.1 stream exceeded the ${MAX_SSE_CHARS}-char cap`);
        }
      }
    }
  }
  if (outputText.trim() === "") throw new Error("SAM 3.1 returned no segmentation output");
  const frames = parseSamOutputText(outputText);
  const first = frames[0];
  if (!first || first.records.length === 0) throw new Error("SAM 3.1 found no matching object");
  if (first.records.length > 50) throw new Error(`SAM 3.1 returned ${first.records.length} records, capped at 50`);
  return {
    outputText,
    records: first.records.map((record) => {
      const raster = maskTokenToBinaryMask(record.mask);
      return {
        objectId: record.objectId,
        box: record.box,
        mask: raster,
        frameMask: pasteRasterToFrame(raster, frameBox(record.box), size),
      };
    }),
  };
}

/** Parsed box (inclusive x2/y2) to the half-open paste box. */
export function frameBox(box: SamBox): { left: number; top: number; right: number; bottom: number } {
  return { left: box.x1, top: box.y1, right: box.x2 + 1, bottom: box.y2 + 1 };
}
