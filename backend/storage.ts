import type { Env, FetchFn } from "./providers.ts";
import { stripMetadata } from "../src/vision/exif.ts";

/**
 * Supabase Storage archival for segment inputs.
 *
 * When a caller posts a `data:` image to /v1/segment, the decoded bytes are
 * stored in the `images` bucket so the exact input stays re-runnable and
 * auditable. Storage is best-effort by design: this module NEVER throws -
 * any misconfiguration or network failure yields `null` and the measurement
 * pipeline continues with the inline data URL untouched.
 *
 * Auth uses the publishable key, so the bucket must grant anon INSERT
 * (see README "Image storage"). Reads need no key: public buckets serve
 * `{url}/storage/v1/object/public/images/{path}` directly.
 */

const BUCKET = "images";
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function storageConfigured(env: Env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim()) &&
    Boolean(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim());
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; ext: string; mime: string } | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0 || comma > 64) return null;
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  const ext = MIME_EXT[mime];
  if (!ext) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length === 0) return null;
    // Magic-byte check: MIME string alone allows polyglot stored objects
    // served as content-type:image/* (content-type confusion).
    if (!matchesMagic(bytes, mime)) return null;
    return { bytes: scrubMetadata(bytes, mime) ?? bytes, ext, mime };
  } catch {
    return null;
  }
}

/** Verify the decoded bytes match the claimed raster type. */
function matchesMagic(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/png") {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (mime === "image/jpeg") {
    return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  }
  if (mime === "image/webp") {
    return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

/**
 * Strip identifying metadata (GPS, serials, timestamps) before the bytes are
 * archived server-side and shared with landlords/insurers. WebP and unknown
 * shapes pass through unchanged; stripping never throws (callers fall back
 * to the original bytes).
 */
function scrubMetadata(bytes: Uint8Array, mime: string): Uint8Array | null {
  if (mime !== "image/png" && mime !== "image/jpeg") return null;
  try {
    return stripMetadata(bytes).bytes;
  } catch {
    return null;
  }
}

/**
 * Archive one inline segment image. Returns the public URL, or null when
 * storage is unconfigured, the input isn't an inline raster, or the upload
 * fails for any reason. Never throws.
 */
export async function archiveSegmentImage(
  env: Env,
  dataUrl: string,
  requestId: string,
  fetchFn?: FetchFn,
): Promise<string | null> {
  try {
    if (!storageConfigured(env) || !dataUrl.startsWith("data:")) return null;
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) return null;
    const base = (env.NEXT_PUBLIC_SUPABASE_URL as string).replace(/\/+$/, "");
    const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
    const day = new Date().toISOString().slice(0, 10);
    const safeId = requestId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 40) || "unknown";
    const path = `segments/${day}/${safeId}.${decoded.ext}`;
    const res = await (fetchFn ?? fetch)(`${base}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "content-type": decoded.mime,
        "x-upsert": "false",
      },
      body: decoded.bytes as unknown as BodyInit,
    });
    if (!res.ok) return null;
    return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
  } catch {
    return null;
  }
}
