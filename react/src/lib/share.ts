/**
 * Shareable landlord links, with no server storage: the whole report rides
 * in the URL hash (`#/s/...`), so nothing is ever uploaded. Anyone opening
 * the link sees the read-only report; the fragment never reaches the server.
 */

export interface SharedReport {
  v: 1;
  ref: string;
  date: string;
  label: string;
  percent: number;
  lengthMm: number | null;
  widthMm: number | null;
  areaCm2: number | null;
  severity: string;
  mode: "absolute" | "percent-only";
  transcript: string;
  checks: string;
  /** Full-frame figure (the generated annexure when present) as a data: URL. */
  img: string;
  /** Optional wider context shot as a data: URL. */
  locationImg?: string | null;
}

/** Links stay pastable in chat apps and email up to ~1.5 MB encoded. */
export const MAX_SHARE_URL_CHARS = 1_500_000;

function b64urlEncode(raw: string): string {
  return btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(enc: string): string {
  const b64 = enc.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(b64)));
}

function isSharedReport(v: unknown): v is SharedReport {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const SEVERITIES = new Set(["cosmetic", "moderate", "significant"]);
  const num = (x: unknown, min: number, max: number): boolean =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
  return (
    r.v === 1 &&
    typeof r.ref === "string" && /^[A-Za-z0-9-_]{1,32}$/.test(r.ref) &&
    typeof r.date === "string" && r.date.length <= 64 &&
    typeof r.label === "string" && r.label.length <= 32 &&
    num(r.percent, 0, 100) &&
    (r.lengthMm === null || num(r.lengthMm, 0, 100000)) &&
    (r.widthMm === null || num(r.widthMm, 0, 100000)) &&
    (r.areaCm2 === null || num(r.areaCm2, 0, 1000000)) &&
    typeof r.severity === "string" && SEVERITIES.has(r.severity.toLowerCase()) &&
    (r.mode === "absolute" || r.mode === "percent-only") &&
    typeof r.transcript === "string" && r.transcript.length <= 2000 &&
    typeof r.checks === "string" && r.checks.length <= 500 &&
    typeof r.img === "string" && r.img.length <= MAX_SHARE_URL_CHARS && r.img.startsWith("data:image/jpeg;base64,") &&
    (r.locationImg === undefined || r.locationImg === null ||
      (typeof r.locationImg === "string" && r.locationImg.length <= MAX_SHARE_URL_CHARS && r.locationImg.startsWith("data:image/jpeg;base64,")))
  );
}

/** Encode a report into the `#/s/...` hash suffix. Throws when too large. */
export function encodeSharePayload(rep: SharedReport): string {
  const enc = b64urlEncode(JSON.stringify(rep));
  if (enc.length > MAX_SHARE_URL_CHARS) {
    throw new Error(`report too large for a link (${Math.round(enc.length / 1024)} KB) - download the PDF instead`);
  }
  return `#/s/${enc}`;
}

/** Parse a `#/s/...` hash back into a report, or null when absent/garbage. */
export function decodeShareHash(hash: string): SharedReport | null {
  if (!hash.startsWith("#/s/")) return null;
  try {
    const v: unknown = JSON.parse(b64urlDecode(hash.slice(4)));
    return isSharedReport(v) ? v : null;
  } catch {
    return null;
  }
}

/** Absolute share URL for the current page origin. */
export function shareUrl(rep: SharedReport): string {
  return `${window.location.origin}${window.location.pathname}${encodeSharePayload(rep)}`;
}
