/**
 * Strips identifying metadata from an uploaded photo before anything else sees it.
 *
 * Phone photos carry GPS coordinates, device serials and timestamps in EXIF,
 * XMP and text chunks. A damage report gets shared with landlords and
 * insurers, so none of that leaves the device. Pixel data is copied byte for
 * byte: nothing is re-encoded, so masks and measurements are unaffected.
 */

export class ImageIntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageIntakeError";
  }
}

export type ImageFormat = "jpeg" | "png";

export interface StrippedImage {
  format: ImageFormat;
  bytes: Uint8Array;
  /**
   * EXIF orientation (1–8) read before stripping, or 1 when absent. Stripping
   * removes the tag, so a viewer must apply this rotation itself.
   */
  orientation: number;
  /** What was removed, for the intake receipt: segment or chunk name and its size in bytes. */
  removed: Array<{ kind: string; bytes: number }>;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** JPEG APPn / COM markers that hold metadata rather than image data. */
const JPEG_METADATA_MARKERS = new Map<number, string>([
  [0xe1, "APP1 (EXIF/XMP)"],
  [0xe3, "APP3"],
  [0xe4, "APP4"],
  [0xe5, "APP5"],
  [0xe6, "APP6"],
  [0xe7, "APP7"],
  [0xe8, "APP8"],
  [0xe9, "APP9"],
  [0xea, "APP10"],
  [0xeb, "APP11"],
  [0xec, "APP12"],
  [0xed, "APP13 (IPTC)"],
  [0xef, "APP15"],
  [0xfe, "COM"],
]);
// Kept on purpose: APP0 (JFIF), APP2 (ICC colour profile), APP14 (Adobe colour transform).

/** PNG chunks kept verbatim: critical chunks plus colourimetry/geometry ancillaries.
 * Everything else (text, EXIF, timestamps, ICC profiles, histograms and any
 * unknown private chunks) is dropped — a denylist cannot cover custom
 * ancillary chunks that may carry location or device identifiers. */
const PNG_KEPT_CHUNKS = new Set([
  "IHDR", "PLTE", "IDAT", "IEND",
  "cHRM", "gAMA", "sRGB", "bKGD", "pHYs",
]);

export function detectFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "png";
  throw new ImageIntakeError("unsupported image format: only JPEG and PNG are accepted");
}

export function stripMetadata(bytes: Uint8Array): StrippedImage {
  return detectFormat(bytes) === "jpeg" ? stripJpeg(bytes) : stripPng(bytes);
}

/** Offset just past the EOI marker closing the scan that starts at sosPos,
 * or -1 when none is found (fall back to copying the tail untouched). */
function findEoi(bytes: Uint8Array, sosPos: number): number {
  if (sosPos + 4 > bytes.length) return -1;
  const sosLen = ((bytes[sosPos + 2] as number) << 8) | (bytes[sosPos + 3] as number);
  let i = sosPos + 2 + sosLen;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const next = bytes[i + 1] as number;
    if (next === 0x00) {
      i += 2; // stuffed literal 0xFF inside entropy-coded data
    } else if (next === 0xff) {
      i += 1; // fill byte
    } else if (next === 0xd9) {
      return i + 2;
    } else {
      i += 2; // RSTn or resync marker: standalone, keep scanning
    }
  }
  return -1;
}

function stripJpeg(bytes: Uint8Array): StrippedImage {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  const removed: StrippedImage["removed"] = [];
  let orientation = 1;
  let p = 2;

  while (p < bytes.length) {
    if (bytes[p] !== 0xff) throw new ImageIntakeError(`malformed JPEG: expected a marker at byte ${p}`);
    const marker = bytes[p + 1];
    if (marker === undefined) throw new ImageIntakeError("malformed JPEG: truncated marker");
    if (marker === 0xff) {
      p++; // fill byte
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      // Start of scan (or a bare end of image): copy through the end of image
      // marker, then drop anything trailing it. Bytes after EOI are not image
      // data — metadata smuggled past SOS (a second APP1 in the tail) is cut
      // here instead of being copied verbatim.
      const eoi = findEoi(bytes, p);
      if (eoi < 0) {
        kept.push(bytes.subarray(p));
        return { format: "jpeg", bytes: concat(kept), orientation, removed };
      }
      kept.push(bytes.subarray(p, eoi));
      const tail = bytes.subarray(eoi);
      if (tail.length > 0) removed.push({ kind: "trailing data after EOI", bytes: tail.length });
      return { format: "jpeg", bytes: concat(kept), orientation, removed };
    }
    if (p + 4 > bytes.length) throw new ImageIntakeError("malformed JPEG: truncated segment header");
    const length = ((bytes[p + 2] as number) << 8) | (bytes[p + 3] as number);
    const end = p + 2 + length;
    if (length < 2 || end > bytes.length) throw new ImageIntakeError(`malformed JPEG: bad segment length at byte ${p}`);

    const name = JPEG_METADATA_MARKERS.get(marker);
    if (name === undefined) {
      kept.push(bytes.subarray(p, end));
    } else {
      if (marker === 0xe1) orientation = readExifOrientation(bytes.subarray(p + 4, end)) ?? orientation;
      removed.push({ kind: name, bytes: end - p });
    }
    p = end;
  }
  throw new ImageIntakeError("malformed JPEG: no image data found");
}

/** Orientation tag (0x0112) from an APP1 payload, or null when it is not EXIF or has none. */
function readExifOrientation(payload: Uint8Array): number | null {
  const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  if (!header.every((b, i) => payload[i] === b)) return null;
  const tiff = payload.subarray(6);
  if (tiff.length < 8) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;

  const ifd = view.getUint32(4, little);
  if (ifd + 2 > tiff.length) return null;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

function stripPng(bytes: Uint8Array): StrippedImage {
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed: StrippedImage["removed"] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;

  while (p < bytes.length) {
    if (p + 12 > bytes.length) throw new ImageIntakeError(`malformed PNG: truncated chunk at byte ${p}`);
    const length = view.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const end = p + 12 + length;
    if (end > bytes.length) throw new ImageIntakeError(`malformed PNG: chunk ${type} overruns the file`);

    if (PNG_KEPT_CHUNKS.has(type)) {
      kept.push(bytes.subarray(p, end));
    } else {
      removed.push({ kind: type, bytes: end - p });
    }
    p = end;
    if (type === "IEND") {
      return { format: "png", bytes: concat(kept), orientation: 1, removed };
    }
  }
  throw new ImageIntakeError("malformed PNG: no IEND chunk");
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
