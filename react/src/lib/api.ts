// Backend Worker calls. The base URL is a setting (Settings tab and the
// developer panel on Report both edit the same value via the store).
export const DEFAULT_BASE = "https://snapclaim-backend.parithosh.workers.dev";

/** Backend URL allowlist: https: anywhere, or http: loopback for local dev. */
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
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    const h = url.hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
  }
  return false;
}

function checkedBase(base: string): string {
  const v = base.trim().replace(/\/$/, "");
  if (!isAllowedBackendUrl(v)) throw new Error("Backend URL must be https:// or http://localhost");
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

/** HTML-escape for any backend/model text rendered as markup. */
export function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
