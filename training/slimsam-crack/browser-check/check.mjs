// Stock vs tuned SlimSAM through transformers.js 3.0.2 (the version pwa/sam-worker.js pins),
// wasm-style quantized load, decode copied from the worker. Scored at full resolution.
import { env, AutoProcessor, SamModel, RawImage } from "@huggingface/transformers";
import { readFileSync } from "node:fs";

// SLIMSAM_FT: folder holding xenova/ (stock ONNX), hf/ (tuned ONNX) and data/raw/
env.localModelPath = process.env.SLIMSAM_FT ?? "../";
env.allowRemoteModels = false;
const MIN_FINE_SCORE = 0.5;
const TAPS = Number(process.env.TAPS ?? 3);
// ../out/heldout.json: the 92 held-out pairs (ft.py split, seed 7), relative to SLIMSAM_FT
const held = JSON.parse(readFileSync(new URL("../out/heldout.json", import.meta.url), "utf8")).map((p) => p.map((f) => env.localModelPath + f));

function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

async function run(id) {
  const processor = await AutoProcessor.from_pretrained(id);
  const model = await SamModel.from_pretrained(id, process.env.DTYPE ? { dtype: process.env.DTYPE } : {}); // browser wasm default is q8
  const ious = [];
  const rand = rng(42);
  for (const [imgPath, maskPath] of held) {
    const raw = await RawImage.read(imgPath);
    const gtImg = (await RawImage.read(maskPath)).grayscale();
    const gt = gtImg.data.map((v) => (v > 127 ? 1 : 0));
    const on = [];
    for (let i = 0; i < gt.length; i++) if (gt[i]) on.push(i);
    if (!on.length) continue;
    const emb = await model.get_image_embeddings(await processor(raw.rgb()));
    for (let t = 0; t < TAPS; t++) {
      const k = on[Math.floor(rand() * on.length)];
      const point = [(k % gtImg.width) + 0.5, Math.floor(k / gtImg.width) + 0.5];
      // ---- same as decodePoint(point, preferSmallest=true) in pwa/sam-worker.js ----
      const inputs = await processor(raw.rgb(), { input_points: [[point]] });
      const outputs = await model({ ...emb, input_points: inputs.input_points, input_labels: inputs.input_labels });
      const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
      const scores = outputs.iou_scores.data;
      const [, , h, w] = masks[0].dims;
      const areaOf = (c) => { let n = 0; for (const v of masks[0].data.subarray(c * h * w, (c + 1) * h * w)) if (v) n++; return n; };
      let best = 0;
      for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
      let fine = -1, fineArea = Infinity;
      for (let i = 0; i < scores.length; i++) {
        const a = areaOf(i);
        if (scores[i] >= MIN_FINE_SCORE && a > 0 && a < fineArea) { fine = i; fineArea = a; }
      }
      if (fine >= 0) best = fine;
      const m = masks[0].data.subarray(best * h * w, (best + 1) * h * w);
      // ------------------------------------------------------------------------------
      let inter = 0, uni = 0;
      for (let i = 0; i < gt.length; i++) { const a = m[i] ? 1 : 0; inter += a & gt[i]; uni += a | gt[i]; }
      ious.push(uni ? inter / uni : 0);
    }
  }
  return { taps: ious.length, miou: ious.reduce((a, b) => a + b, 0) / ious.length };
}

for (const id of ["xenova", "hf"]) console.log(process.env.DTYPE ?? "fp32", id === "hf" ? "tuned" : "stock", JSON.stringify(await run(id)));
