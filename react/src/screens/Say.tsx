import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { apiPost } from "../lib/api";
import { blobToBase64, cleanTranscript, encodeWav, resampleTo16k, transcribeOnDevice } from "../lib/voice";
import { MicTip, dismissMicTip, shouldShowMicTip } from "./Onboarding";

const MAXLEN = 280;

export default function Say() {
  const ctx = useApp();
  const { session: s, go, base, measuring } = ctx;
  const [micState, setMicState] = useState("Tap Dictate, or just type.");
  const [transcript, setTranscript] = useState(s.transcript);
  const [voiceErr, setVoiceErr] = useState("");
  const [listening, setListening] = useState(false);
  const [sending, setSending] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [locErr, setLocErr] = useState("");
  const [, setLocTick] = useState(0);
  const locFileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const hasText = transcript.trim().length > 0;
  const remaining = MAXLEN - transcript.length;
  const countTone = remaining <= 0 ? "over" : remaining <= 30 ? "warn" : "ok";
  /* Just-in-time mic tooltip: first visit only, dismissible. */
  const [micTipOn, setMicTipOn] = useState(() => {
    try { return shouldShowMicTip(); } catch { return true; }
  });
  const hideMicTip = useCallback(() => {
    setMicTipOn(false);
    try { dismissMicTip(); } catch { /* ignore */ }
  }, []);

  /* Wide context shot: downscaled client-side, stored on the session for the
     report and the saved case. Never measured - placement only. */
  const readLocationPhoto = useCallback(async (file: File) => {
    setLocErr("");
    setLocBusy(true);
    try {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error("photo would not decode"));
          im.src = url;
        });
        const side = Math.max(img.width, img.height) > 1024 ? 1024 / Math.max(img.width, img.height) : 1;
        const cap = document.createElement("canvas");
        cap.width = Math.max(1, Math.round(img.width * side));
        cap.height = Math.max(1, Math.round(img.height * side));
        cap.getContext("2d")?.drawImage(img, 0, 0, cap.width, cap.height);
        s.locationPhoto = cap.toDataURL("image/jpeg", 0.85);
        setLocTick((v) => v + 1);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setLocErr(`Location photo failed (${e instanceof Error ? e.message : String(e)}) - try another.`);
    } finally {
      setLocBusy(false);
    }
  }, [s]);

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
    setMicState("Heard - edit if needed.");
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
      if (landed) setMicState("Didn't catch anything - type the line.");
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
        setMicState("Didn't catch anything - type the line.");
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setVoiceErr(navigator.onLine === false
          ? "On-device speech model not available offline yet - reconnect once to download it, or type the line."
          : `Transcription failed - type the line. (${msg})`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVoiceErr(navigator.onLine === false
        ? "On-device speech model not available offline yet - reconnect once to download it, or type the line."
        : `Transcription failed - type the line. (${msg})`);
    }
  }, [base, landTranscript]);

  const startListening = useCallback(async () => {
    const st = stateRef.current;
    setVoiceErr("");
    if (!st.micReady) {
      if (!navigator.mediaDevices?.getUserMedia) {
        setVoiceErr("No microphone on this device - type the line.");
        return;
      }
      setMicState("Requesting mic…");
      try {
        st.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        st.micReady = true;
      } catch {
        setVoiceErr("Mic blocked - allow access, or type the line.");
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

  /* Auto-grow: the field fits its content, never a scrollbar or a handle. */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [transcript]);

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
    if (sending || !transcript.trim()) return;
    // Overlap: the measurement started on Mark runs while the user speaks or
    // types. Never run /v1/report without a completed payload: if the job is
    // still running, await it first with an honest status. If it already
    // failed, it has returned to Mark (keeping taps and transcript) - there
    // is nothing to report from here.
    const job = s.measureJob;
    if (job && job.state === "running") {
      setSending(true);
      setMicState("Finishing the measurement…");
      try {
        await job.promise;
      } catch {
        /* the job records its own error state; fall through to the checks */
      }
      setSending(false);
      if (s.measureJob?.state !== "done" || !s.payload) return;
    }
    if (!s.payload) return;
    setSending(true);
    s.reportFail = null;
    s.reportStatement = null;
    s.extendedTranscript = null;
    // The manual line stays manual here; Meta vision extends it with the
    // photo on the way to the report. Best-effort: any failure keeps the
    // user's own line and the report still runs.
    let contextLine = transcript;
    // Reused for the multimodal findings call below: the photo travels with
    // the receipts so Muse Spark grounds prose in pixels + numbers. The
    // evidence gate still decides what ships - pixels alone prove nothing.
    let photoDataUrl: string | null = null;
    if (s.photo) {
      setMicState("Extending your line with the photo…");
      try {
        photoDataUrl = s.photo.toDataURL("image/jpeg", 0.8);
        const { res: dres, j: dj } = await apiPost(base, "/v1/describe", {
          imageUrl: photoDataUrl,
          note: transcript,
        });
        const ext = String((dj.result as { description?: unknown } | undefined)?.description ?? "").trim().slice(0, 500);
        if (dres.ok && dj.ok && ext) {
          s.extendedTranscript = ext;
          contextLine = ext;
        }
      } catch {
        /* fall through with the user's line */
      }
    }
    setMicState("Seeing measurements…");
    const body = JSON.parse(JSON.stringify(s.payload)) as Record<string, unknown>;
    body.transcript = contextLine;
    if (photoDataUrl) body.imageUrl = photoDataUrl;
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
      setSending(false);
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
    <section className="screen on sayscreen" aria-labelledby="h-say">
      <div className="wrap wide">
        <div className="saytop">
          <button type="button" className="sayback" aria-label="Back to Mark damage" onClick={() => go("sMark")}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M14.5 5.5 8 12l6.5 6.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="saystep">
            <span id="sayStepLabel">Step 3 of 6</span>
            <div className="sayprog" role="progressbar" aria-labelledby="sayStepLabel" aria-valuenow={3} aria-valuemin={1} aria-valuemax={6}>
              <i style={{ width: "50%" }} />
            </div>
          </div>
          <span className="saytop-spacer" aria-hidden="true" />
        </div>
        <h1 id="h-say">Describe what happened</h1>
        {(measuring || s.measureJob?.state === "running") && (
          <p id="measureBg" role="status" className="saywork">Measuring in the background… describe away, nothing to wait for.</p>
        )}
        {s.measureJob?.state === "done" && s.payload && (
          <p id="measureReady" role="status" className="saychip">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="m8 12.5 2.7 2.7L16 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Measurements captured
          </p>
        )}
        <div className="split">
        <div className="split-main">
        <div className="card saycard">
          <label className="saylabel" htmlFor="transcriptBox">Describe the damage</label>
          <textarea
            id="transcriptBox"
            ref={boxRef}
            rows={2}
            maxLength={MAXLEN}
            placeholder="e.g. Crack on the pavement slab of the terrace…"
            value={transcript}
            aria-describedby="sayCount sayHint"
            onChange={(e) => {
              setTranscript(e.target.value);
              s.transcript = e.target.value;
            }}
          />
          <p id="sayCount" className={`saycount tone-${countTone}`} aria-live="polite">
            {transcript.length} / {MAXLEN}
          </p>
          {listening ? (
            <div className="saylive" role="status">
              <span className="livedot" aria-hidden="true" />
              <span className="livetext">Listening…</span>
              <button type="button" className="saystop" onClick={() => void finishListening(true)}>
                Stop
              </button>
            </div>
          ) : (
            <div className="saydict">
              <button
                id="micBtn"
                type="button"
                className="saymic"
                aria-label="Dictate description"
                onClick={() => void startListening()}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" />
                  <path d="M6 11.5a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M12 17.5V21M8.5 21h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Dictate
              </button>
              <span id="micState" role="status">{micState}</span>
            </div>
          )}
          <p id="sayHint" className="sayhint">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M12 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="8" r="1.2" fill="currentColor" />
            </svg>
            Your description is saved as written. When your report is generated, AI will use it together with your photo to add detail.
          </p>
          {micTipOn && <MicTip onGotIt={hideMicTip} />}
          {voiceErr ? <p id="voiceErr" role="alert">{voiceErr}</p> : null}
        </div>
        </div>
        <div className="split-side">
        <div className="card saycard">
          <p className="saylabel" id="locLabel">
            Location photo <span className="saypill">Optional</span>
          </p>
          <input
            id="locFile"
            ref={locFileRef}
            type="file"
            accept="image/*"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void readLocationPhoto(file);
            }}
          />
          {s.locationPhoto ? (
            <>
              <div className="saythumb">
                <img id="locPhoto" alt="Location context photo" src={s.locationPhoto} />
                <span className="chip">
                  <i aria-hidden="true" />
                  <span>Location · context only, not measured</span>
                </span>
              </div>
              <div className="rowbtns">
                <button id="locRetake" className="btn-quiet" type="button" onClick={() => locFileRef.current?.click()}>Replace</button>
                <button id="locRemove" className="btn-quiet" type="button" onClick={() => { s.locationPhoto = null; setLocTick((v) => v + 1); }}>Remove</button>
              </div>
            </>
          ) : (
            <button
              id="locAddBtn"
              className="saydrop"
              type="button"
              disabled={locBusy}
              aria-busy={locBusy}
              aria-label="Add location photo (optional)"
              aria-describedby="locLabel"
              onClick={() => locFileRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="2" />
                <path d="M8.5 7 10 4.5h4L15.5 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <b>{locBusy ? "Reading photo…" : "Add location photo"}</b>
              <small>Wide shot showing where the damage is</small>
            </button>
          )}
          {locErr ? <p role="alert" className="sayerr">{locErr}</p> : null}
          {locBusy && <div className="skel" role="status" aria-label="Reading location photo" style={{ marginTop: 12 }} />}
        </div>
        <div className="saycta">
          <button
            id="sendBtn"
            className="btn-primary saygo"
            type="button"
            disabled={sending || !hasText}
            aria-busy={sending}
            onClick={runReport}
          >
            {sending ? (<><span className="sayspin" aria-hidden="true" /> Saving…</>) : "Continue"}
          </button>
          <button type="button" className="saybacklink" onClick={() => go("sMark")}>
            Back
          </button>
        </div>
        </div>
        </div>
      </div>
    </section>
  );
}
