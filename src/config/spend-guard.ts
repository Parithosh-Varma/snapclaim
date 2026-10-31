export interface SpendEntry {
  label: string;
  usd: number;
  at: string;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Hard cap on live API spend. Every live call records its estimated cost here. */
export class SpendGuard {
  readonly limitUsd: number;
  #entries: SpendEntry[] = [];
  // Funds held by in-flight live calls. A hold is taken BEFORE the upstream
  // request fires and settled after, so two concurrent requests cannot both
  // pass the check and bill the operator twice (check-then-act TOCTOU).
  #reservedUsd = 0;

  constructor(limitUsd: number) {
    if (!Number.isFinite(limitUsd) || limitUsd < 0) {
      throw new Error("limitUsd must be a non-negative number");
    }
    this.limitUsd = limitUsd;
  }

  get spentUsd(): number {
    return round6(this.#entries.reduce((total, entry) => total + entry.usd, 0));
  }

  get remainingUsd(): number {
    return round6(this.limitUsd - this.spentUsd - this.#reservedUsd);
  }

  /** Funds currently held by in-flight calls (not yet billed). */
  get reservedUsd(): number {
    return round6(this.#reservedUsd);
  }

  get entries(): SpendEntry[] {
    return [...this.#entries];
  }

  charge(label: string, usd: number, at = new Date().toISOString()): SpendEntry {
    if (!Number.isFinite(usd) || usd < 0) {
      throw new Error("usd must be a non-negative number");
    }
    const next = round6(this.spentUsd + usd);
    if (next > this.limitUsd) {
      throw new BudgetExceededError(`spend guard: $${next} would exceed the $${this.limitUsd} limit`);
    }
    const entry: SpendEntry = { label, usd: round6(usd), at };
    this.#entries.push(entry);
    return entry;
  }

  /**
   * Hold an estimated cost BEFORE firing an upstream request. Throws
   * BudgetExceededError when spent + held + estimate would cross the limit,
   * so concurrent callers serialize on the same budget instead of each
   * passing a stale check and billing after the fact.
   */
  reserve(label: string, estimateUsd: number): SpendHold {
    if (!Number.isFinite(estimateUsd) || estimateUsd < 0) {
      throw new Error("estimateUsd must be a non-negative number");
    }
    const estimate = round6(estimateUsd);
    if (round6(this.spentUsd + this.#reservedUsd + estimate) > this.limitUsd) {
      throw new BudgetExceededError(
        `spend guard: $${round6(this.spentUsd + estimate)} would exceed the $${this.limitUsd} limit (${label})`,
      );
    }
    this.#reservedUsd = round6(this.#reservedUsd + estimate);
    let done = false;
    return {
      release: () => {
        if (done) return;
        done = true;
        this.#reservedUsd = round6(this.#reservedUsd - estimate);
      },
      settle: (actualLabel: string, actualUsd: number) => {
        if (done) throw new Error("spend hold already settled");
        done = true;
        this.#reservedUsd = round6(this.#reservedUsd - estimate);
        // The hold guaranteed headroom for `estimate`; an actual above it
        // re-checks rather than silently overspending.
        if (round6(actualUsd) > estimate) {
          this.charge(actualLabel, actualUsd);
        } else {
          const entry: SpendEntry = { label: actualLabel, usd: round6(actualUsd), at: new Date().toISOString() };
          this.#entries.push(entry);
        }
      },
    };
  }
}

/** A pre-billing hold on part of the spend budget. See SpendGuard.reserve. */
export interface SpendHold {
  /** Drop the hold without billing (upstream call failed before spending). */
  release(): void;
  /** Drop the hold and bill the actual cost. */
  settle(label: string, usd: number): void;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TokenPrice {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export function estimateCostUsd(usage: TokenUsage, price: TokenPrice): number {
  for (const [name, value] of Object.entries({ ...usage, ...price })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative number`);
    }
  }
  const input = (usage.inputTokens / 1_000_000) * price.inputUsdPerMTok;
  const output = (usage.outputTokens / 1_000_000) * price.outputUsdPerMTok;
  return round6(input + output);
}
