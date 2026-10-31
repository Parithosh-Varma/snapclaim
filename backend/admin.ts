import { HttpError, type Env } from "./providers.ts";

/**
 * Admin runtime controls (dev panel support).
 *
 * The deployed mode still comes from `MOCK_MODE` in the environment, but a
 * local operator can flip modes at runtime without restarting the server.
 * The flip is an in-memory override only — it never persists and never leaks
 * keys. Writes require `ADMIN_TOKEN` to be set and the caller to present it
 * as `Authorization: Bearer <token>`. Reads (`GET /v1/admin/status`) are
 * public and key-free, like `/v1/health` + `/v1/spend` combined.
 */

let mockOverride: boolean | null = null;

export function getMockOverride(): boolean | null {
  return mockOverride;
}

/** Effective mode: runtime override wins, otherwise the MOCK_MODE env default. */
export function effectiveMockMode(env: Env): boolean {
  if (mockOverride !== null) return mockOverride;
  return env.MOCK_MODE !== "0";
}

export function mockSource(): "override" | "env" {
  return mockOverride !== null ? "override" : "env";
}

/** Test hook: clear the override between tests so mode tests stay isolated. */
export function resetAdminForTests(): void {
  mockOverride = null;
}

export function isAdminEnabled(env: Env): boolean {
  return (env.ADMIN_TOKEN ?? "").trim() !== "";
}

function bearerToken(headers: Record<string, string | undefined>): string {
  const raw =
    headers["authorization"] ?? headers["Authorization"] ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return (match?.[1] ?? "").trim();
}

/** Throws 403 when writes are disabled or the token is wrong. Never echoes the token. */
export function requireAdmin(
  headers: Record<string, string | undefined>,
  env: Env,
): void {
  const expected = (env.ADMIN_TOKEN ?? "").trim();
  if (expected === "") {
    throw new HttpError(403, "admin writes disabled: set ADMIN_TOKEN on the backend to enable the dev panel mode switch");
  }
  const got = bearerToken(headers);
  if (got === "") {
    throw new HttpError(401, "admin token required: send Authorization: Bearer <ADMIN_TOKEN>");
  }
  if (got !== expected) {
    throw new HttpError(403, "bad admin token");
  }
}

export type AdminModeInput =
  | { reset: true }
  | { mockMode: boolean }
  | { mode: "mock" | "live" };

/** Validates the POST /v1/admin/mode body. Accepts {mockMode}, {mode}, or {reset:true}. */
export function parseAdminModeBody(body: unknown): AdminModeInput {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "body must be a JSON object {mockMode: boolean} | {mode: 'mock'|'live'} | {reset: true}");
  }
  const b = body as Record<string, unknown>;
  if (b["reset"] === true) return { reset: true };
  if (typeof b["mockMode"] === "boolean") return { mockMode: b["mockMode"] };
  if (b["mode"] === "mock") return { mockMode: true };
  if (b["mode"] === "live") return { mockMode: false };
  throw new HttpError(400, "body needs mockMode (boolean), mode ('mock'|'live'), or reset (true)");
}

export function applyAdminMode(input: AdminModeInput): boolean {
  if ("reset" in input) {
    mockOverride = null;
    return true;
  }
  if ("mockMode" in input) {
    mockOverride = input.mockMode;
    return input.mockMode;
  }
  mockOverride = input.mode === "mock";
  return mockOverride;
}
