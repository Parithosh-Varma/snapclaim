// Whisper off the main thread, on the device: the voice line never leaves the
// phone, only its text does. Messages in: {type:"transcribe", id, audio}
// (mono Float32Array at 16 kHz). Messages out: {type:"progress", percent}
// while the model downloads, then {type:"transcribed", id, text} or
// {type:"transcribed", id, error}.
const TF_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
// Multilingual tiny model: ~40 MB at 8-bit, ~99 languages, fast enough on a phone CPU for one line.
const MODEL_ID = "Xenova/whisper-tiny";

let transcriber = null;

async function loadModel() {
  if (transcriber) return transcriber;
  const tf = await import(TF_URL);
  // Note: transformers.js may still log "Unable to determine content-length"
  // while fetching model files. That CDN omits Content-Length; progress still
  // works and the transcript is unaffected, so it is harmless.
  try { tf.env.logLevel = "error"; } catch { /* older transformers build */ }
  transcriber = await tf.pipeline("automatic-speech-recognition", MODEL_ID, {
    dtype: "q8",
    progress_callback: (p) => {
      if (p.status === "progress") postMessage({ type: "progress", percent: Math.round(p.progress) });
    },
  });
  return transcriber;
}

self.onmessage = async ({ data }) => {
  if (data.type !== "transcribe") return;
  try {
    const run = await loadModel();
    const out = await run(data.audio, { chunk_length_s: 30 });
    postMessage({ type: "transcribed", id: data.id, text: (out.text ?? "").trim() });
  } catch (e) {
    postMessage({ type: "transcribed", id: data.id, error: e?.message ?? String(e) });
  }
};
