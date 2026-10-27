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
    return round6(this.limitUsd - this.spentUsd);
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
