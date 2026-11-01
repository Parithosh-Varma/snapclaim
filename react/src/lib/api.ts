// Backend Worker calls. The base URL is a setting (Settings tab and the
// developer panel on Report both edit the same value via the store).
// Strict allowlist, mirrored by the <meta> CSP connect-src in index.html:
// only the default Worker host (https) and loopback http for local dev.
// To self-host: add the host to connect-src AND to DEFAULT_BACKEND_HOST.
// See README "Self-hosted backend".
// Settings key mirror - the canonical constant lives in ./store.ts (importing
// it breaks one of the two tsconfigs: root needs an explicit extension,
// react/bundler forbids it). Keep in sync.
const SETTINGS_KEY = "snapclaim.settings.v1";
export const DEFAULT_BASE = "https://snapclaim-backend.parithosh.workers.dev";
export const DEFAULT_BACKEND_HOST = "snapclaim-backend.parithosh.workers.dev";
export const POLICY_BACKEND_MESSAGE =
  `This backend isn't allowed by the app's security policy - use https://${DEFAULT_BACKEND_HOST} or http://localhost:8787 for local dev.`;

/** Backend URL allowlist: https only for the default host, http only loopback. */
export function isAllowedBackendUrl(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().replace(/\/$/, "");
  if (v === "") return false;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") {
    return url.hostname.toLowerCase() === DEFAULT_BACKEND_HOST;
  }
  if (url.protocol === "http:") {
    const h = url.hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
  }
  return false;
}

function checkedBase(base: string): string {
  const v = base.trim().replace(/\/$/, "");
  if (!isAllowedBackendUrl(v)) throw new Error(POLICY_BACKEND_MESSAGE);
  return v;
}

export interface ApiReply {
  ok?: boolean;
  error?: string;
  requestId?: string;
  result?: Record<string, never> & { [key: string]: unknown };
  details?: unknown;
  failures?: unknown;
  [key: string]: unknown;
}

/** Bring-your-own-key headers, read fresh every call so save/clear applies
    immediately. Keys live only in this device's localStorage and travel only
    to the configured backend, which uses them per-request and never stores
    them. Absent outside a browser (tests, SSR) this is safely empty. */
export function byokHeaders(): Record<string, string> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const s = JSON.parse(raw) as { metaKey?: unknown; basetenKey?: unknown };
    const out: Record<string, string> = {};
    if (typeof s.metaKey === "string" && s.metaKey.trim()) out["x-meta-key"] = s.metaKey.trim().slice(0, 512);
    if (typeof s.basetenKey === "string" && s.basetenKey.trim()) out["x-baseten-key"] = s.basetenKey.trim().slice(0, 512);
    return out;
  } catch {
    return {};
  }
}

export async function apiPost(
  base: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<{ res: Response; j: ApiReply }> {
  const res = await fetch(checkedBase(base) + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...byokHeaders(), ...extraHeaders },
    body: JSON.stringify(body),
    signal,
  });
  const j = (await res.json().catch(() => ({}))) as ApiReply;
  return { res, j };
}

export async function apiGet(
  base: string,
  path: string,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<{ res: Response; j: ApiReply }> {
  const res = await fetch(checkedBase(base) + path, {
    headers: { ...byokHeaders(), ...extraHeaders },
    signal,
  });
  const j = (await res.json().catch(() => ({}))) as ApiReply;
  return { res, j };
}

export interface BackendError extends Error {
  status: number;
  details?: string[];
}

/** Backend failure with HTTP status + structured details attached; no payloads. */
export function backendError(res: Response, j: ApiReply, fallback: string): BackendError {
  const raw = j.details ?? j.failures;
  const details = Array.isArray(raw) ? raw.map(String) : raw === undefined ? undefined : [String(raw)];
  const summary = details?.length ? `: ${details.join("; ").slice(0, 500)}` : "";
  const err = new Error(`${j.error ?? fallback} (HTTP ${res.status})${summary}`) as BackendError;
  err.status = res.status;
  err.details = details;
  return err;
}

/** HTML-escape for any backend/model text rendered as markup. */
export function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
