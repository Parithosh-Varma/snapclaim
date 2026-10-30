import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { apiPost } from "../lib/api";
import { blobToBase64, cleanTranscript, encodeWav, resampleTo16k, transcribeOnDevice } from "../lib/voice";
import { BackButton, Stepper } from "../lib/ui";

const NBARS = 28;

export default function Say() {
  const ctx = useApp();
  const { session: s, go, base } = ctx;
  const [micState, setMicState] = useState("Listening");
  const [heard, setHeard] = useState("");
  const [transcript, setTranscript] = useState(s.transcript);
  const [voiceErr, setVoiceErr] = useState("");
  const [listening, setListening] = useState(false);
  const barsRef = useRef<(HTMLElement | null)[]>([]);
  const stateRef = useRef({
    micStream: null as MediaStream | null,
    micReady: false,
    analyser: null as AnalyserNode | null,
    analyserData: null as Uint8Array | null,
    recorder: null as MediaRecorder | null,
    recChunks: [] as Blob[],
    timer: null as ReturnType<typeof setTimeout> | null,
  });

  const landTranscript = useCallback((text: string) => {
    s.transcript = text;
    setTranscript(text);
    setHeard(`“${text}”`);
    setMicState("Heard");
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
      st.analyser = null;
      st.analyserData = null;
    };
    try {
      if (st.recorder?.state === "recording") st.recorder.stop();
    } catch { /* noop */ }
    await new Promise((r) => setTimeout(r, 300));
    if (!landed) stopTracks();
    const clip = new Blob(st.recChunks, { type: st.recorder?.mimeType || "audio/webm" });
    if (!landed || clip.size === 0) {
      if (landed) setHeard("Didn't catch anything — type the line.");
      return;
    }
    setMicState("Transcribing…");
    try {
      const samples = await resampleTo16k(clip);
      // On the device first (Whisper in voice-worker.js): the voice never
      // leaves the phone. The server transcriber is the fallback.
      try {
        const local = cleanTranscript(await transcribeOnDevice(samples.slice(), (p) =>
          setMicState(`Downloading speech model… ${p}%`)));
        if (local) {
          landTranscript(local);
          return;
        }
        setHeard("Didn't catch anything — type the line.");
        return;
      } catch (e) {
        console.info(`[voice] on-device failed, trying the server: ${e instanceof Error ? e.message : String(e)}`);
      }
      setMicState("Transcribing…");
      const wav = encodeWav(samples, 16000);
      const b64 = await blobToBase64(wav);
      const { res, j } = await apiPost(base, "/v1/transcribe", { audioBase64: b64 });
      if (res.status === 503) {
        setVoiceErr("Voice needs the backend API key — type the line.");
        return;
      }
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const text = String((j.result as { transcript?: unknown } | undefined)?.transcript ?? "").trim();
      if (!text) {
        setHeard("Didn't catch anything — type the line.");
        return;
      }
      landTranscript(text);
    } catch (e) {
      setVoiceErr(`Transcription failed — type the line. (${e instanceof Error ? e.message : String(e)})`);
    }
  }, [base, landTranscript]);

  const startListening = useCallback(async () => {
    const st = stateRef.current;
    setHeard("Asking for the mic…");
    if (!st.micReady) {
      if (!navigator.mediaDevices?.getUserMedia) {
        setHeard("No microphone on this device.");
        return;
      }
      try {
        st.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        st.micReady = true;
        try {
          const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const actx = new Ctx();
          const src = actx.createMediaStreamSource(st.micStream);
          st.analyser = actx.createAnalyser();
          st.analyser.fftSize = 64;
          st.analyserData = new Uint8Array(st.analyser.frequencyBinCount);
          src.connect(st.analyser);
        } catch { /* levels stay simulated */ }
      } catch {
        setHeard("Mic blocked — allow access or type below.");
        return;
      }
    }
    setListening(true);
    setMicState("Listening");
    setHeard("");
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

  /* auto-listen on arrival, as in the vanilla flow */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!s.autoListen) return;
    s.autoListen = false;
    void startListening();
    return () => {
      const st = stateRef.current;
      if (st.timer) clearTimeout(st.timer);
      try {
        if (st.recorder?.state === "recording") st.recorder.stop();
      } catch { /* noop */ }
      try { st.micStream?.getTracks()?.forEach((t) => t.stop()); } catch { /* noop */ }
      st.micStream = null;
      st.micReady = false;
    };
  }, [startListening]);

  /* waveform: real analyser levels when available, simulated otherwise */
  useEffect(() => {
    const id = setInterval(() => {
      const st = stateRef.current;
      for (let i = 0; i < NBARS; i++) {
        const bar = barsRef.current[i];
        if (!bar) continue;
        let v: number;
        if (st.analyser && st.analyserData) {
          st.analyser.getByteFrequencyData(st.analyserData as Uint8Array<ArrayBuffer>);
          v = (st.analyserData[Math.floor((i / NBARS) * st.analyserData.length)] ?? 0) / 255;
        } else {
          const t = Date.now() / 180;
          v = listening ? 0.35 + 0.3 * Math.sin(t + i * 0.7) + 0.25 * Math.sin(t * 0.37 + i * 1.7) : 0.12;
        }
        bar.style.height = `${Math.max(6, Math.round(Math.abs(v) * 52))}px`;
      }
    }, 90);
    return () => clearInterval(id);
  }, [listening]);

  const runReport = async () => {
    if (!s.payload) return;
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
    s.measurement = result?.measurement ?? null;
    const f0 = result?.findings?.[0];
    s.reportStatement = f0 && typeof f0.statement === "string" ? f0.statement : null;
    ctx.setChecks({ skeptic: "idle", xcheck: "idle" });
    go("sNum");
  };

  return (
    <section className="screen on" aria-labelledby="h-say">
      <div className="wrap" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div style={{ alignSelf: "stretch" }}>
          <BackButton label="Mark" onClick={() => go("sMark")} />
        </div>
        <div style={{ alignSelf: "stretch" }}>
          <Stepper step={3} />
        </div>
        <h1 id="h-say">Say what happened.</h1>
        <p className="sub">It listens on its own. Tap the mic to finish early.</p>
        <div className="voicemock">
          <div className={`micwrap${listening ? " live" : ""}`} id="micwrap">
            <span className="pring p1" />
            <span className="pring p2" />
            <button
              id="micBtn"
              type="button"
              aria-label={listening ? "Stop listening" : "Start listening"}
              onClick={() => (listening ? void finishListening(true) : void startListening())}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="9" y="2.5" width="6" height="11" rx="3" fill="#fff" />
                <path d="M6 11.5a6 6 0 0 0 12 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 17.5V21M8.5 21h7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p id="micState">{micState}</p>
          <div className="wave" id="wave" aria-hidden="true">
            {Array.from({ length: NBARS }, (_, i) => (
              <i key={i} ref={(el) => { barsRef.current[i] = el; }} />
            ))}
          </div>
          <p id="heard">{heard}</p>
          <input
            id="transcriptBox"
            type="text"
            placeholder="Or type the line…"
            value={transcript}
            onChange={(e) => {
              setTranscript(e.target.value);
              s.transcript = e.target.value;
            }}
          />
          <p id="voiceErr">{voiceErr}</p>
        </div>
        <button id="sendBtn" className="btn-dark" type="button" style={{ width: "100%" }} onClick={runReport}>
          Send to report
        </button>
      </div>
    </section>
  );
}
