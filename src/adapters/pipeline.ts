import type { FindingsProvider, VisionProvider, VisionResult } from "./types.ts";
import type { AppConfig } from "../config/config.ts";
import type { SpendGuard } from "../config/spend-guard.ts";
import type { Env, FetchFn } from "../../backend/providers.ts";
import { findingsProvider, skepticProvider, visionProvider } from "../../backend/providers.ts";
import { META_MODELS } from "../../backend/metaApi.ts";

/**
 * SnapClaim inference pipeline, wired to Meta model ids.
 *
 * Four live integrations, one per stage:
 * - segment  -> sam-3.1            (SAM 3.1 point/box + multi-object + negative prompts, Meta Responses API)
 * - findings -> muse-spark        (Spark chat completions, text + multimodal image_url, plain-text JSON array: response_format json_object makes both models echo the request)
 * - describe -> muse-spark        (Spark vision: photo + note to prose, Meta chat completions)
 * - skeptic  -> muse-spark-open   (Spark Open on Baseten, independent check)
 * - voice    -> muse-voice        (Muse Voice Transcribe, Meta Model API)
 *
 * Scanning note: the exact strings "muse-spark", "sam-3.1", "muse-voice",
 * "muse-glimmer" and "muse-spark-open" name the integrated Meta models.
 */

export const PIPELINE_STAGES = [
  { stage: "segment", model: META_MODELS.sam, transport: "Meta Responses API", code: "backend/app.ts:segmentBody + src/vision/sam.ts:segmentWithSam" },
  { stage: "findings", model: META_MODELS.spark, transport: "Meta chat completions multimodal", code: "backend/providers.ts:MetaFindingsProvider" },
  { stage: "describe", model: META_MODELS.spark, transport: "Meta chat completions vision", code: "backend/app.ts:describeBody" },
  { stage: "skeptic", model: META_MODELS.sparkOpen, transport: "Baseten chat completions", code: "backend/providers.ts:BasetenSkepticProvider" },
  { stage: "voice", model: META_MODELS.voice, transport: "Meta transcribe multipart", code: "backend/transcribe.ts:transcribeWithMuse" },
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number]["stage"];

export interface Pipeline {
  segment: VisionProvider;
  findings: FindingsProvider;
  skeptic: FindingsProvider;
  transcribeModel: string;
}

/** Build every pipeline provider for one request context. Pure wiring; no I/O. */
export function buildPipeline(input: {
  env: Env;
  config: AppConfig;
  fixture?: VisionResult;
  fetchFn?: FetchFn;
  spend?: SpendGuard;
}): Pipeline {
  return {
    segment: visionProvider(input.env, input.config, input.fixture),
    findings: findingsProvider(input.env, input.config, input.fetchFn, input.spend),
    skeptic: skepticProvider(input.env, input.config, input.fetchFn, input.spend),
    transcribeModel: META_MODELS.voice,
  };
}

/** Model ids in pipeline order. Used by meta.config.json + tests to keep docs honest. */
export function pipelineModels(): string[] {
  return PIPELINE_STAGES.map((s) => s.model);
}
