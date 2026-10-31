import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { apiPost } from "../lib/api";
import { blobToBase64, cleanTranscript, encodeWav, resampleTo16k, transcribeOnDevice } from "../lib/voice";
import { BackButton, Stepper } from "../lib/ui";

const MAXLEN = 280;

export default function Say() {
  const ctx = useApp();
  const { session: s, go, base } = ctx;
  const [micState, setMicState] = useState("Tap Dictate, or just type.");
  const [transcript, setTranscript] = useState(s.transcript);
  const [voiceErr, setVoiceErr] = useState("");
  const [listening, setListening] = useState(false);
  const [sending, setSending] = useState(false);
  const stateRef = useRef({
    micStream: null as MediaStream | null,
    micReady: false,
    recorder: null as MediaRecorder | null,
    recChunks: [] as Blob[],
    timer: null as ReturnType<typeof setTimeout> | null,
  });

  const landTranscript = useCallback((text: string) => {
    s.transcript = text;
    setTranscript(text);
    setMicState("Heard — edit if needed.");
  }, [s]);

  const finishListening = useCallback(async (landed: boolean) => {
    const st = stateRef.current;
    if (st.timer) clearTimeout(st.timer);
    st.timer = null;
    setListening(false);
    const stopTracks = () => {
      try { st.micStream?.getTracks()?.forEach((t) => t.stop()); } catch { /* noop */ }
      st.micStream = null;
      st.micReady = false;
    };
    try {
      if (st.recorder?.state === "recording") st.recorder.stop();
    } catch { /* noop */ }
    await new Promise((r) => setTimeout(r, 300));
    if (!landed) stopTracks();
    const clip = new Blob(st.recChunks, { type: st.recorder?.mimeType || "audio/webm" });
    if (!landed || clip.size === 0) {
      if (landed) setMicState("Didn't catch anything — type the line.");
      return;
    }
    setMicState("Transcribing…");
    try {
      const samples = await resampleTo16k(clip);
      // Server transcriber first when online (Muse auto-detects any
      // language); on-device Whisper is the fallback for offline use or a
      // keyless/erroring backend. Either side returning no words falls
      // through to the other before giving up.
      if (navigator.onLine !== false) {
        try {
          const wav = encodeWav(samples, 16000);
          const b64 = await blobToBase64(wav);
          const { res, j } = await apiPost(base, "/v1/transcribe", { audioBase64: b64 });
          const text = res.ok && j.ok
            ? String((j.result as { transcript?: unknown } | undefined)?.transcript ?? "").trim()
            : "";
          if (text) {
            landTranscript(text);
            return;
          }
          console.info(`[voice] server returned no words (HTTP ${res.status}), trying on-device`);
        } catch (e) {
          console.info(`[voice] server transcribe failed, trying on-device: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      try {
        const local = cleanTranscript(await transcribeOnDevice(samples.slice(), (p) =>
          setMicState(`Downloading speech model… ${p}%`)));
        if (local) {
          landTranscript(local);
          return;
        }
        setMicState("Didn't catch anything — type the line.");
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setVoiceErr(navigator.onLine === false
          ? "On-device speech model not available offline yet — reconnect once to download it, or type the line."
          : `Transcription failed — type the line. (${msg})`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVoiceErr(navigator.onLine === false
        ? "On-device speech model not available offline yet — reconnect once to download it, or type the line."
        : `Transcription failed — type the line. (${msg})`);
    }
  }, [base, landTranscript]);

  const startListening = useCallback(async () => {
    const st = stateRef.current;
    setVoiceErr("");
    if (!st.micReady) {
      if (!navigator.mediaDevices?.getUserMedia) {
        setVoiceErr("No microphone on this device — type the line.");
        return;
      }
      try {
        st.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        st.micReady = true;
      } catch {
        setVoiceErr("Mic blocked — allow access, or type the line.");
        return;
      }
    }
    setListening(true);
    setMicState("Listening… tap Stop when done.");
    try {
      st.recChunks = [];
      st.recorder = new MediaRecorder(st.micStream as MediaStream);
      st.recorder.ondataavailable = (e) => {
        if (e.data.size) st.recChunks.push(e.data);
      };
      st.recorder.start();
    } catch {
      st.recorder = null;
    }
    st.timer = setTimeout(() => void finishListening(true), 8000);
  }, [finishListening]);

  /* stop any recording when leaving the screen */
  useEffect(() => () => {
    const st = stateRef.current;
    if (st.timer) clearTimeout(st.timer);
    try {
      if (st.recorder?.state === "recording") st.recorder.stop();
    } catch { /* noop */ }
    try { st.micStream?.getTracks()?.forEach((t) => t.stop()); } catch { /* noop */ }
    st.micStream = null;
    st.micReady = false;
  }, []);

  const runReport = async () => {
    if (!s.payload || sending) return;
    setSending(true);
    s.reportFail = null;
    s.reportStatement = null;
    const body = JSON.parse(JSON.stringify(s.payload)) as Record<string, unknown>;
    body.transcript = transcript;
    const { res, j } = await apiPost(base, "/v1/report", body).catch(
      (): Awaited<ReturnType<typeof apiPost>> => ({
        res: { ok: false, status: 0 } as Response,
        j: { ok: false, error: "backend unreachable" },
      }),
    );
    s.raw = JSON.stringify(j, null, 2);
    if (res.status === 503 || !res.ok || !j.ok) {
      const fails = res.status === 503 ? [j.error ?? "API key missing"] : (j.details ?? j.failures ?? [j.error]);
      s.reportFail = `${res.status === 503 ? "AI FINDINGS UNAVAILABLE" : "GATED"}\n${JSON.stringify(fails, null, 2)}`;
      go("sNum");
      return;
    }
    const result = j.result as { measurement?: typeof s.measurement; findings?: { statement?: unknown }[] } | undefined;
    setSending(false);
    s.measurement = result?.measurement ?? null;
    const f0 = result?.findings?.[0];
    s.reportStatement = f0 && typeof f0.statement === "string" ? f0.statement : null;
    ctx.setChecks({ skeptic: "idle", xcheck: "idle" });
    go("sNum");
  };

  return (
    <section className="screen on" aria-labelledby="h-say">
      <div className="wrap">
        <BackButton label="Mark" onClick={() => go("sMark")} />
        <Stepper step={3} />
        <h1 id="h-say">Describe what happened.</h1>
        <p className="sub">Type a line, or dictate it with the mic.</p>
        <div className="card saycard">
          <label className="field" htmlFor="transcriptBox">What happened</label>
          <textarea
            id="transcriptBox"
            rows={3}
            maxLength={MAXLEN}
            placeholder="e.g. Crack above the window, noticed after the rain…"
            value={transcript}
            onChange={(e) => {
              setTranscript(e.target.value);
              s.transcript = e.target.value;
            }}
          />
          <div className="sayrow">
            <button
              id="micBtn"
              type="button"
              className={listening ? "micbtn live" : "micbtn"}
              aria-pressed={listening}
              onClick={() => (listening ? void finishListening(true) : void startListening())}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" />
                <path d="M6 11.5a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 17.5V21M8.5 21h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {listening ? "Stop" : "Dictate"}
            </button>
            <span id="micState" role="status">{micState}</span>
            <span className="saycount" aria-hidden="true">{transcript.length} / {MAXLEN}</span>
          </div>
          {voiceErr ? <p id="voiceErr" role="alert">{voiceErr}</p> : null}
        </div>
        <button id="sendBtn" className={`btn-primary${sending ? " busy" : ""}`} type="button" style={{ width: "100%" }} disabled={sending} aria-busy={sending} onClick={runReport}>
          {sending ? "Seeing measurements…" : "See measurements"}
        </button>
      </div>
    </section>
  );
}
