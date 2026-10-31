// Voice intake, ported from pwa/app.js. The server transcriber
// (/v1/transcribe → Muse, which auto-detects any language) goes first when
// online; on-device Whisper (public/voice-worker.js) is the fallback for
// offline use or when the backend has no key. Clips are resampled to mono
// 16 kHz WAV on the device.

let voiceWorker: Worker | null = null;
let voiceId = 0;

/** Mono 16 kHz samples → text, on the device. Empty string means nothing heard. */
export function transcribeOnDevice(
  audio: Float32Array,
  onProgress?: (percent: number) => void,
): Promise<string> {
  if (!voiceWorker) {
    voiceWorker = new Worker(new URL("voice-worker.js", window.location.href), { type: "module" });
  }
  const w = voiceWorker;
  const id = voiceId++;
  return new Promise((resolve, reject) => {
    w.onmessage = ({ data }: MessageEvent) => {
      if (data.type === "progress") onProgress?.(data.percent);
      else if (data.type === "transcribed" && data.id === id) {
        if (data.error) reject(new Error(data.error));
        else resolve(String(data.text ?? ""));
      }
    };
    w.onerror = (e) => reject(new Error(e.message ?? "speech worker failed to start"));
    w.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  });
}

export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Decode a recorded clip and resample to mono 16 kHz samples (max 10 s). */
export async function resampleTo16k(clip: Blob): Promise<Float32Array> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await clip.arrayBuffer());
    const dur = Math.min(decoded.duration, 10);
    const off = new OfflineAudioContext(1, Math.ceil(dur * 16000), 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start(0, 0, dur);
    const rendered = await off.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    ctx.close().catch(() => {});
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",").pop() ?? "");
    fr.onerror = () => rej(new Error("read failed"));
    fr.readAsDataURL(blob);
  });
}

/** Whisper writes non-speech as tags like [Music] or (wind blowing); strip them. */
export function cleanTranscript(text: string): string {
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim();
}
