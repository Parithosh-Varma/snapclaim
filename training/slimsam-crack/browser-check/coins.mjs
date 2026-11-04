// Coin regression: tap each team photo's coin, take the top-scoring candidate (the
// worker's coin path, preferSmallest=false), compare stock vs tuned masks.
import { env, AutoProcessor, SamModel, RawImage } from "@huggingface/transformers";
import { fileURLToPath } from "node:url";

// SLIMSAM_FT: folder holding xenova/ (stock ONNX), hf/ (tuned ONNX) and data/raw/
env.localModelPath = process.env.SLIMSAM_FT ?? "../";
env.allowRemoteModels = false;
const DIR = fileURLToPath(new URL("../../../react/public/samples/", import.meta.url));
// coin centers as fractions of width/height, read off gridded contact sheets
const COINS = {
  "0682": [0.53, 0.51], "0683": [0.556, 0.65], "0684": [0.494, 0.5], "0685": [0.49, 0.49],
  "0686": [0.483, 0.5], "0687": [0.652, 0.5], "0688": [0.583, 0.65], "0690": [0.452, 0.866],
  "0691": [0.535, 0.44], "0692": [0.552, 0.54], "0693": [0.556, 0.73], "0694": [0.646, 0.4],
  "0695": [0.785, 0.475], "0697": [0.738, 0.35], "0698": [0.377, 0.22], "0699": [0.494, 0.55],
};

async function masks(id) {
  const processor = await AutoProcessor.from_pretrained(id);
  const model = await SamModel.from_pretrained(id, { dtype: process.env.DTYPE ?? "q8" });
  const out = {};
  for (const [k, [fx, fy]] of Object.entries(COINS)) {
    const raw = (await RawImage.read(`${DIR}dsc_${k}.jpg`)).rgb();
    const emb = await model.get_image_embeddings(await processor(raw));
    const point = [Math.round(fx * raw.width), Math.round(fy * raw.height)];
    const inputs = await processor(raw, { input_points: [[point]] });
    const o = await model({ ...emb, input_points: inputs.input_points, input_labels: inputs.input_labels });
    const m = await processor.post_process_masks(o.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const s = o.iou_scores.data;
    let best = 0;
    for (let i = 1; i < s.length; i++) if (s[i] > s[best]) best = i;
    const [, , h, w] = m[0].dims;
    out[k] = { mask: m[0].data.slice(best * h * w, (best + 1) * h * w), score: s[best], w, h };
  }
  return out;
}

const a = await masks("xenova"), b = await masks("hf");
const rows = [];
for (const k of Object.keys(COINS)) {
  let A = 0, B = 0, I = 0, U = 0;
  for (let i = 0; i < a[k].mask.length; i++) {
    const x = a[k].mask[i] ? 1 : 0, y = b[k].mask[i] ? 1 : 0;
    A += x; B += y; I += x & y; U += x | y;
  }
  const dA = 2 * Math.sqrt(A / Math.PI), dB = 2 * Math.sqrt(B / Math.PI);
  rows.push({ k, stockD: dA.toFixed(1), tunedD: dB.toFixed(1), ratio: (dB / dA).toFixed(3), iou: (I / U).toFixed(3),
              stockScore: a[k].score.toFixed(2), tunedScore: b[k].score.toFixed(2), stockFrac: (A / a[k].mask.length).toFixed(4) });
}
console.table(rows);
