// The two-decoder worker plan: embeddings from the stock model only, crack taps decoded by
// either the stock or the tuned decoder. Rules as on main: MIN_FINE_SCORE 0.3,
// MIN_FINE_AREA 20, WALL_FRACTION 0.5 (a wall mask returns null, scored as IoU 0).
import { env, AutoProcessor, SamModel, RawImage } from "@huggingface/transformers";
import { readFileSync } from "node:fs";

// SLIMSAM_FT: folder holding xenova/ (stock ONNX), hf/ (tuned ONNX) and data/raw/
env.localModelPath = process.env.SLIMSAM_FT ?? "../";
env.allowRemoteModels = false;
const MIN_FINE_SCORE = 0.3, MIN_FINE_AREA = 20, WALL_FRACTION = 0.5;
const TAPS = Number(process.env.TAPS ?? 3);
const dtype = process.env.DTYPE ?? "q8";
// ../out/heldout.json: the 92 held-out pairs (ft.py split, seed 7), relative to SLIMSAM_FT
const held = JSON.parse(readFileSync(new URL("../out/heldout.json", import.meta.url), "utf8")).map((p) => p.map((f) => env.localModelPath + f));
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const processor = await AutoProcessor.from_pretrained("xenova");
const stock = await SamModel.from_pretrained("xenova", { dtype });
const tuned = await SamModel.from_pretrained("hf", { dtype });
console.log("tuned sessions:", Object.keys(tuned.sessions));

async function decode(model, raw, emb, point) {
  const inputs = await processor(raw, { input_points: [[point]] });
  const o = await model({ ...emb, input_points: inputs.input_points, input_labels: inputs.input_labels });
  const masks = await processor.post_process_masks(o.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const s = o.iou_scores.data;
  const [, , h, w] = masks[0].dims;
  const areaOf = (c) => { let n = 0; for (const v of masks[0].data.subarray(c * h * w, (c + 1) * h * w)) if (v) n++; return n; };
  let best = 0;
  for (let i = 1; i < s.length; i++) if (s[i] > s[best]) best = i;
  let fine = -1, fineArea = Infinity;
  for (let i = 0; i < s.length; i++) { const a = areaOf(i); if (s[i] >= MIN_FINE_SCORE && a >= MIN_FINE_AREA && a < fineArea) { fine = i; fineArea = a; } }
  if (fine >= 0) best = fine;
  const m = masks[0].data.subarray(best * h * w, (best + 1) * h * w);
  let area = 0;
  for (const v of m) if (v) area++;
  if (!area || area > h * w * WALL_FRACTION) return null;
  return m;
}

const res = { stock: [], hybrid: [] }, nulls = { stock: 0, hybrid: 0 };
const rand = rng(42);
for (const [imgPath, maskPath] of held) {
  const raw = (await RawImage.read(imgPath)).rgb();
  const gtImg = (await RawImage.read(maskPath)).grayscale();
  const gt = gtImg.data.map((v) => (v > 127 ? 1 : 0));
  const on = [];
  for (let i = 0; i < gt.length; i++) if (gt[i]) on.push(i);
  if (!on.length) continue;
  const emb = await stock.get_image_embeddings(await processor(raw));
  for (let t = 0; t < TAPS; t++) {
    const k = on[Math.floor(rand() * on.length)];
    const point = [(k % gtImg.width) + 0.5, Math.floor(k / gtImg.width) + 0.5];
    for (const [name, model] of [["stock", stock], ["hybrid", tuned]]) {
      const m = await decode(model, raw, emb, point);
      if (!m) { nulls[name]++; res[name].push(0); continue; }
      let I = 0, U = 0;
      for (let i = 0; i < gt.length; i++) { const a = m[i] ? 1 : 0; I += a & gt[i]; U += a | gt[i]; }
      res[name].push(U ? I / U : 0);
    }
  }
}
for (const n of ["stock", "hybrid"]) {
  const v = res[n];
  console.log(dtype, n, JSON.stringify({ taps: v.length, miou: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3), nulls: nulls[n] }));
}
