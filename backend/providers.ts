import { MockFindingsProvider, MockVisionProvider } from "../src/adapters/mock.ts";
import type { FindingsProvider, FindingsRequest, VisionProvider, VisionRequest, VisionResult } from "../src/adapters/types.ts";
import { BudgetExceededError, estimateCostUsd, type SpendGuard } from "../src/config/spend-guard.ts";
import { loadConfig, type AppConfig } from "../src/config/config.ts";
import type { FindingDraft } from "../src/findings/evidence-gate.ts";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export type Env = Record<string, string | undefined>;
export type FetchFn = typeof fetch;

export function configFromEnv(env: Env): AppConfig {
  return loadConfig(env);
}

/** Live routes fail closed: no key, no call. In mock mode nothing reaches a network. */
export function requireLiveKeys(env: Env, config: AppConfig): { metaKey: string; basetenKey?: string } {
  if (config.mockMode) return { metaKey: "" };
  const metaKey = env.META_API_KEY?.trim();
  if (!metaKey) throw new HttpError(503, "META_API_KEY required when MOCK_MODE=0");
  return { metaKey, basetenKey: env.BASETEN_API_KEY?.trim() || undefined };
}

export function visionProvider(env: Env, config: AppConfig, fixture?: VisionResult): VisionProvider {
  if (config.mockMode) {
    if (!fixture) throw new HttpError(400, "mock segment requires body.fixture {component, masks} — backend invents no masks");
    return new MockVisionProvider(fixture);
  }
  requireLiveKeys(env, config);
  return {
    // SAM 3.1 request shape is not yet verified against the live API. Fail loudly, never fake a mask.
    async segment(_request: VisionRequest): Promise<VisionResult> {
      throw new HttpError(501, "live SAM 3.1 segment not wired yet: request shape unverified");
    },
  };
}

export function findingsProvider(
  env: Env,
  config: AppConfig,
  fetchFn: FetchFn = fetch,
  spend?: SpendGuard,
): FindingsProvider {
  if (config.mockMode) return new MockFindingsProvider();
  const { metaKey } = requireLiveKeys(env, config);
  return new MetaFindingsProvider({
    apiKey: metaKey,
    base: config.endpoints.meta,
    model: config.models.spark,
    fetchFn,
    spend,
  });
}

/**
 * Baseten Spark Open pricing, verified live from GET /v1/models on 2026-10-28.
 * Per-token USD: prompt 0.00000125, completion 0.00000425.
 */
export const SPARK_OPEN_PRICE = Object.freeze({ inputUsdPerMTok: 1.25, outputUsdPerMTok: 4.25 });

/** SAM 3.1 image pricing, per dev.meta.ai/models/sam-3-1: $2.50 / 1k images. */
export const SAM_IMAGE_USD = 0.0025;

export function skepticProvider(
  env: Env,
  config: AppConfig,
  fetchFn: FetchFn = fetch,
  spend?: SpendGuard,
): FindingsProvider {
  if (config.mockMode) return new MockFindingsProvider();
  const basetenKey = env.BASETEN_API_KEY?.trim();
  if (!basetenKey) throw new HttpError(503, "BASETEN_API_KEY required when MOCK_MODE=0");
  return new BasetenSkepticProvider({
    apiKey: basetenKey,
    base: config.endpoints.baseten,
    model: config.models.sparkOpen,
    fetchFn,
    spend,
  });
}

interface MetaFindingsOptions {
  apiKey: string;
  base: string;
  model: string;
  fetchFn: FetchFn;
  spend?: SpendGuard;
}

/** Muse Spark via the OpenAI-compatible chat completions endpoint. */
export class MetaFindingsProvider implements FindingsProvider {
  readonly #opts: MetaFindingsOptions;
  constructor(opts: MetaFindingsOptions) {
    this.#opts = opts;
  }

