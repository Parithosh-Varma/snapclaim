// Backend Worker calls. The base URL is a setting (Settings tab and the
// developer panel on Report both edit the same value via the store).
// Strict allowlist, mirrored by the <meta> CSP connect-src in index.html:
// only the default Worker host (https) and loopback http for local dev.
// To self-host: add the host to connect-src AND to DEFAULT_BACKEND_HOST.
// See README "Self-hosted backend".
export const DEFAULT_BASE = "https://snapclaim-backend.parithosh.workers.dev";
export const DEFAULT_BACKEND_HOST = "snapclaim-backend.parithosh.workers.dev";
export const POLICY_BACKEND_MESSAGE =
  `This backend isn't allowed by the app's security policy — use https://${DEFAULT_BACKEND_HOST} or http://localhost:8787 for local dev.`;

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

export async function apiPost(
  base: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ res: Response; j: ApiReply }> {
  const res = await fetch(checkedBase(base) + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const j = (await res.json().catch(() => ({}))) as ApiReply;
  return { res, j };
}

export async function apiGet(base: string, path: string): Promise<{ res: Response; j: ApiReply }> {
  const res = await fetch(checkedBase(base) + path);
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
