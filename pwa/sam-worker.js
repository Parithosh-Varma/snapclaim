// SlimSAM off the main thread: the model download, the per-photo image
// embedding (~30 s on a laptop CPU) and every tap's decoder run happen here,
// so the page stays responsive. Messages in: {type:"embed", photoId, image}
// and {type:"decode", id, photoId, point, preferSmallest}. Messages out:
// {type:"progress"|"ready"|"error"} and {type:"decoded", id, result}.
const TF_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
const MODEL_ID = "Xenova/slimsam-77-uniform";

// Cracks are thin: SAM's highest-scoring candidate is often the wall the crack runs
// through (71% of the photo on a real facade), so damage takes the smallest candidate
// that still scores MIN_FINE_SCORE. Coins are compact, so they keep the best score.
const MIN_FINE_SCORE = 0.5;

let tf = null, model = null, processor = null, device = null;
let rawImage = null, embeddings = null, currentPhoto = -1;
let forcedCpu = false; // set after a GPU run fails, for the rest of the session

// WebGPU first (full-precision weights, which every adapter can run), else the
// 8-bit CPU build. ?device=wasm or ?device=webgpu on the worker URL forces one.
// Low-memory phones (deviceMemory <= 4 GB, e.g. Samsung A32) OOM under WebGPU
// fp32: the GPU process ballooned to 2.2 GB and LMK killed Chrome (real-phone
// stress, Oct 2026). On those devices default to the smaller WASM build unless
// ?device=webgpu explicitly forces the GPU path.
const forced = new URL(self.location.href).searchParams.get("device");
const deviceMemGB = typeof navigator !== "undefined" ? Number(navigator.deviceMemory) || 0 : 0;
const lowMemDevice = deviceMemGB > 0 && deviceMemGB <= 4;

async function hasWebGpu() {
  try {
    return !!(await navigator.gpu?.requestAdapter());
  } catch {
    return false;
  }
}

async function loadModel() {
  if (model) return;
  tf = await import(TF_URL);
  // ORT prints "Some nodes were not assigned..." warnings per session.
  // Harmless (shape ops pinned to CPU on purpose) but noisy, so drop to errors only.
  try { tf.env.logLevel = "error"; } catch { /* older transformers build */ }
  // Native ORT EP warnings ("Some nodes were not assigned...") bypass logLevel
  // and spam console.error. Harmless (shape ops pinned to CPU on purpose) — try
  // the backend knob too; unknown keys are ignored inside try/catch.
  try { tf.env.backends.onnx.logLevel = "error"; } catch { /* no onnx backend knob */ }
  try { tf.env.backends.onnx.verbose = false; } catch { /* no verbose knob */ }
  const progress_callback = (p) => {
    if (p.status === "progress") postMessage({ type: "progress", percent: Math.round(p.progress) });
  };
  processor ??= await tf.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });
  if (!lowMemDevice && !forcedCpu && forced !== "wasm" && (forced === "webgpu" || (await hasWebGpu()))) {
    try {
      model = await tf.SamModel.from_pretrained(MODEL_ID, { device: "webgpu", dtype: "fp32", progress_callback });
      device = "webgpu";
      return;
    } catch (e) {
      if (forced === "webgpu") throw e;
    }
  }
  model = await tf.SamModel.from_pretrained(MODEL_ID, { progress_callback });
  device = "wasm";
}

/** Drop a GPU model that failed mid-run, so the next load takes the CPU path. */
function fallBackToCpu() {
  if (device !== "webgpu" || forced === "webgpu") return false;
  model = null;
  device = null;
  forcedCpu = true;
  return true;
}

async function embed({ photoId, image }) {
  currentPhoto = photoId;
  embeddings = null;
  try {
    await loadModel();
    const raw = new tf.RawImage(image.data, image.width, image.height, 4).rgb();
    // image embeddings are computed once per photo; point prompts reuse them
    const inputs = await processor(raw);
    const started = performance.now();
    let result;
    try {
      result = await model.get_image_embeddings(inputs);
    } catch (e) {
      if (!fallBackToCpu()) throw e;
      await loadModel();
      result = await model.get_image_embeddings(inputs);
    }
    if (photoId !== currentPhoto) return; // a newer photo arrived meanwhile
    rawImage = raw;
    embeddings = result;
    postMessage({ type: "ready", photoId, device, embedMs: Math.round(performance.now() - started) });
  } catch (e) {
    if (photoId === currentPhoto) postMessage({ type: "error", photoId, message: String(e?.message ?? e) });
  }
}

async function decodePoint(point, preferSmallest) {
  // input_points shape: [image][prompt][point][x,y], in original image pixels
  const inputs = await processor(rawImage, { input_points: [[point]] });
  const outputs = await model({ ...embeddings, input_points: inputs.input_points, input_labels: inputs.input_labels });
  // masks[0] has dims [1, 3, H, W]: three candidate masks at original size
  const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const scores = outputs.iou_scores.data; // 3 scores, one per candidate
  const [, , h, w] = masks[0].dims;
  const areaOf = (k) => {
    let n = 0;
    for (const v of masks[0].data.subarray(k * h * w, (k + 1) * h * w)) if (v) n++;
    return n;
  };
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  if (preferSmallest) {
    let fine = -1, fineArea = Infinity;
    for (let i = 0; i < scores.length; i++) {
      const a = areaOf(i);
      if (scores[i] >= MIN_FINE_SCORE && a > 0 && a < fineArea) { fine = i; fineArea = a; }
    }
    if (fine >= 0) best = fine;
  }
  const m = masks[0].data.subarray(best * h * w, (best + 1) * h * w);
  const out = new Uint8Array(h * w);
  let area = 0;
  for (let i = 0; i < out.length; i++) if (m[i]) { out[i] = 1; area++; }
  return area ? { mask: out, iou: scores[best] } : null;
}

async function decode({ id, photoId, point, preferSmallest }) {
  try {
    if (photoId !== currentPhoto || !embeddings) throw new Error("photo is not ready");
    const result = await decodePoint(point, preferSmallest);
    postMessage({ type: "decoded", id, result }, result ? [result.mask.buffer] : []);
  } catch (e) {
    postMessage({ type: "decoded", id, error: String(e?.message ?? e) });
  }
}

// Decodes share the one model session, so run them one at a time in arrival order.
let queue = Promise.resolve();
onmessage = ({ data }) => {
  if (data.type === "embed") queue = queue.then(() => embed(data));
  else if (data.type === "decode") queue = queue.then(() => decode(data));
};