  async draftFindings(request: FindingsRequest): Promise<FindingDraft[]> {
    const spend = this.#opts.spend;
    if (spend && spend.remainingUsd <= 0) {
      throw new HttpError(429, `spend guard: $0 remaining of $${spend.limitUsd} limit`);
    }
    const facts = request.findings.map((f) => ({
      label: f.label,
      percent: f.percent,
      crackLengthMm: f.crackLengthMm,
      areaCm2: f.areaCm2,
      crackWidthMm: f.crackWidthMm,
      severity: f.severity,
      receiptIds: f.receiptIds,
    }));
    const receipts = request.receipts.map((r) => ({ id: r.id, output: r.output, formula: r.formula }));

    const res = await this.#opts.fetchFn(`${this.#opts.base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.#opts.apiKey}` },
      body: JSON.stringify({
        model: this.#opts.model,
        messages: [
          {
            role: "system",
            content:
              "Write claim findings. Every number must exactly match a receipt output. Cite receipt ids. " +
              'Reply with JSON only: [{"statement":"...","citations":["receipt-id"]}]',
          },
          {
            role: "user",
            content: JSON.stringify({ transcript: request.transcript, facts, receipts }),
          },
        ],
      }),
    });
    if (!res.ok) throw new HttpError(502, `Meta findings failed: HTTP ${res.status}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (spend) {
      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;
      try {
        spend.charge(`spark findings in=${inputTokens} out=${outputTokens}`, 0);
      } catch (error) {
        if (error instanceof BudgetExceededError) throw new HttpError(429, error.message);
        throw error;
      }
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new HttpError(502, "Meta findings returned no content");
    return parseFindingDrafts(content);
  }
}

/** Independent skeptic (Spark Open on Baseten). Re-derives numbers from receipts only; flags what it cannot reproduce. */
export class BasetenSkepticProvider implements FindingsProvider {
  readonly #opts: MetaFindingsOptions;
  constructor(opts: MetaFindingsOptions) {
    this.#opts = opts;
  }

  async draftFindings(request: FindingsRequest): Promise<FindingDraft[]> {
    const spend = this.#opts.spend;
    if (spend && spend.remainingUsd <= 0) {
      throw new HttpError(429, `spend guard: $0 remaining of $${spend.limitUsd} limit`);
    }
    const facts = request.findings.map((f) => ({
      label: f.label,
      percent: f.percent,
      crackLengthMm: f.crackLengthMm,
      areaCm2: f.areaCm2,
      crackWidthMm: f.crackWidthMm,
      severity: f.severity,
      receiptIds: f.receiptIds,
    }));
    const receipts = request.receipts.map((r) => ({ id: r.id, output: r.output, formula: r.formula }));

    const res = await this.#opts.fetchFn(`${this.#opts.base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.#opts.apiKey}` },
      body: JSON.stringify({
        model: this.#opts.model,
        // Reasoning model: ~95% of completion tokens are reasoning (measured 2026-10-29).
        // Without a ceiling a spiral is unbounded, so cap it.
        max_tokens: 8192,
        messages: [
          {
            role: "system",
            content:
              "You are an independent skeptic. Re-derive every number from the receipts only — never invent or round from memory. " +
              "For each fact, either restate it exactly with its receipt citations, or mark it DISPUTED with the reason. " +
              'Reply with JSON only: [{"statement":"...","citations":["receipt-id"]}]',
          },
          {
            role: "user",
            content: JSON.stringify({ transcript: request.transcript, facts, receipts }),
          },
        ],
      }),
    });
    if (!res.ok) throw new HttpError(502, `Baseten skeptic failed: HTTP ${res.status}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (spend) {
      const usd = estimateCostUsd(
        { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
        SPARK_OPEN_PRICE,
      );
      try {
        spend.charge(`skeptic ${this.#opts.model}`, usd);
      } catch (error) {
        if (error instanceof BudgetExceededError) throw new HttpError(429, error.message);
        throw error;
      }
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      const reason = data.choices?.[0]?.finish_reason ?? "unknown";
      throw new HttpError(502, `Baseten skeptic returned no content (finish_reason: ${reason})`);
    }
    return parseFindingDrafts(content, "Baseten skeptic");
  }
}

export function parseFindingDrafts(content: string, source = "Meta findings"): FindingDraft[] {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new HttpError(502, `${source} did not return JSON`);
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) throw new HttpError(502, `${source} JSON must be an array`);
  return list.map((item, i) => {
    const draft = item as { statement?: unknown; citations?: unknown };
    if (typeof draft.statement !== "string" || !Array.isArray(draft.citations)) {
      throw new HttpError(502, `${source}[${i}] must be {statement: string, citations: string[]}`);
    }
    return { statement: draft.statement, citations: draft.citations.map(String) };
  });
}
