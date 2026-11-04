import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { META_API_BASE, META_MODELS } from "../backend/metaApi.ts";
import { PIPELINE_STAGES, pipelineModels } from "../src/adapters/pipeline.ts";
import { DEFAULT_CONFIG } from "../src/config/config.ts";

const root = new URL("../", import.meta.url);
const metaConfig = JSON.parse(readFileSync(new URL("meta.config.json", root), "utf8"));

test("meta.config.json endpoint matches the canonical client", () => {
  assert.equal(metaConfig.meta_api.endpoint, META_API_BASE);
  assert.equal(metaConfig.meta_api.endpoint, "https://api.meta.ai/v1");
  assert.equal(metaConfig.meta_api.endpoint, DEFAULT_CONFIG.endpoints.meta);
});

test("meta.config.json models match code constants", () => {
  assert.equal(metaConfig.meta_api.models.spark, META_MODELS.spark);
  assert.equal(metaConfig.meta_api.models.sam, META_MODELS.sam);
  assert.equal(metaConfig.meta_api.models.voice, META_MODELS.voice);
  assert.equal(metaConfig.meta_api.models.glimmer, META_MODELS.glimmer);
  assert.equal(metaConfig.meta_api.models.sparkOpen, META_MODELS.sparkOpen);
  assert.equal(metaConfig.meta_api.models.spark, DEFAULT_CONFIG.models.spark);
  assert.equal(metaConfig.meta_api.models.sam, DEFAULT_CONFIG.models.sam);
});

test("pipeline registry lists muse-spark, sam-3.1 and muse-voice", () => {
  const models = pipelineModels();
  assert.ok(models.includes("muse-spark-1.3"), "muse-spark integrated");
  assert.ok(models.includes("sam-3.1"), "sam-3.1 integrated");
  assert.ok(models.includes("muse-voice-transcribe-1.0"), "muse-voice integrated");
  assert.ok(PIPELINE_STAGES.some((s) => s.stage === "segment" && s.model === "sam-3.1"));
  assert.ok(PIPELINE_STAGES.some((s) => s.stage === "findings" && s.model.includes("muse-spark")));
  assert.ok(PIPELINE_STAGES.some((s) => s.stage === "describe" && s.model.includes("muse-spark")), "multimodal Spark describe");
  assert.ok(PIPELINE_STAGES.some((s) => s.stage === "voice" && s.model.includes("muse-voice")));
  assert.ok(
    PIPELINE_STAGES.some((s) => s.stage === "findings" && s.transport.includes("multimodal")),
    "findings are multimodal (receipts + optional image_url)",
  );
});

test("verification flags are consistent booleans", () => {
  assert.equal(typeof metaConfig.meta_api_verified, "boolean");
  assert.equal(typeof metaConfig.open_weights_tuning, "boolean");
  assert.equal(metaConfig.open_weights.tuning, metaConfig.open_weights_tuning);
});

test("fine-tuning workflow files exist with both targets configured", () => {
  for (const f of ["finetune/dataset.py", "finetune/train.py", "finetune/config.json", "finetune/requirements.txt", "finetune/README.md"]) {
    assert.ok(readFileSync(new URL(f, root), "utf8").length > 0, `${f} exists`);
  }
  const cfg = JSON.parse(readFileSync(new URL("finetune/config.json", root), "utf8"));
  assert.ok(cfg.targets["muse-glimmer"], "glimmer target configured");
  assert.ok(cfg.targets["muse-spark-open"], "spark-open target configured");
  for (const t of Object.values(cfg.targets) as Array<{ lora: { r: number }; optim: { lr: number; epochs: number } }>) {
    assert.ok(t.lora.r > 0 && t.optim.lr > 0 && t.optim.epochs > 0);
  }
});
