import { SpendGuard } from "../src/config/spend-guard.ts";
import { loadConfig } from "../src/config/config.ts";
import type { Env } from "./providers.ts";

let current: { limit: number; guard: SpendGuard } | null = null;

export function guardFor(env: Env): SpendGuard {
  const limit = loadConfig(env).spendLimitUsd;
  if (!current || current.limit !== limit) {
    current = { limit, guard: new SpendGuard(limit) };
  }
  return current.guard;
}

export function spendStatus(env: Env): {
  spentUsd: number;
  remainingUsd: number;
  limitUsd: number;
  entries: { label: string; usd: number; at: string }[];
} {
  const guard = guardFor(env);
  return { spentUsd: guard.spentUsd, remainingUsd: guard.remainingUsd, limitUsd: guard.limitUsd, entries: guard.entries };
}

/** Test-only reset so spend tests stay isolated. */
export function resetSpendForTests(): void {
  current = null;
}
