import { HttpError, type FetchFn } from "./providers.ts";

const ID_RE = /^[0-9a-f-]{8,64}$/i;

export interface RemoteD1Options {
  fetchFn?: FetchFn;
  apiToken: string;
  accountId: string;
  databaseId: string;
  sql: string;
  params?: unknown[];
}

function checkTarget(accountId: unknown, databaseId: unknown): { accountId: string; databaseId: string } {
  if (typeof accountId !== "string" || !ID_RE.test(accountId)) {
    throw new HttpError(400, "accountId must be a hex/uuid Cloudflare account id");
  }
  if (typeof databaseId !== "string" || !ID_RE.test(databaseId)) {
    throw new HttpError(400, "databaseId must be a hex/uuid D1 database id");
  }
  return { accountId, databaseId };
}

/**
 * Run one SQL statement against any D1 database in any account via the
 * Cloudflare HTTP API. The caller supplies the API token (worker secret for
 * first-party routes, per-request token for the key-guarded generic relay).
 * Returns the decoded `result` array from the D1 query endpoint.
 */
export async function executeRemoteD1(options: RemoteD1Options): Promise<unknown[]> {
  const { accountId, databaseId } = checkTarget(options.accountId, options.databaseId);
  if (typeof options.apiToken !== "string" || options.apiToken.length === 0) {
    throw new HttpError(503, "D1 proxy token not configured");
  }
  if (typeof options.sql !== "string" || options.sql.trim().length === 0) {
    throw new HttpError(400, "sql must be a non-empty string");
  }
  if (options.sql.length > 20_000) throw new HttpError(400, "sql over 20KB — split the statement");
  const params = options.params ?? [];
  if (!Array.isArray(params) || params.length > 100) throw new HttpError(400, "params must be an array of at most 100 values");
  const fetchFn = options.fetchFn ?? fetch;
  const res = await fetchFn(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.apiToken}` },
      body: JSON.stringify({ sql: options.sql, params }),
    },
  );
  const data = (await res.json().catch(() => null)) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: Array<{ results?: unknown[] }>;
  } | null;
  if (!res.ok || !data?.success) {
    const detail = data?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new HttpError(502, `remote D1 failed: ${detail}`);
  }
  const first = data.result?.[0];
  return Array.isArray(first?.results) ? (first.results as unknown[]) : [];
}
