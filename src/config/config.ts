export interface ModelConfig {
  sam: string;
  spark: string;
  sparkOpen: string;
  transcribe: string;
}

export interface EndpointConfig {
  meta: string;
  baseten: string;
}

export interface AppConfig {
  mockMode: boolean;
  spendLimitUsd: number;
  endpoints: EndpointConfig;
  models: ModelConfig;
  minReferenceConfidence: number;
}

export const DEFAULT_CONFIG: AppConfig = Object.freeze({
  mockMode: true,
  spendLimitUsd: 5,
  endpoints: Object.freeze({
    meta: "https://api.meta.ai/v1",
    baseten: "https://inference.baseten.co/v1",
  }),
  models: Object.freeze({
    sam: "sam-3.1",
    spark: "muse-spark-1.3",
    sparkOpen: "meta-models/muse-spark-open-1026",
    transcribe: "muse-voice-transcribe-1.0",
  }),
  minReferenceConfidence: 0.6,
});

function parseNonNegative(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  }
  return value;
}

/**
 * Mock mode is the default: live calls require MOCK_MODE=0 explicitly.
 * The Worker passes its environment bindings here; tests pass a plain object.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const minReferenceConfidence = parseNonNegative(
    env.MIN_REFERENCE_CONFIDENCE,
    DEFAULT_CONFIG.minReferenceConfidence,
    "MIN_REFERENCE_CONFIDENCE",
  );
  if (minReferenceConfidence > 1) {
    throw new Error("MIN_REFERENCE_CONFIDENCE must be between 0 and 1");
  }

  return {
    mockMode: env.MOCK_MODE !== "0",
    spendLimitUsd: parseNonNegative(env.SPEND_GUARD_USD, DEFAULT_CONFIG.spendLimitUsd, "SPEND_GUARD_USD"),
    endpoints: {
      meta: env.META_API_BASE ?? DEFAULT_CONFIG.endpoints.meta,
      baseten: env.BASETEN_API_BASE ?? DEFAULT_CONFIG.endpoints.baseten,
    },
    models: { ...DEFAULT_CONFIG.models },
    minReferenceConfidence,
  };
}
