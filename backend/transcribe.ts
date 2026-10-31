import { HttpError, type Env, type FetchFn } from "./providers.ts";
import { configFromEnv } from "./providers.ts";

/**
 * Muse Voice Transcribe over `POST {META_API_BASE}/v1/asr/transcribe`.
 *
 * Multipart upload: a `request` JSON part plus the `audio` WAV part
 * (mono 16-bit PCM at 16 or 24 kHz — the PWA encodes exactly that).
 * Fail-closed like every other live route: no key, no call.
 * Pricing: $0.18/hour of audio, charged to the spend ledger.
 */
export const TRANSCRIBE_MODEL = "muse-voice-transcribe-1.0";
export const TRANSCRIBE_USD_PER_HOUR = 0.18;
/** Cost ceiling held before the upstream call (4MB ≈ 125s ≈ $0.006, rounded up). */
export const TRANSCRIBE_COST_CEILING_USD = 0.01;

export interface TranscribeInput {
  /** Raw WAV bytes. */
  audio: Uint8Array;
  filename?: string;
  languageBias?: string[];
  keywords?: string[];
}

export interface TranscribeResult {
  transcript: string;
  audioDurationMs: number;
  turns: Array<{ turnId: number; startMs: number; endMs: number; transcript: string; speaker?: string }>;
}

export function estimateAudioUsd(audioDurationMs: number): number {
  if (!Number.isFinite(audioDurationMs) || audioDurationMs < 0) return 0;
  return Math.round((audioDurationMs / 3_600_000) * TRANSCRIBE_USD_PER_HOUR * 1_000_000) / 1_000_000;
}

export async function transcribeWithMuse(input: {
  fetchFn?: FetchFn;
  base: string;
  apiKey: string;
  model?: string;
  audio: TranscribeInput;
  charge?: (label: string, usd: number) => void;
}): Promise<TranscribeResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const requestPart = {
    mode: "PUSH_TO_TALK",
    model: input.model ?? TRANSCRIBE_MODEL,
    audioEncoding: "WAV",
    ...(input.audio.languageBias ? { languageBias: input.audio.languageBias } : {}),
    ...(input.audio.keywords ? { keywords: input.audio.keywords } : {}),
  };
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify(requestPart)], { type: "application/json" }));
  const bytes = input.audio.audio;
  form.append(
    "audio",
    new Blob([bytes as unknown as BlobPart], { type: "audio/wav" }),
    sanitizeFilename(input.audio.filename),
  );

  const res = await (fetchFn as typeof fetch)(`${input.base}/asr/transcribe`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new HttpError(502, `Muse transcribe failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    transcript?: unknown;
    audioDurationMs?: unknown;
    turns?: unknown;
  };
  if (typeof data.transcript !== "string") throw new HttpError(502, "Muse transcribe returned no transcript");
  const audioDurationMs = typeof data.audioDurationMs === "number" ? data.audioDurationMs : Math.round((bytes.length / 32000) * 1000);
  const turns = Array.isArray(data.turns)
    ? (data.turns as Array<Record<string, unknown>>).map((turn) => ({
        turnId: typeof turn["turnId"] === "number" ? turn["turnId"] : 0,
        startMs: typeof turn["startMs"] === "number" ? turn["startMs"] : 0,
        endMs: typeof turn["endMs"] === "number" ? turn["endMs"] : 0,
        transcript: typeof turn["transcript"] === "string" ? turn["transcript"] : "",
        ...(typeof turn["speaker"] === "string" ? { speaker: turn["speaker"] as string } : {}),
      }))
    : [];
  input.charge?.(`transcribe ${Math.round(audioDurationMs / 1000)}s`, estimateAudioUsd(audioDurationMs));
  return { transcript: data.transcript, audioDurationMs, turns };
}

/**
 * No default language hints: Muse auto-detects the spoken language. A caller
 * that knows the language can still send `languageBias` explicitly.
 */
export const DEFAULT_LANGUAGE_BIAS: string[] = [];
export const DEFAULT_KEYWORDS = ["crack", "seepage", "deposit", "damp", "leakage", "plaster"];

export const MAX_KEYWORDS = 20;
export const MAX_KEYWORD_CHARS = 64;

function sanitizeList(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) return fallback;
  return values
    .map((v) => String(v).replace(/[\r\n"]/g, "").trim().slice(0, MAX_KEYWORD_CHARS))
    .filter((v) => v !== "")
    .slice(0, MAX_KEYWORDS);
}

/** Basename for the multipart audio part: strip paths, CRLF and quotes. */
export function sanitizeFilename(name: string | undefined): string {
  const base = String(name ?? "audio.wav").split(/[\\/]/).pop() ?? "audio.wav";
  const clean = base.replace(/[\r\n"]/g, "").trim().slice(0, 128);
  return clean !== "" ? clean : "audio.wav";
}

export function isMockEnv(env: Env): boolean {
  return configFromEnv(env).mockMode;
}

export { sanitizeList };
