import { checkPhoto } from "./photo-check.js";
import { closeMask, unionMasks } from "./mask-ops.js";
import { decodeRle } from "./rle.js";
import { mountTiltMeter } from "./tilt-meter.js";
import { createCaseStore } from "./store.js";

const $ = (id) => document.getElementById(id);
mountTiltMeter($("tiltMeter")); // live level over the camera; hidden without orientation sensors
let payloadObj = null;
let lastMeasurement = null;
/** Backend URL allowlist, mirrored by the <meta> CSP connect-src in index.html.
 * Only the default Worker host (https) and loopback http for local dev are
 * allowed. Anything else is rejected so a pasted "debug URL" cannot exfiltrate
 * photos/voice to an attacker — and so validation never passes a URL the CSP
 * would then block. To self-host: add the host to connect-src in
 * pwa/index.html (and react/index.html) AND to DEFAULT_BACKEND_HOST below.
 * See README "Self-hosted backend". */
export const DEFAULT_BACKEND_HOST = "snapclaim-backend.parithosh.workers.dev";
export const POLICY_BACKEND_MESSAGE =
  "This backend isn't allowed by the app's security policy — use https://" +
  DEFAULT_BACKEND_HOST +
  " or http://localhost:8787 for local dev.";
export function isAllowedBackendUrl(raw) {
  if (typeof raw !== "string") return false;
  const v = raw.trim().replace(/\/$/, "");
  if (v === "") return false;
  let url;
  try {
    url = new URL(v);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") {
    return url.hostname.toLowerCase() === DEFAULT_BACKEND_HOST;
  }
  if (url.protocol === "http:") {
    const h = url.hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
  }
  return false;
}
/* Single source of truth for the backend URL: one variable persisted to
 * localStorage, read by base(). The Settings tab holds the ONE editable
 * input (#baseUrl2); the Report developer panel only shows the value and its
 * own Check button. (Two inputs kept in sync by JS used to drift, and base()
 * used to read the hidden one.) */
const BACKEND_KEY = "snapclaim.backendUrl";
const DEFAULT_BACKEND_URL = `https://${DEFAULT_BACKEND_HOST}`;
let backendUrl = (() => {
  try {
    const saved = localStorage.getItem(BACKEND_KEY);
    if (saved && isAllowedBackendUrl(saved)) return saved.trim().replace(/\/$/, "");
  } catch { /* storage may be unavailable */ }
  return DEFAULT_BACKEND_URL;
})();
function setBackendUrl(raw) {
  const v = String(raw ?? "").trim().replace(/\/$/, "");
  if (!isAllowedBackendUrl(v)) throw new Error(POLICY_BACKEND_MESSAGE);
  backendUrl = v;
  try { localStorage.setItem(BACKEND_KEY, v); } catch { /* ignore */ }
  syncBackendInputs();
  return v;
}
function syncBackendInputs() {
  const settings = $("baseUrl2");
  if (settings && settings.value !== backendUrl) settings.value = backendUrl;
  const show = $("baseUrlShow");
  if (show) show.textContent = backendUrl;
}
function base() {
  if (!isAllowedBackendUrl(backendUrl)) throw new Error(POLICY_BACKEND_MESSAGE);
  return backendUrl;
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
/* Offline honesty: the service worker never caches cross-origin responses, so
 * the jsDelivr/Hugging Face bytes behind sam-worker.js and voice-worker.js
 * need one online load. Name that state instead of a raw import error. */
function isOfflineNow() { return typeof navigator !== "undefined" && navigator.onLine === false; }
function offlineModelMessage(kind) {
  return `On-device ${kind} model not available offline yet — reconnect once to download it, then it works offline.`;
}
/** Severity comes from the backend: allowlist it so it can never break out of
 * the class attribute in metricCards (esc alone was not enough for attrs). */
function escSeverity(s) {
  const v = String(s);
  return v === "significant" || v === "moderate" || v === "cosmetic" ? v : "cosmetic";
}

/* ---------- navigation ---------- */
const SCREENS = ["sCam", "sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"];
const TAB_SCREENS = ["tHome", "tCases", "tSettings"];
function show(id) {
  if (id !== "sSay") { try { stopMicTracks(); } catch { /* mic not started */ } }
  for (const s of ["sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"]) {
    document.getElementById(s)?.classList.toggle("on", s === id);
  }
  for (const t of TAB_SCREENS) document.getElementById(t)?.classList.remove("on");
  document.body.classList.remove("tabbing");
  document.body.classList.toggle("reviewing", id === "sReview");
  document.body.classList.toggle("step2", id === "sSay");
  if (id === "sReview") { try { $("donateCheck").checked = !!localStorage.getItem("snapclaim.donatePhoto"); } catch { /* ignore */ } }
}
function backToCam() {
  try { stopMicTracks(); } catch { /* noop */ }
  for (const s of ["sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"]) document.getElementById(s)?.classList.remove("on");
  for (const t of TAB_SCREENS) document.getElementById(t)?.classList.remove("on");
  document.body.classList.remove("reviewing", "step2", "tabbing");
}

/* ---------- backend ---------- */
$("healthBtn").onclick = async () => {
  let b;
  try {
    b = base();
  } catch (e) {
    $("healthOut").textContent = e instanceof Error ? e.message : String(e);
    return;
  }
  try {
    const r = await fetch(b + "/v1/health");
    const j = await r.json();
    $("healthOut").textContent = `ok v${j.version} mode:${j.mode}`;
  } catch {
    $("healthOut").textContent = "unreachable";
  }
};

/* ---------- camera + coin gate ---------- */
const feed = $("feed");
const ring = $("coinRing");
const hint = $("coinHint");
const fab = $("shutter");
const SW = 224; // detection width: cheaper beats sticking to 256
const work = document.createElement("canvas");
const wctx = work.getContext("2d", { willReadFrequently: true });
const full = document.createElement("canvas");
const fctx = full.getContext("2d", { willReadFrequently: true });
const history = [];
let coinSeen = false, smooth = null, camStream = null, noScaleMode = false;
let assistPt = null, assistAt = 0, scanCount = 0, lastDetAt = 0;
let captureTimer = null, countdownTimer = null;
const countEl = $("count");
const clf = new CoinModel.Classifier();
let coinLabel = "";
let gateCoin = null; // {cx, cy, rr} in capture-still pixels + still size
let photo = null;    // downscaled capture canvas for marking
let stillDataUrl = "";

function setLocked(locked, label) {
  fab.classList.toggle("locked", locked);
  if (label) hint.textContent = label;
  ring.style.display = locked ? "none" : "block";
}
function armCapture() {
  cancelCapture();
  let n = 3;
  hint.textContent = "Hold steady…";
  countEl.textContent = "3";
  countEl.style.display = "block";
  countdownTimer = setInterval(() => {
    n--;
    if (n > 0) { countEl.textContent = String(n); countEl.classList.remove("pop"); void countEl.offsetWidth; countEl.classList.add("pop"); }
  }, 1000);
  captureTimer = setTimeout(() => { cancelCapture(); if (coinSeen && !document.querySelector(".screen.on")) fab.click(); }, 3000);
}
function cancelCapture() {
  if (captureTimer) { clearTimeout(captureTimer); captureTimer = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  countEl.style.display = "none";
}
function stopCamera() {
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
  feed.srcObject = null;
}
function acquireCamera() {
  stopCamera(); // retakes must never stack a second detector loop
  if (!navigator.mediaDevices?.getUserMedia) { explainCam({ name: "unsupported" }); return; }
  const backCam = { video: { facingMode: { exact: "environment" } }, audio: false };
  const anyCam = { video: { facingMode: "environment" }, audio: false };
  navigator.mediaDevices.getUserMedia(backCam)
    .catch(() => navigator.mediaDevices.getUserMedia(anyCam))
    .then((stream) => {
      camStream = stream;
      stream.oninactive = () => {
        coinSeen = false; smooth = null; history.length = 0; cancelCapture();
        setLocked(true, "Add a coin for scale");
        explainCam({ name: "stopped" });
      };
      feed.srcObject = stream;
      return feed.play().then(() => {
        $("enableCam").style.display = "none";
        scan();
      });
    })
    .catch(explainCam);
}
function explainCam(err) {
  const name = (err && err.name) || "unknown";
  const btn = $("enableCam");
  if (btn) btn.style.display = "block";
  if (name === "NotAllowedError" || name === "SecurityError") {
    hint.textContent = "Camera permission is off — tap Enable camera";
  } else if (name === "NotFoundError" || name === "OverconstrainedError") {
    hint.textContent = "No back camera found — tap Enable camera to retry";
  } else if (name === "NotReadableError") {
    hint.textContent = "Camera busy in another app — close it, then tap Enable camera";
  } else if (name === "stopped") {
    hint.textContent = "Camera stopped — tap Enable camera";
  } else {
    hint.textContent = `Camera unavailable (${name}) — tap Enable camera`;
  }
  setLocked(false);
}
$("enableCam").addEventListener("click", () => {
  $("enableCam").style.display = "none";
  acquireCamera();
});
function placeRing(det, fw, fh) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.max(vw / fw, vh / fh);
  const dw = fw * scale, dh = fh * scale;
  const ox = (vw - dw) / 2, oy = (vh - dh) / 2;
  const cx = ox + (det.cx / fw) * dw, cy = oy + (det.cy / fh) * dh;
  const r = Math.min(Math.max((det.rr / fw) * dw, 28), Math.min(vw, vh) * 0.4);
  ring.style.left = cx - r + "px"; ring.style.top = cy - r + "px";
  ring.style.width = r * 2 + "px"; ring.style.height = r * 2 + "px";
}
/** Select a known diameter, adding a one-off option when the coin is outside the preset list. */
function setCoinSize(mm, label) {
  const sel = $("coinKind");
  if (!sel) return;
  if (!(mm > 0)) { sel.value = "0"; return; }
  let opt = [...sel.options].find((o) => Number(o.value) === mm);
  if (!opt) {
    opt = new Option(label ? `${label} · ${mm} mm` : `${mm} mm reference`, String(mm));
    sel.add(opt);
  }
  sel.value = String(mm);
}
function identifyCoin(det, fw, fh) {
  try {
    const vw = feed.videoWidth, vh = feed.videoHeight;
    if (!vw) return;
    const k = Math.min(1, 640 / Math.max(vw, vh));
    full.width = Math.round(vw * k); full.height = Math.round(vh * k);
    fctx.drawImage(feed, 0, 0, full.width, full.height);
    const img = fctx.getImageData(0, 0, full.width, full.height);
    const kx = (full.width / fw) * det.cx, ky = (full.height / fh) * det.cy, kr = (full.width / fw) * det.rr;
    const fv = CoinModel.extractFeatures(img.data, full.width, full.height, { x: kx, y: ky, r: kr });
    const best = clf.predict(fv)[0];
    if (best && best.label !== "unknown") {
      const def = CoinModel.DB.find((d) => d.id === best.label);
      coinLabel = def ? `${def.label} · Ø${def.diam} mm` : best.label;
      if (def) setCoinSize(def.diam, def.label);
      hint.textContent = `${coinLabel} (${Math.round(best.confidence * 100)}%) — hold steady…`;
    } else { coinLabel = ""; hint.textContent = "Coin found — hold steady…"; }
  } catch { /* ID is advisory; the gate stands on geometry */ }
}
function scan() {
  if (!camStream) return; // camera left: never spin the detector in the background
  if (document.hidden) { setTimeout(scan, 1000); return; } // background tab: idle, no edge-detect
  if (!feed.videoWidth) { setTimeout(scan, 500); return; }
  try {
    scanFrame();
  } catch {
    /* one bad frame must never kill the loop */
  }
  setTimeout(scan, 200);
}

function grayEdges(img, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    g[i] = 0.299 * img[o] + 0.587 * img[o + 1] + 0.114 * img[o + 2];
  }
  const edge = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      if (gx * gx + gy * gy > 9000) edge[i] = 1;
    }
  }
  return edge;
}

/** Biggest ring-like edge blob: centroid + radial uniformity score. */
function findRing(edge, w, h) {
  const seen = new Uint8Array(w * h);
  let best = null;
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!edge[s] || seen[s]) continue;
    let sx = 0, sy = 0, n = 0;
    const pts = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length && pts.length < 4000) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      pts.push(i); sx += x; sy += y; n++;
      if (x > 0 && !seen[i - 1] && edge[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !seen[i + 1] && edge[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !seen[i - w] && edge[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !seen[i + w] && edge[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    if (n < 25 || n > 4000) continue;
    const cx = sx / n, cy = sy / n;
    let rr = 0;
    for (const i of pts) {
      const dx = (i % w) - cx, dy = ((i / w) | 0) - cy;
      rr += Math.sqrt(dx * dx + dy * dy);
    }
    rr /= n;
    if (rr < w * 0.02 || rr > w * 0.35) continue;
    let inband = 0;
    const tol = Math.max(1.5, rr * 0.18);
    for (const i of pts) {
      const dx = (i % w) - cx, dy = ((i / w) | 0) - cy;
      if (Math.abs(Math.sqrt(dx * dx + dy * dy) - rr) <= tol) inband++;
    }
    const score = inband / n;
    if (score > 0.6 && (!best || score > best.score)) best = { cx, cy, rr, score };
  }
  return best;
}

/**
 * Strongest circular rim around a tap, by radial luminance gradient averaged
 * over angles. A tap says "the coin is here", so a coin with a soft rim (e.g.
 * behind a plastic bag) still locks even when its edge blob is too broken for
 * findRing. Returns {rr, score} in frame pixels, or null.
 */
function findRimAt(imgData, w, h, cx, cy) {
  let best = null;
  const rMax = Math.min(36, Math.round(Math.min(w, h) * 0.28));
  for (let r = 6; r <= rMax; r++) {
    let sum = 0, n = 0;
    for (let a = 0; a < 360; a += 5) {
      const t = (a * Math.PI) / 180;
      const x1 = Math.round(cx + Math.cos(t) * (r - 1.5)), y1 = Math.round(cy + Math.sin(t) * (r - 1.5));
      const x2 = Math.round(cx + Math.cos(t) * (r + 1.5)), y2 = Math.round(cy + Math.sin(t) * (r + 1.5));
      if (x1 < 1 || y1 < 1 || x2 < 1 || y2 < 1 || x1 >= w - 1 || y1 >= h - 1 || x2 >= w - 1 || y2 >= h - 1) continue;
      const i1 = (y1 * w + x1) * 4, i2 = (y2 * w + x2) * 4;
      const g1 = 0.299 * imgData[i1] + 0.587 * imgData[i1 + 1] + 0.114 * imgData[i1 + 2];
      const g2 = 0.299 * imgData[i2] + 0.587 * imgData[i2 + 1] + 0.114 * imgData[i2 + 2];
      sum += Math.abs(g2 - g1); n++;
    }
    if (n < 36) continue;
    const score = sum / n;
    if (!best || score > best.score) best = { rr: r, score };
  }
  return best;
}

function scanFrame() {
  const fw = SW, fh = Math.round((SW * feed.videoHeight) / feed.videoWidth);
  work.width = fw; work.height = fh;
  wctx.drawImage(feed, 0, 0, fw, fh);
  const img = wctx.getImageData(0, 0, fw, fh);
  // Tap-to-assist narrows the search window; without it, whole frame.
  const edge = grayEdges(img.data, fw, fh);
  let found = null;
  if (assistPt) {
    // The tap is the user's answer to "where is the coin": measure the rim
    // around it first. A soft or partly hidden rim still scores here, where
    // findRing's connected-blob score fails.
    const ax = Math.round(assistPt.x), ay = Math.round(assistPt.y);
    const rim = findRimAt(img.data, fw, fh, ax, ay);
    if (rim && rim.score >= 22) {
      found = { cx: ax, cy: ay, rr: rim.rr, score: Math.min(1, rim.score / 60) };
    } else {
      const r = Math.round(fw * 0.25);
      const x0 = Math.max(0, Math.round(assistPt.x - r)), x1 = Math.min(fw, Math.round(assistPt.x + r));
      const y0 = Math.max(0, Math.round(assistPt.y - r)), y1 = Math.min(fh, Math.round(assistPt.y + r));
      const sub = new Uint8Array((x1 - x0) * (y1 - y0));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sub[(y - y0) * (x1 - x0) + (x - x0)] = edge[y * fw + x];
      const sub0 = findRing(sub, x1 - x0, y1 - y0);
      if (sub0) found = { cx: sub0.cx + x0, cy: sub0.cy + y0, rr: sub0.rr, score: sub0.score };
    }
  } else {
    const f0 = findRing(edge, fw, fh);
    if (f0) found = { cx: f0.cx, cy: f0.cy, rr: f0.rr, score: f0.score };
  }
  const tooClose = !!found && found.rr > fw * 0.32;
  const det = found && !tooClose ? found : null;
  if (tooClose) {
    history.push(null);
    if (history.length > 10) history.shift();
    cancelCapture();
    if (coinSeen) hint.textContent = "A bit too close — move back a little";
    return;
  }
  history.push(det);
  if (history.length > 10) history.shift();
  scanCount++;
  if (det) lastDetAt = scanCount;
  // Nudge: after ~5 s of nothing, invite a tap instead of staying silent.
  if (!coinSeen && !assistPt && scanCount > 25 && scanCount - lastDetAt > 25) {
    hint.textContent = "No coin yet — tap it to point";
  }
  const recent = history.filter(Boolean);
  // Steady = recent detections agree with each other. With a tap assist
  // the bar lowers (3 of 5 near the tap); the ring must still be detected.
  const need = assistPt ? 3 : 6;
  const tol = assistPt ? 30 : 25;
  let steady = false;
  if (recent.length >= need) {
    const xs = recent.map((d) => d.cx).sort((a, b) => a - b);
    const ys = recent.map((d) => d.cy).sort((a, b) => a - b);
    const med = { cx: xs[recent.length >> 1], cy: ys[recent.length >> 1] };
    steady = recent.every((d) => Math.hypot(d.cx - med.cx, d.cy - med.cy) < tol);
  }
  if (steady) {
    const d = recent[recent.length - 1];
    smooth = smooth ? {
      cx: smooth.cx + (d.cx - smooth.cx) * 0.35, cy: smooth.cy + (d.cy - smooth.cy) * 0.35,
      rr: smooth.rr + (d.rr - smooth.rr) * 0.35, score: d.score,
    } : { ...d };
    placeRing(smooth, fw, fh);
    if (!coinSeen) { coinSeen = true; identifyCoin(smooth, fw, fh); setLocked(false); armCapture(); }
  } else if (coinSeen && recent.length < 3) {
    cancelCapture();
    coinSeen = false; smooth = null; coinLabel = ""; assistPt = null;
    setLocked(true, "Add a coin for scale");
  }
}
// Tap-to-assist: tapping the viewfinder narrows the search to that spot.
// The ring must still be detected there — a tap alone never unlocks.
document.getElementById("cam").addEventListener("pointerdown", (ev) => {
  if (coinSeen || !feed.videoWidth) return;
  const r = feed.getBoundingClientRect();
  const fw = SW, fh = Math.round((SW * feed.videoHeight) / feed.videoWidth);
  const vw = feed.videoWidth, vh = feed.videoHeight;
  // The preview is object-fit: cover: a centred crop of the video fills the
  // element. Tap coordinates must go through that crop, not straight to 0..1.
  const scale = Math.max(r.width / vw, r.height / vh);
  const dispW = vw * scale, dispH = vh * scale;
  const ox = (dispW - r.width) / 2, oy = (dispH - r.height) / 2;
  const fx = (ev.clientX - r.left + ox) / dispW, fy = (ev.clientY - r.top + oy) / dispH;
  assistPt = {
    x: Math.max(0, Math.min(fw, fx * fw)),
    y: Math.max(0, Math.min(fh, fy * fh)),
  };
  assistAt = scanCount;
  hint.textContent = "Checking that spot…";
});
setInterval(() => {
  if (assistPt && scanCount - assistAt > 50) { assistPt = null; } // assist expires after ~10 s
}, 1000);

// Remote diagnosis hook: window.__snapclaim() prints gate internals.
window.__snapclaim = () => ({ coinSeen, locked: fab.classList.contains("locked"), assist: !!assistPt, scans: scanCount, lastDetAgo: scanCount - lastDetAt, hint: hint.textContent });

fab.addEventListener("pointerdown", () => fab.classList.add("hide"));
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) fab.addEventListener(ev, () => fab.classList.remove("hide"));
fab.addEventListener("click", () => {
  if (fab.classList.contains("locked")) { hint.textContent = "Hold a coin in front of the camera"; return; }
  cancelCapture();
  try {
    const vw = feed.videoWidth, vh = feed.videoHeight;
    if (vw) {
      const cap = document.createElement("canvas");
      const side = Math.max(vw, vh) > 1024 ? 1024 / Math.max(vw, vh) : 1;
      cap.width = Math.round(vw * side); cap.height = Math.round(vh * side);
      cap.getContext("2d").drawImage(feed, 0, 0, cap.width, cap.height);
      stillDataUrl = cap.toDataURL("image/jpeg", 0.85);
      document.getElementById("shotFull").src = stillDataUrl;
      // coin circle in still pixels for the scale reference later
      if (smooth) {
        const sx = cap.width / vw, sy = cap.height / vh;
        gateCoin = { cx: smooth.cx, cy: smooth.cy, rr: smooth.rr, fw: SW, fh: Math.round((SW * vh) / vw), sw: cap.width, sh: cap.height, sx, sy };
      }
    }
  } catch { /* stills are best-effort */ }
  stopCamera();
  const flash = $("flash");
  flash.classList.add("go");
  setTimeout(() => { show("sReview"); flash.classList.remove("go"); }, 160);
});
$("retake").onclick = () => {
  backToCam();
  coinSeen = false; smooth = null; coinLabel = ""; gateCoin = null; stillDataUrl = ""; noScaleMode = false;
  setCoinSize(0);
  history.length = 0;
  setLocked(true, "Add a coin for scale");
  acquireCamera();
};
$("usePhoto").onclick = () => {
  // Consent is recorded on-device only: there is no dataset endpoint yet,
  // so checking this box never uploads anything by itself.
  try {
    if ($("donateCheck").checked) localStorage.setItem("snapclaim.donatePhoto", "1");
    else localStorage.removeItem("snapclaim.donatePhoto");
  } catch { /* storage may be unavailable; the photo flow must not break */ }
  show("sMark"); setupMarkPhoto();
};
$("backCam").onclick = () => { $("retake").onclick(); };
$("altEntry").onclick = () => { loadSample(); };
$("noCoin").onclick = () => {
  noScaleMode = true;
  gateCoin = null;
  setLocked(false, "Percent-only — no scale. Tap to snap.");
  cancelCapture();
};
/* Upload fallback: an existing photo skips the coin gate, so it measures
   percent-only (no scale reference was detected in it). */
$("uploadBtn").onclick = () => $("camFile").click();
$("camFile").addEventListener("change", () => {
  const file = $("camFile").files?.[0];
  $("camFile").value = "";
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const side = Math.max(img.width, img.height) > 1024 ? 1024 / Math.max(img.width, img.height) : 1;
    const cap = document.createElement("canvas");
    cap.width = Math.round(img.width * side); cap.height = Math.round(img.height * side);
    cap.getContext("2d").drawImage(img, 0, 0, cap.width, cap.height);
    stillDataUrl = cap.toDataURL("image/jpeg", 0.85); // canvas redraw strips EXIF
    $("shotFull").src = stillDataUrl;
    gateCoin = null; noScaleMode = true; coinLabel = "";
    setCoinSize(0);
    stopCamera();
    show("sReview");
  };
  img.onerror = () => { URL.revokeObjectURL(url); hint.textContent = "That photo could not be read — try another."; };
  img.src = url;
});

/* ---------- mark damage (photo canvas + SlimSAM taps) ---------- */
const MAX_SIDE = 512;
let embeddings = null; // true once the worker has embedded the current photo
let dmg = { points: [], pointMasks: [], mask: null, iou: 0, source: null };
let dmgLabel = "crack";
const MASK_COLORS = { crack: "#c0392b", stain: "#f39c12", peel: "#2980b9", dent: "#8e44ad", coin: "#0f7a36" };

function encodeRle(mask, w, h) {
  const counts = [];
  let cur = 0, run = 0;
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    const v = mask[y * w + x] ? 1 : 0;
    if (v === cur) run++; else { counts.push(run); cur = v; run = 1; }
  }
  counts.push(run);
  return { size: [h, w], counts };
}
function circleRle(cx, cy, r, w, h) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy <= r * r) mask[y * w + x] = 1;
  }
  return encodeRle(mask, w, h);
}
// SlimSAM runs in sam-worker.js (WebGPU when the phone has it, CPU otherwise), so the
// ~30 s embedding never freezes the page. A worker that fails only disables outlining.
let samWorker = null, samPhotoId = 0, samDecodeId = 0;
const samPending = new Map();
function sam() {
  if (samWorker) return samWorker;
  // ?device=wasm|webgpu on the page URL forces the worker's backend, for comparisons.
  const url = new URL("./sam-worker.js", import.meta.url);
  const device = new URLSearchParams(location.search).get("device");
  if (device) url.searchParams.set("device", device);
  samWorker = new Worker(url, { type: "module" });
  samWorker.onmessage = ({ data }) => {
    if (data.type === "decoded") {
      const p = samPending.get(data.id);
      samPending.delete(data.id);
      if (data.error) p?.reject(new Error(data.error)); else p?.resolve(data.result);
      return;
    }
    if (data.photoId !== undefined && data.photoId !== samPhotoId) return; // stale photo
    if (data.type === "progress") $("tfState").textContent = `Downloading the outlining model… ${data.percent}%`;
    else if (data.type === "ready") {
      embeddings = true;
      $("tfState").textContent = "";
      console.info(`[sam] embedded on ${data.device} in ${data.embedMs} ms`);
    } else if (data.type === "error") {
      $("status").textContent = isOfflineNow() ? offlineModelMessage("outlining") : `Outlining unavailable (${data.message}). Check the connection and retry.`;
    }
  };
  samWorker.onerror = (e) => { $("status").textContent = isOfflineNow() ? offlineModelMessage("outlining") : `Outlining failed to start (${e.message ?? "worker error"}). Check the connection and retry.`; };
  return samWorker;
}
function setupMarkPhoto() {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    photo = document.createElement("canvas");
    photo.width = Math.round(img.width * scale);
    photo.height = Math.round(img.height * scale);
    photo.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, photo.width, photo.height);
    dmg = { points: [], pointMasks: [], mask: null, iou: 0, source: null };
    // A manual coin tap is pixel coords of the previous photo — never reuse it.
    coinManualPt = null; coinCorrectMode = false;
    const fixBtn = $("coinFixBtn");
    if (fixBtn) { fixBtn.textContent = "Tap coin to correct"; fixBtn.classList.remove("on"); }
    const fixHint = $("coinFixHint");
    if (fixHint) fixHint.textContent = "";
    drawMark();
    $("measureBtn").disabled = true;
    $("status").textContent = "Tap the crack, then Measure.";
    embeddings = null;
    samPhotoId++;
    const image = photo.getContext("2d").getImageData(0, 0, photo.width, photo.height);
    sam().postMessage({ type: "embed", photoId: samPhotoId, image: { data: image.data, width: image.width, height: image.height } }, [image.data.buffer]);
  };
  img.src = stillDataUrl;
}
// Cracks are thin, so the worker takes SAM's smallest confident candidate, not the wall
// around it. Coins are compact, so they keep SAM's best-scoring candidate.
function samDecode(point, preferSmallest) {
  const id = samDecodeId++;
  return new Promise((resolve, reject) => {
    samPending.set(id, { resolve, reject });
    sam().postMessage({ type: "decode", id, photoId: samPhotoId, point, preferSmallest });
  });
}
const decodePoint = (point) => samDecode(point, true);
// SAM 3.1 via the backend: one call for all taps so far (one billed image), not one per tap.
// Throws on any failure so the caller falls back to the on-device model.
async function segmentViaApi(points) {
  const res = await fetch(base() + "/v1/segment", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageUrl: photo.toDataURL("image/jpeg", 0.85),
      width: photo.width, height: photo.height,
      points: points.map(([x, y]) => ({ x, y })),
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw backendErr(res, j, "segment failed");
  // SAM may split one crack into several objects; all of them are the damage.
  const records = j.result?.records ?? [];
  if (!records.length) throw new Error("SAM found nothing there — tap the middle of the damage and retry.");
  const mask = unionMasks(records.map((rec) => decodeRle(rec.rle)));
  return { mask, iou: Math.min(...records.map((rec) => rec.confidence ?? 0)), rle: encodeRle(mask, photo.width, photo.height) };
}
// On-device union of one SlimSAM mask per tap; null when no tap found anything.
async function segmentOnDevice() {
  while (dmg.pointMasks.length < dmg.points.length) dmg.pointMasks.push(await decodePoint(dmg.points[dmg.pointMasks.length]));
  const found = dmg.pointMasks.filter(Boolean);
  if (!found.length) return null;
  const union = new Uint8Array(found[0].mask.length);
  for (const { mask } of found) for (let i = 0; i < union.length; i++) union[i] |= mask[i];
  return { mask: union, iou: Math.min(...found.map((f) => f.iou)) };
}
const decodeCoinPoint = (point) => samDecode(point, false);
function drawMark() {
  const c = $("markCanvas");
  c.width = photo.width; c.height = photo.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(photo, 0, 0);
  if (dmg.mask) {
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < dmg.mask.length; i++) {
      if (!dmg.mask[i]) continue;
      const o = i * 4;
      img.data[o] = img.data[o] * 0.55 + 196 * 0.45;
      img.data[o + 1] = img.data[o + 1] * 0.55 + 31 * 0.45;
      img.data[o + 2] = img.data[o + 2] * 0.55 + 41 * 0.45;
    }
    ctx.putImageData(img, 0, 0);
  }
  // auto coin outline from the gate (green ring) + manual correction (red).
  // The manual radius matches measure()'s circleRef radius (gate-derived, or
  // a 3.5% fallback when the gate missed) so the ring shows what gets measured.
  const hasManualCoin = !!coinManualPt;
  const manualCoinRadius = () => gateCoin
    ? Math.max(3, (gateCoin.rr / gateCoin.fw) * (photo.width / gateCoin.sw))
    : Math.max(10, photo.width * 0.035);
  if (gateCoin && !hasManualCoin) {
    const kx = photo.width / gateCoin.sw, ky = photo.height / gateCoin.sh;
    const cx = (gateCoin.cx / gateCoin.fw) * gateCoin.sw * kx;
    const cy = (gateCoin.cy / gateCoin.fh) * gateCoin.sh * ky;
    const r = (gateCoin.rr / gateCoin.fw) * gateCoin.sw * kx;
    ctx.strokeStyle = $("coinTaped")?.checked ? "#e6a700" : "#0e8a4d"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  if (hasManualCoin) {
    ctx.strokeStyle = "#c81e2b"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(coinManualPt[0], coinManualPt[1], manualCoinRadius(), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#c81e2b"; ctx.beginPath(); ctx.arc(coinManualPt[0], coinManualPt[1], 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#c81e2b"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  for (const [x, y] of dmg.points) {
    ctx.beginPath(); ctx.arc(x, y, Math.max(5, c.width / 120), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  $("measureBtn").disabled = !dmg.mask;
}
$("markCanvas").addEventListener("pointerdown", async (ev) => {
  if (!photo) return;
  const c = $("markCanvas"), rc = c.getBoundingClientRect();
  const x = Math.round((ev.clientX - rc.left) * (c.width / rc.width));
  const y = Math.round((ev.clientY - rc.top) * (c.height / rc.height));
  if (coinCorrectMode) {
    coinManualPt = [x, y];
    coinCorrectMode = false;
    $("coinFixHint").textContent = "Coin corrected — will use your tap";
    $("coinFixBtn").textContent = "Tap coin to correct";
    $("coinFixBtn").classList.remove("on");
    drawMark();
    return;
  }
  dmg.points.push([x, y]);
  $("status").textContent = "Outlining…";
  // SAM 3.1 API first; the on-device model only when the API call fails.
  let out = null, source = "api";
  try {
    out = await segmentViaApi(dmg.points);
  } catch (e) {
    console.info("[sam] API failed, using on-device", e);
    source = "device";
    if (!embeddings) { dmg.points.pop(); $("status").textContent = isOfflineNow() ? offlineModelMessage("outlining") : "Outlining model still loading…"; return; }
    try { out = await segmentOnDevice(); } catch { out = null; }
  }
  if (out) {
    // Bridge hairline gaps (≤4 px) so one crack reads as one region, not
    // speckle. Done here so the outline shown is exactly what gets measured.
    dmg.mask = closeMask(out.mask, photo.width, photo.height, 2); dmg.iou = out.iou; dmg.source = source;
    $("status").textContent = `Outlined (${Math.round(dmg.iou * 100)}% sure) via ${source === "api" ? "SAM 3.1 API" : "on-device"}.`;
  } else { dmg.mask = null; dmg.source = null; $("status").textContent = "No mask there. Tap the middle of it."; }
  drawMark();
});
$("coinKind").addEventListener("change", () => {
  const opt = $("coinKind").selectedOptions[0];
  // The user's confirmation wins over the gate's size guess (it can name a
  // coin outside this list, e.g. a nickel, while the scale uses this value).
  coinLabel = opt && Number(opt.value) > 0 ? opt.textContent.replace(/ · (\d+(?:\.\d+)?) mm$/, " · Ø$1 mm") : "";
});
for (const [id, label] of [["chipCrack", "crack"], ["chipStain", "stain"], ["chipPeel", "peel"], ["chipDent", "dent"]]) {
  $(id).onclick = () => {
    dmgLabel = label;
    for (const [o] of [["chipCrack"], ["chipStain"], ["chipPeel"], ["chipDent"]]) $(o).classList.remove("on");
    $(id).classList.add("on");
  };
}

/* ---------- measure + report ---------- */
function checkPhotoNotes() {
  try {
    const px = photo.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, photo.width, photo.height);
    const notes = checkPhoto({ width: px.width, height: px.height, data: px.data }, Math.max(photo.width, photo.height));
    $("photoNotes").textContent = notes.join(" ");
  } catch { /* advisory only */ }
}
  let checkState = { skeptic: "idle", xcheck: "idle" }; // idle|loading|ok|error per check

$("measureBtn").onclick = async () => {
  if (!dmg.mask) return;
  checkPhotoNotes();
  const w = photo.width, h = photo.height;
  show("sNum");
  fillPhotoCard();
  setNumLoading(true);
  $("numError").hidden = true;
  $("measured").innerHTML = "";
  $("findings").innerHTML = "";
  drawScheme([]);
  const body = { masks: [{ id: "damage-1", label: dmgLabel, rle: encodeRle(dmg.mask, w, h), confidence: dmg.iou || 0.8 }] };
  let circleRef = null;
  // Manual coin tap wins over the gate — taped coin or missed detection.
  const coinCxCyR = (() => {
    if (coinManualPt) {
      const estR = Math.max(10, w * 0.035);
      return { cx: coinManualPt[0], cy: coinManualPt[1], r: gateCoin ? Math.max(3, (gateCoin.rr / gateCoin.fw) * (w / gateCoin.sw)) : estR };
    }
    if (!gateCoin) return null;
    const kx = w / gateCoin.sw, ky = h / gateCoin.sh;
    return { cx: (gateCoin.cx / gateCoin.fw) * gateCoin.sw * kx, cy: (gateCoin.cy / gateCoin.fh) * gateCoin.sh * ky, r: Math.max(3, (gateCoin.rr / gateCoin.fw) * gateCoin.sw * kx) };
  })();
  if (coinCxCyR) {
    const { cx, cy, r } = coinCxCyR;
    const knownMm = Number($("coinKind").value);
    if (!(knownMm > 0)) { $("status").textContent = "Choose the reference size first."; return; }
    circleRef = { id: "coin", rle: circleRle(cx, cy, r, w, h), knownMm, confidence: coinManualPt ? 0.9 : 0.85 };
    // The coin's real outline, not the gate's circle: a tilted wall shows the coin as an
    // ellipse, and the backend uses that ellipse to correct the crack lengths.
    const traced = await traceCoin(cx, cy, r, w, h);
    body.reference = traced ? { ...circleRef, rle: encodeRle(traced.mask, w, h), confidence: traced.iou } : circleRef;
  } else if (noScaleMode) body.note = "percent-only requested";
  $("status").textContent = "";
  try {
    const observe = (b) => fetch(base() + "/v1/observe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    let res = await observe(body);
    let j = await res.json();
    // a traced outline the backend refuses (not coin-shaped) falls back to the gate's circle
    if (res.status === 422 && circleRef && body.reference !== circleRef) {
      console.info(`[coin] traced outline refused (${j.error}); using the detected circle`);
      body.reference = circleRef;
      res = await observe(body);
      j = await res.json();
    }
    if (!res.ok || !j.ok) throw new Error(j.error ?? res.status);
    const mres = await fetch(base() + "/v1/measure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(j.result) });
    const measured = await mres.json();
    if (!mres.ok || !measured.ok) throw new Error(measured.error ?? mres.status);
    payloadObj = j.result;
    lastMeasurement = measured.result;
    showMeasured(lastMeasurement);
    show("sSay");
    startListening();
  } catch (e) {
    setNumLoading(false);
    $("status").textContent = `Measuring failed (${e.message ?? e}).`;
    showNumError("Measurement failed", String(e.message ?? e), () => $("measureBtn").click());
  }
};
let coinManualPt = null, coinCorrectMode = false;
$("coinTaped")?.addEventListener("change", () => { if (photo) drawMark(); });
$("coinFixBtn")?.addEventListener("click", () => {
  if (!photo) return;
  coinCorrectMode = !coinCorrectMode;
  $("coinFixHint").textContent = coinCorrectMode ? "Tap the coin center on the photo" : "";
  $("coinFixBtn").textContent = coinCorrectMode ? "Cancel" : "Tap coin to correct";
  $("coinFixBtn").classList.toggle("on", coinCorrectMode);
});
/** SAM's outline of the coin at the gate's circle, or null when it doesn't look like that coin. */
async function traceCoin(cx, cy, r, w, h) {
  if (!embeddings) return null;
  let out;
  try { out = await decodeCoinPoint([Math.round(cx), Math.round(cy)]); } catch { return null; }
  if (!out) return null;
  let area = 0, sx = 0, sy = 0;
  for (let i = 0; i < out.mask.length; i++) if (out.mask[i]) { area++; sx += i % w; sy += (i / w) | 0; }
  // An ellipse seen at up to ~60° keeps half its area; much more means SAM took the wall.
  const circle = Math.PI * r * r;
  const taped = !!$("coinTaped")?.checked;
  // Tape halo inflates the mask (coin + tape strip) — allow 2.5× and a looser centroid when checked.
  const lo = 0.4, hi = taped ? 2.5 : 1.6, drift = taped ? 0.75 : 0.5;
  if (area < circle * lo || area > circle * hi) {
    if (!taped) return null;
    // Taped: try to peel tape — keep the strongest inner circular rim instead of the blob.
    // Re-estimate radius from area and check it still looks like a disk, not a long strip.
    const estR = Math.sqrt(area / Math.PI);
    if (estR > r * 2.0 || estR < r * 0.5) return null;
  }
  if (Math.hypot(sx / area - cx, sy / area - cy) > r * drift) return null;
  return out;
}

function metricCards(f) {
  const mm = f.crackLengthMm == null ? "—" : `${esc(String(f.crackLengthMm))} mm`;
  const area = f.areaCm2 == null ? "" : `<div class="metric"><b>${esc(String(f.areaCm2))} cm²</b><span>Area</span></div>`;
  const width = f.crackWidthMm == null ? "" : `<div class="metric"><b>${esc(String(f.crackWidthMm))} mm</b><span>Width</span></div>`;
  const label = String(f.label);
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  return `<p class="found">${esc(cap)} found</p>
    <div class="metrics">
      <div class="metric"><b>${esc(String(f.percent))}%</b><span>Of the wall</span></div>
      <div class="metric"><b>${mm}</b><span>Length</span></div>
      <div class="metric"><b>${esc(String(f.regionCount ?? 1))}</b><span>Region${(f.regionCount ?? 1) === 1 ? "" : "s"}</span></div>
      ${area}${width}
    </div>
    <div class="sevbar sev-${escSeverity(f.severity)}"><span>${esc(String(f.severity)).toUpperCase()}</span><small>severity band</small></div>`;
}

function receiptChips(receipts) {
  return (receipts || []).slice(0, 12).map((r) => `<code>${esc(r.id)} · ${esc(String(r.output?.value ?? ""))} ${esc(r.output?.unit ?? "")}</code>`).join("");
}

function measuredRows(findings, receipts) {
  return findings.map((f) => {
    const mm = f.crackLengthMm === null ? "—" : `${esc(String(f.crackLengthMm))} mm`;
    const label = String(f.label);
    const cap = label.charAt(0).toUpperCase() + label.slice(1);
    return `<li><p class="found">${esc(cap)} found</p>` +
      `<b>${esc(String(f.percent))}%</b> <small>of the wall</small> · <b>${mm}</b> <small>length</small> · ` +
      `${esc(String(f.regionCount ?? 1))} region${(f.regionCount ?? 1) === 1 ? "" : "s"} · ` +
      `<span class="badge ok">${esc(String(f.severity))}</span>` +
      `${f.statement ? `<br/><small>${esc(String(f.statement))}</small>` : ""}</li>`;
  }).join("");
}

/** Bounding box of the on pixels, or null when the mask is empty. */
function maskBox(mask, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % w, y = (i / w) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/**
 * Outline the mask the backend measured and tag it with its own numbers, on the
 * numbers photo card. Runs from the /v1/observe reply, so it is on screen as soon
 * as the claim leaves the transcript step — no report generation needed.
 */
function drawNumOverlay() {
  const svg = $("numPhotoOverlay");
  if (!svg) return;
  svg.replaceChildren();
  const ov = payloadObj?.overlay;
  const first = (lastMeasurement?.findings ?? [])[0];
  if (!ov || !stillDataUrl || !(ov.width > 0) || !(ov.height > 0) || !first) return;
  const NS = "http://www.w3.org/2000/svg";
  const W = ov.width, H = ov.height;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const colorFor = (label) => MASK_COLORS[label] ?? "#7f8c8d";
  for (const mask of ov.masks) {
    const color = colorFor(mask.label);
    svg.appendChild(el("path", {
      d: mask.path, fill: color, "fill-opacity": "0.18", stroke: color,
      "stroke-width": 2, "vector-effect": "non-scaling-stroke", "fill-rule": "evenodd",
    }));
  }
  // Tag the damage outline, never the scale coin.
  const target = ov.masks.find((m) => m.label !== "coin");
  const box = target && dmg.mask ? maskBox(dmg.mask, W, H) : null;
  if (!box) return;
  const color = colorFor(target.label);
  const label = String(first.label);
  const number = `${String(first.percent)}%${first.crackLengthMm == null ? "" : ` · ${String(first.crackLengthMm)} mm`}`;
  const text = `${label.charAt(0).toUpperCase() + label.slice(1)} · ${number}`;
  const fs = Math.max(11, W * 0.036);
  const tagW = text.length * fs * 0.6 + fs * 1.2;
  const tagH = fs * 1.75;
  const gap = fs * 0.8;
  const edge = fs * 0.4;
  const cx = (box.minX + box.maxX) / 2;
  // Above the damage, else below it, else beside a full-height crack.
  let x = cx - tagW / 2, y, place;
  if (box.minY - gap - tagH >= edge) { y = box.minY - gap - tagH; place = "above"; }
  else if (box.maxY + gap + tagH <= H - edge) { y = box.maxY + gap; place = "below"; }
  else if (box.maxX + gap + tagW <= W - edge) { x = box.maxX + gap; y = box.minY; place = "right"; }
  else { x = box.minX - gap - tagW; y = box.minY; place = "left"; }
  x = Math.min(Math.max(x, edge), Math.max(edge, W - tagW - edge));
  y = Math.min(Math.max(y, edge), Math.max(edge, H - tagH - edge));
  const midY = Math.min(Math.max(y + tagH / 2, box.minY), box.maxY);
  // Beside a full-height crack the connector must meet the mask's edge at that row,
  // not the mask's global bounding box (which could sit under the tag).
  let sideX = null;
  if (place === "left" || place === "right") {
    const row = Math.min(H - 1, Math.max(0, Math.round(midY)));
    const base = row * W;
    if (place === "right") {
      for (let px = W - 1; px >= 0; px--) if (dmg.mask[base + px]) { sideX = px; break; }
    } else {
      for (let px = 0; px < W; px++) if (dmg.mask[base + px]) { sideX = px; break; }
    }
  }
  let line = null;
  if (place === "right" && sideX !== null) line = { x1: x, y1: midY, x2: sideX, y2: midY };
  else if (place === "left" && sideX !== null) line = { x1: x + tagW, y1: midY, x2: sideX, y2: midY };
  else if (place === "below") line = { x1: Math.min(Math.max(cx, x + fs * 0.6), x + tagW - fs * 0.6), y1: y, x2: cx, y2: box.maxY };
  else if (place === "above") line = { x1: Math.min(Math.max(cx, x + fs * 0.6), x + tagW - fs * 0.6), y1: y + tagH, x2: cx, y2: box.minY };
  if (line) svg.appendChild(el("line", { ...line, stroke: color, "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }));
  svg.appendChild(el("rect", {
    x, y, width: tagW, height: tagH, rx: tagH / 2,
    fill: "#ffffff", stroke: color, "stroke-width": 2, "vector-effect": "non-scaling-stroke",
  }));
  const tag = el("text", {
    x: x + tagW / 2, y: y + tagH / 2, "text-anchor": "middle", "dominant-baseline": "central",
    "font-family": "'Space Grotesk', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", "font-weight": 700, "font-size": fs, fill: "#122540",
  });
  tag.textContent = text;
  svg.appendChild(tag);
}

function fillPhotoCard() {
  const card = $("numPhotoCard");
  if (!card || !stillDataUrl) return;
  card.hidden = false;
  $("numPhoto").src = stillDataUrl;
  drawNumOverlay();
  $("numChip").textContent = coinLabel ? `${coinLabel} · measured` : (noScaleMode ? "Percent only · no coin" : "Measured");
}
function setNumLoading(on) {
  const bar = $("numLoading");
  if (bar) bar.hidden = !on;
}
function showNumError(title, detail, retry) {
  $("measured").innerHTML =
    `<div class="statecard err" role="alert"><b>${esc(title)}</b>` +
    `<p style="margin:8px 0 12px;color:#5b6b8c">${esc(detail)}</p>` +
    `<button class="btn-dark" type="button" id="numRetry" style="width:100%">Try again</button></div>`;
  const btn = document.getElementById("numRetry");
  if (btn) btn.onclick = retry;
}
function showMeasured(result) {
  setNumLoading(false);
  $("numError").hidden = true;
  fillPhotoCard();
  const first = result.findings[0];
  const mode = result.mode === "absolute" ? "" : " · percent only (no coin)";
  $("measured").innerHTML =
    `<span class="badge ok">MEASURED${esc(mode)}</span>` +
    (first ? metricCards(first) : "") +
    (result.findings.length > 1
      ? `<ul>${measuredRows(result.findings.slice(1), result.receipts)}</ul>`
      : "") +
    `<div class="receipts" aria-label="Receipts">${receiptChips(result.receipts)}</div>`;
  drawScheme(result.findings);
}
function drawScheme(findings) {
  const svg = $("scheme");
  svg.innerHTML = "";
  const NS = "http://www.w3.org/2000/svg";
  const color = (s) => s === "significant" ? "#c0392b" : s === "moderate" ? "#e67e22" : "#27ae60";
  findings.slice(0, 8).forEach((f, i) => {
    const w = Math.max(4, Math.min(380, (f.percent ?? 0) * 12));
    const y = 12 + i * 32;
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", "110"); rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(w)); rect.setAttribute("height", "18");
    rect.setAttribute("fill", color(f.severity));
    svg.appendChild(rect);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", "4"); t.setAttribute("y", String(y + 14));
    t.setAttribute("font-size", "12");
    t.textContent = `${f.label} ${f.percent}%`;
    svg.appendChild(t);
  });
}

/* ---------- mic + transcribe ---------- */
const mic = $("micBtn"), micState = $("micState"), heard = $("heard"), wave = $("wave");
const micClock = $("micClock"), sttCount = $("sttCount"), voiceCard = $("voiceCard"),
  voiceTitle = $("voiceTitle"), voiceErr = $("voiceErr"), sendBtn = $("sendBtn"),
  transcriptBox = $("transcriptBox");
const LISTEN_MS = 8000, RING_LEN = 578;
function setPill(mode, text) { micState.className = "stt-pill " + mode; micState.textContent = text; }
function ringProgress(frac) {
  const f = document.querySelector("#micRing .fill");
  if (f) f.style.strokeDashoffset = String(RING_LEN * (1 - Math.min(1, Math.max(0, frac))));
}
function tickClock() {
  const s = Math.min(LISTEN_MS / 1000, (Date.now() - listenStarted) / 1000);
  if (micClock) micClock.textContent = `0:${String(Math.floor(s)).padStart(2, "0")} / 0:08`;
  ringProgress(s / (LISTEN_MS / 1000));
}
function showVoiceError(title, msg) { voiceTitle.textContent = title; voiceErr.textContent = msg; voiceCard.hidden = false; }
function hideVoiceError() { voiceCard.hidden = true; }
function syncSend() {
  const n = transcriptBox.value.length;
  sttCount.textContent = `${n} / 280`;
  const has = transcriptBox.value.trim().length > 0;
  sendBtn.disabled = !has;
  sendBtn.textContent = has ? "See measurements →" : "See measurements";
}
const NBARS = 28, barEls = [];
for (let i = 0; i < NBARS; i++) { const b = document.createElement("i"); wave.appendChild(b); barEls.push(b); }
let micTimer = null, micStream = null, micReady = false, listening = false, analyser = null, analyserData = null;
let micClockTimer = null, listenStarted = 0;
function paintWave() {
  if (analyser) {
    analyser.getByteFrequencyData(analyserData);
    for (let i = 0; i < NBARS; i++) {
      const v = analyserData[Math.floor((i / NBARS) * analyserData.length)] / 255;
      barEls[i].style.height = Math.max(6, Math.round(v * 52)) + "px";
    }
  } else {
    const t = Date.now() / 180;
    for (let i = 0; i < NBARS; i++) {
      const v = listening ? 0.35 + 0.3 * Math.sin(t + i * 0.7) + 0.25 * Math.sin(t * 0.37 + i * 1.7) : 0.12;
      barEls[i].style.height = Math.max(6, Math.round(Math.abs(v) * 52)) + "px";
    }
  }
}
let lastWavePaint = 0;
setInterval(() => {
  if (!$("sSay").classList.contains("on")) return;
  const now = Date.now();
  if (!listening && now - lastWavePaint < 500) return; // idle shimmer at 2 fps, live levels full rate
  lastWavePaint = now;
  paintWave();
}, 90);
async function ensureMic() {
  if (micReady) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    setPill("idle", "No mic");
    heard.classList.remove("idle");
    heard.textContent = "No microphone on this device — type the line below.";
    showVoiceError("No microphone", "This device has no microphone. Type the line below instead.");
    return false;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micReady = true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const actx = new Ctx();
      const src = actx.createMediaStreamSource(micStream);
      analyser = actx.createAnalyser(); analyser.fftSize = 64;
      analyserData = new Uint8Array(analyser.frequencyBinCount);
      src.connect(analyser);
    } catch { /* levels stay simulated */ }
    return true;
  } catch {
    setPill("idle", "Mic blocked");
    heard.classList.remove("idle");
    heard.textContent = "Mic blocked — allow access or type the line below.";
    showVoiceError("Mic blocked", "The browser blocked the microphone. Allow access and try again, or type the line below.");
    return false;
  }
}
function stopMicTracks() {
  try { micStream?.getTracks()?.forEach((t) => t.stop()); } catch { /* noop */ }
  try { recStream?.getTracks()?.forEach((t) => t !== null && t !== undefined && t.stop?.()); } catch { /* noop */ }
  micStream = null; recStream = null; micReady = false; analyser = null; analyserData = null;
}
function stopListening(landed, text) {
  clearTimeout(micTimer); micTimer = null; listening = false;
  clearInterval(micClockTimer); micClockTimer = null;
  if (micClock) micClock.textContent = "";
  ringProgress(0);
  document.getElementById("micwrap").classList.remove("live");
  mic.classList.remove("stop");
  if (landed) {
    setPill("done", "Heard");
    heard.classList.remove("idle");
    heard.textContent = text ?? "";
  } else {
    setPill("idle", "Idle");
  }
  // The OS mic indicator must not linger after leaving the Say step.
  if (!landed) stopMicTracks();
}
async function startListening() {
  if (listening) return;
  hideVoiceError();
  setPill("busy", "Requesting mic");
  heard.classList.add("idle");
  heard.textContent = "Speak now…";
  syncSend();
  if (!(await ensureMic())) return;
  listening = true;
  document.getElementById("micwrap").classList.add("live");
  mic.classList.add("stop");
  setPill("live", "Listening");
  recorderStart();
  listenStarted = Date.now();
  tickClock();
  clearInterval(micClockTimer);
  micClockTimer = setInterval(tickClock, 250);
  micTimer = setTimeout(() => finishListening(true), LISTEN_MS);
}
let recChunks = [], recorder = null, recStream = null;
async function recorderStart() {
  try {
    recStream = micStream ?? await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = [];
    recorder = new MediaRecorder(recStream);
    recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    recorder.start();
  } catch { recorder = null; }
}
function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (o, t) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
  ascii(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
async function finishListening(landed) {
  stopListening(false);
  if (!landed || !recorder || recorder.state === "recording") {
    try { if (recorder?.state === "recording") recorder.stop(); } catch { /* noop */ }
  }
  await new Promise((r) => setTimeout(r, 300));
  const clip = new Blob(recChunks, { type: recorder?.mimeType || "audio/webm" });
  if (!landed || clip.size === 0) {
    setPill("idle", "Idle");
    if (landed) {
      heard.classList.remove("idle");
      heard.textContent = "Didn't catch anything — type the line below.";
      showVoiceError("Didn't hear anything", "The recording came back empty. Tap Try again or type the line below.");
    }
    return;
  }
  setPill("busy", "Transcribing");
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(await clip.arrayBuffer());
    const off = new OfflineAudioContext(1, Math.ceil(Math.min(decoded.duration, 10) * 16000), 16000);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start(0, 0, Math.min(decoded.duration, 10));
    const rendered = await off.startRendering();
    ctx.close().catch(() => {});
    // Server transcriber first when online (Muse auto-detects any language);
    // on-device Whisper is the fallback for offline use or a keyless /
    // erroring backend. Either side returning no words falls through to the
    // other before giving up.
    if (!isOfflineNow()) {
      try {
        const wav = encodeWav(rendered.getChannelData(0), 16000);
        const b64 = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(",").pop());
          fr.onerror = () => rej(new Error("read failed"));
          fr.readAsDataURL(wav);
        });
        const res = await fetch(base() + "/v1/transcribe", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ audioBase64: b64 }),
        });
        const j = await res.json().catch(() => ({}));
        const text = res.ok && j.ok ? String(j.result?.transcript ?? "").trim() : "";
        if (text) { landTranscript(text); return; }
        console.info(`[voice] server returned no words (HTTP ${res.status}), trying on-device`);
      } catch (e) { console.info(`[voice] server transcribe failed, trying on-device: ${e.message ?? e}`); }
    }
    setPill("busy", "Transcribing");
    try {
      // Whisper writes non-speech as tags like [Music] or (wind blowing); those are not words.
      const local = (await transcribeOnDevice(rendered.getChannelData(0).slice())).replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim();
      if (local) { landTranscript(local); return; }
      setPill("idle", "Idle");
      heard.classList.remove("idle");
      heard.textContent = "Didn't catch anything — type the line below.";
      showVoiceError("Didn't hear anything", "Nothing recognizable in that recording. Tap Try again or type the line below.");
      return;
    } catch (e) {
      setPill("idle", "Idle");
      showVoiceError("Transcription failed", isOfflineNow() ? `${offlineModelMessage("speech")} Or type the line below.` : `Transcription failed — type the line below. (${e.message ?? e})`);
      return;
    }
  } catch (e) {
    setPill("idle", "Idle");
    showVoiceError("Transcription failed", isOfflineNow() ? `${offlineModelMessage("speech")} Or type the line below.` : `Transcription failed — type the line below. (${e.message ?? e})`);
  }
}
function landTranscript(text) {
  hideVoiceError();
  transcriptBox.value = text;
  heard.classList.remove("idle");
  heard.textContent = `“${text}”`;
  setPill("done", "Heard");
  try { navigator.vibrate?.(15); } catch { /* haptics are best-effort */ }
  syncSend();
}
let voiceWorker = null, voiceId = 0;
/** Mono 16 kHz samples → text, on the device. Empty string means nothing heard. */
function transcribeOnDevice(audio) {
  voiceWorker ??= new Worker(new URL("./voice-worker.js", import.meta.url), { type: "module" });
  const id = voiceId++;
  return new Promise((resolve, reject) => {
    voiceWorker.onmessage = ({ data }) => {
      if (data.type === "progress") setPill("busy", `Getting speech model… ${data.percent}%`);
      else if (data.type === "transcribed" && data.id === id) data.error ? reject(new Error(data.error)) : resolve(data.text);
    };
    voiceWorker.onerror = (e) => reject(new Error(e.message ?? "speech worker failed to start"));
    voiceWorker.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  });
}
mic.onclick = () => { if (listening) finishListening(true); else startListening(); };
sendBtn.onclick = () => runReport();
transcriptBox.addEventListener("input", syncSend);
$("voiceRetry").onclick = () => { hideVoiceError(); startListening(); };
$("voiceType").onclick = () => transcriptBox.focus();
syncSend();
$("backMark").onclick = () => show("sReview");
$("backSay").onclick = () => show("sMark");

/* ---------- report / skeptic / render ---------- */
async function runReport() {
  if (!payloadObj) return;
  $("findings").innerHTML = "";
  const body = JSON.parse(JSON.stringify(payloadObj));
  body.transcript = $("transcriptBox").value;
  let res, j;
  try {
    res = await fetch(base() + "/v1/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    j = await res.json();
  } catch { j = { ok: false, error: "backend unreachable" }; res = { status: 0 }; }
  $("raw").textContent = JSON.stringify(j, null, 2);
  if (res.status === 503 || !res.ok || !j.ok) {
    const fails = res.status === 503 ? [j.error ?? "API key missing"] : (j.details ?? j.failures ?? [j.error]);
    $("findings").innerHTML = `<span class="badge fail">${res.status === 503 ? "AI FINDINGS UNAVAILABLE" : "GATED"}</span><pre>${esc(JSON.stringify(fails, null, 2))}</pre>`;
    return;
  }
  lastMeasurement = j.result.measurement ?? null;
  resetCheckState();
  const f0 = (j.result.findings ?? [])[0];
  const summary = f0 && typeof f0.statement === "string" ? f0.statement : null;
  $("findings").innerHTML =
    `<span class="badge ok">GATE PASS</span>` +
    (summary ? `<p style="margin:10px 0 0;font-weight:600">${esc(summary)}</p>` : "") +
    `<div class="receipts" aria-label="Receipts">${receiptChips(lastMeasurement?.receipts)}</div>`;
  drawScheme(lastMeasurement?.findings ?? []);
  show("sNum");
  runChecksAuto();
}
$("toCheck").onclick = () => {
  // The auto checks already ran once for this report; going forward only shows them.
  show("sCheck");
  if (checkState.skeptic === "idle" && checkState.xcheck === "idle") runChecksAuto();
};
$("toReport").onclick = () => { if (canProceedToReport()) show("sReport"); };
$("backNum").onclick = () => show("sSay");
$("backCheck").onclick = () => show("sCheck");
function resetCheckState() {
  checkState = { skeptic: "idle", xcheck: "idle" };
  renderCheckCard();
  updateReportGate();
}
function setCheck(which, state) {
  checkState[which] = state;
  renderCheckCard();
  updateReportGate();
}
function verdictBadge(verdict) {
  if (verdict === "AGREED") return `<span class="badge ok">AGREED</span>`;
  if (verdict === "DISPUTED") return `<span class="badge fail">DISPUTED</span>`;
  return `<span class="badge wait">PENDING</span>`;
}
function renderCheckCard() {
  const s = $("skStatus");
  if (!s) return;
  // skeptic card body
  if (checkState.skeptic === "loading") s.textContent = "Asking the skeptic model…";
  // xcheck line
  const x = $("xStatus");
  if (x && checkState.xcheck === "loading") x.textContent = "Asking SAM 3.1…";
}
function updateReportGate() {
  const btn = $("toReport");
  if (!btn) return;
  const done = checkState.skeptic === "ok" || checkState.skeptic === "error";
  const doneX = checkState.xcheck === "ok" || checkState.xcheck === "error";
  btn.disabled = !(done && doneX);
  btn.textContent = done && doneX ? "Make the report →" : "Run both checks to continue";
}
function canProceedToReport() {
  const done = (checkState.skeptic === "ok" || checkState.skeptic === "error") &&
    (checkState.xcheck === "ok" || checkState.xcheck === "error");
  if (!done) {
    $("skStatus").textContent = "Run both checks to continue — retry any failed one.";
    show("sCheck");
  }
  return done;
}
async function runSkeptic(auto, retried = false) {
  if (checkState.skeptic === "loading" && !retried) return;
  // Never send an empty request: without a measurement there is nothing to check.
  if (!payloadObj || !lastMeasurement) { if (!auto) $("skStatus").textContent = "Run the measurement first"; return; }
  checkState.skeptic = "loading";
  renderCheckCard(); updateReportGate();
  if (!retried) $("skOut").innerHTML = `<div class="skel" role="status" aria-label="Skeptic is checking"></div>`;
  else $("skStatus").textContent = "First draft failed the gate — retrying once…";
  try {
    // /v1/skeptic re-measures server-side: it needs the same measure inputs
    // /v1/report used, not just findings/receipts (else 422 "component and
    // masks are required"). Only the measure inputs, not the overlay (SVG paths are large).
    const measureInputs = {
      component: payloadObj.component, masks: payloadObj.masks,
      ...(payloadObj.scaleReference ? { scaleReference: payloadObj.scaleReference } : {}),
      ...(payloadObj.thresholds ? { thresholds: payloadObj.thresholds } : {}),
      ...(payloadObj.minReferenceConfidence !== undefined ? { minReferenceConfidence: payloadObj.minReferenceConfidence } : {}),
    };
    const res = await fetch(base() + "/v1/skeptic", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...measureInputs, transcript: $("transcriptBox").value, findings: lastMeasurement.findings, receipts: lastMeasurement.receipts }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw backendErr(res, j, "skeptic failed");
    const rows = (j.result.findings ?? []).map((f) => {
      const disputed = /disputed/i.test(f.statement || "");
      return `<li>${verdictBadge(disputed ? "DISPUTED" : "AGREED")} ${esc(f.statement ?? "")}<br/><small>cites: ${esc((f.citations ?? []).join(", "))}</small></li>`;
    }).join("");
    $("skOut").innerHTML = `<ul>${rows}</ul>`;
    $("skStatus").textContent = `skeptic ok ${j.requestId ?? ""}`.trim();
    setCheck("skeptic", "ok");
  } catch (e) {
    // The model is nondeterministic: one automatic retry on gate failure only.
    // Any other 4xx/5xx is shown once with a manual Retry button — never an auto loop.
    if (!retried && /Evidence gate failed/.test(e.message ?? "")) return runSkeptic(auto, true);
    const status = e.status ?? "?";
    console.error(`[skeptic] HTTP ${status}: ${e.message ?? e}`, e.details ?? "");
    const unavailable = typeof status === "number" && status >= 400 && status < 500;
    const detailList = Array.isArray(e.details) && e.details.length
      ? `<ul>${e.details.map((d) => `<li><small>${esc(d)}</small></li>`).join("")}</ul>` : "";
    $("skOut").innerHTML = `<div class="statecard err" role="alert"><b>${unavailable ? `Skeptic unavailable (HTTP ${status})` : "Skeptic check failed."}</b><p style="margin:8px 0 12px;color:#5b6b8c">${esc(e instanceof Error ? e.message : String(e))}</p>${detailList}<button class="btn-dark" type="button" id="skRetry" style="width:100%">Retry skeptic</button></div>`;
    const b = document.getElementById("skRetry");
    if (b) b.onclick = () => { checkState.skeptic = "idle"; runSkeptic(false); };
    $("skStatus").textContent = "";
    setCheck("skeptic", "error");
  }
}
async function runXcheck(auto) {
  if (checkState.xcheck === "loading") return;
  if (!dmg.mask || !photo) { if (!auto) $("xStatus").textContent = "Mark the damage first."; return; }
  checkState.xcheck = "loading";
  renderCheckCard(); updateReportGate();
  try {
    // Cross-check against the model that did NOT draw the mask: API mask vs on-device, or the reverse.
    let other;
    if (dmg.source === "api") {
      if (!embeddings) throw new Error(isOfflineNow() ? offlineModelMessage("outlining") : "On-device model still loading — retry in a moment.");
      const dev = await segmentOnDevice();
      if (!dev) throw new Error("The on-device model found nothing at those taps.");
      other = encodeRle(dev.mask, photo.width, photo.height);
    } else {
      other = (await segmentViaApi(dmg.points)).rle;
    }
    const ccRes = await fetch(base() + "/v1/crosscheck", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: encodeRle(dmg.mask, photo.width, photo.height), b: other, threshold: 0.5 }),
    });
    const cc = await ccRes.json().catch(() => ({}));
    if (!ccRes.ok || !cc.ok) throw backendErr(ccRes, cc, "cross-check failed");
    const x = $("xStatus");
    x.innerHTML = "";
    const chip = document.createElement("span");
    chip.className = `badge ${cc.result.verdict === "AGREED" ? "ok" : "fail"}`;
    chip.textContent = `${cc.result.verdict} · IoU ${cc.result.iou}`;
    x.appendChild(chip);
    setCheck("xcheck", "ok");
  } catch (e) {
    const status = e.status ?? "?";
    console.error(`[xcheck] HTTP ${status}: ${e.message ?? e}`, e.details ?? "");
    // /v1/segment is unavailable in mock mode, so a mask drawn by the API path
    // has nothing to cross-check against — say so instead of a generic failure.
    const noSam = /mock segment|not wired|HTTP 501/.test(e.message ?? "");
    const unavailable = typeof status === "number" && status >= 400 && status < 500;
    const title = noSam ? "Cross-check unavailable — SAM 3.1 is unavailable in mock mode"
      : unavailable ? `Cross-check unavailable (HTTP ${status})` : "Cross-check failed.";
    const detailList = Array.isArray(e.details) && e.details.length
      ? `<ul>${e.details.map((d) => `<li><small>${esc(d)}</small></li>`).join("")}</ul>` : "";
    const x = $("xStatus");
    x.innerHTML = `<div class="statecard err" role="alert"><b>${title}</b><p style="margin:8px 0 12px;color:#5b6b8c">${esc(e instanceof Error ? e.message : String(e))}</p>${detailList}<button class="btn-ghostline" type="button" id="xRetry" style="width:100%">Retry cross-check</button></div>`;
    const b = document.getElementById("xRetry");
    if (b) b.onclick = () => { checkState.xcheck = "idle"; runXcheck(false); };
    setCheck("xcheck", "error");
  }
}
let autoChecksFor = null; // lastMeasurement the auto checks ran for: once per report
function runChecksAuto() {
  // Once per report. Manual retries go through the buttons below, never an auto
  // loop, so a failing backend is hit once (plus one gate-failure retry), not stacked up.
  if (autoChecksFor === lastMeasurement) return;
  autoChecksFor = lastMeasurement;
  if (checkState.skeptic === "idle") runSkeptic(true);
  if (checkState.xcheck === "idle") runXcheck(true);
}
/** Backend failure with HTTP status + structured details attached; no payloads. */
function backendErr(res, j, fallback) {
  const raw = j.details ?? j.failures;
  const details = Array.isArray(raw) ? raw.map(String) : (raw === undefined ? undefined : [String(raw)]);
  const summary = details?.length ? `: ${details.join("; ").slice(0, 500)}` : "";
  const err = new Error(`${j.error ?? fallback ?? `HTTP ${res.status}`}${summary}`);
  err.status = res.status; err.details = details;
  return err;
}
$("skepticBtn").onclick = () => { checkState.skeptic = "idle"; runSkeptic(false); };
$("xcheckBtn").onclick = () => { checkState.xcheck = "idle"; runXcheck(false); };
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const b = $("installBtn");
  if (b) b.hidden = false;
});
$("installBtn").onclick = async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => {});
  deferredInstallPrompt = null;
  $("installBtn").hidden = true;
};
function reportSummaryText() {
  const f = (lastMeasurement?.findings ?? [])[0];
  if (!f) return "";
  const bits = [`${f.label} covers ${f.percent}% of the wall`];
  if (f.crackLengthMm != null) bits.push(`measures ${f.crackLengthMm} mm`);
  if (f.areaCm2 != null) bits.push(`covers ${f.areaCm2} cm²`);
  bits.push(`classified ${f.severity}`);
  return `SnapClaim: ${bits.join("; ")}. Every number cited by receipt.`;
}
function fillReportDoc(ok) {
  const gate = $("docGate");
  if (ok) { gate.textContent = "Gate pass"; gate.className = "badge ok"; }
  else { gate.textContent = "Pending"; gate.className = "badge wait"; }
  if (stillDataUrl) { const p = $("docPhoto"); p.src = stillDataUrl; p.style.display = "block"; }
  const t = $("transcriptBox").value.trim();
  const q = $("docQuote");
  if (t) { q.hidden = false; q.textContent = `“${t}”`; } else q.hidden = true;
  const d = new Date();
  $("docMeta").textContent = `Generated ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${lastMeasurement ? lastMeasurement.findings.length : 0} finding${lastMeasurement?.findings?.length === 1 ? "" : "s"}`;
  const f = (lastMeasurement?.findings ?? [])[0];
  if (f) {
    $("docRows").innerHTML =
      (f.crackLengthMm != null ? `<tr><th scope="row">Crack length</th><td>${esc(String(f.crackLengthMm))} mm</td><td><span class="badge ok">Confirmed</span></td></tr>` : "") +
      `<tr><th scope="row">Surface affected</th><td>${esc(String(f.percent))} %</td><td><span class="badge ok">Confirmed</span></td></tr>` +
      (f.areaCm2 != null ? `<tr><th scope="row">Area</th><td>${esc(String(f.areaCm2))} cm²</td><td><span class="badge ok">Confirmed</span></td></tr>` : "") +
      `<tr><th scope="row">Severity</th><td>${esc(String(f.severity))}</td><td><span class="badge ok">Confirmed</span></td></tr>`;
  }
}
function setShareCopyEnabled(on) {
  $("shareBtn").disabled = !on;
  $("copyBtn").disabled = !on;
}
$("shareBtn").onclick = async () => {
  const text = reportSummaryText();
  if (!text) return;
  try {
    if (navigator.share) await navigator.share({ title: "SnapClaim damage report", text });
    else throw new Error("no native share sheet");
  } catch {
    try { await navigator.clipboard.writeText(text); $("reportState").textContent = "Copied — no share sheet on this device."; }
    catch { $("reportState").textContent = "Sharing unavailable here — use Download SVG."; }
  }
};
$("copyBtn").onclick = async () => {
  const text = reportSummaryText();
  if (!text) return;
  try { await navigator.clipboard.writeText(text); $("reportState").textContent = "Summary copied to clipboard."; }
  catch { $("reportState").textContent = "Copy failed in this browser — select the summary manually."; }
};
$("newClaimBtn").onclick = () => {
  currentCaseId = null;
  autoChecksFor = null;
  payloadObj = null; lastMeasurement = null;
  dmg = { points: [], pointMasks: [], mask: null, iou: 0, source: null };
  gateCoin = null; stillDataUrl = ""; noScaleMode = false; coinLabel = "";
  setCoinSize(0);
  history.length = 0; smooth = null; coinSeen = false;
  $("transcriptBox").value = ""; $("heard").textContent = "";
  $("voiceErr").textContent = ""; $("raw").textContent = "{}";
  $("measured").innerHTML = ""; $("findings").innerHTML = ""; drawScheme([]);
  $("numPhotoOverlay").replaceChildren();
  $("skOut").innerHTML = ""; $("skStatus").textContent = ""; $("xStatus").textContent = "";
  const card = $("numPhotoCard"); if (card) card.hidden = true;
  $("annexWrap").innerHTML = `<img id="annexImg" alt="Generated report annexure" hidden />`;
  $("dl").style.display = "none"; $("dl").removeAttribute("href");
  $("docGate").textContent = "Pending"; $("docGate").className = "badge wait";
  $("docMeta").textContent = "Not generated yet";
  $("docPhoto").style.display = "none";
  $("docQuote").hidden = true;
  $("docRows").innerHTML = `<tr><th>Measurement</th><td>Generate the report to fill this in.</td></tr>`;
  $("reportState").textContent = "";
  setShareCopyEnabled(false);
  resetCheckState();
  backToCam();
  setLocked(true, "Add a coin for scale");
  acquireCamera();
};
$("renderBtn").onclick = async () => {
  if (!payloadObj) return;
  const state = $("reportState");
  state.textContent = "Generating report…";
  $("annexWrap").innerHTML = `<img id="annexImg" alt="Generated report annexure" hidden /><div class="skel" role="status" aria-label="Generating report"></div>`;
  setShareCopyEnabled(false);
  const body = JSON.parse(JSON.stringify(payloadObj));
  body.transcript = $("transcriptBox").value;
  // The annexure draws the measured outlines over the photo itself, embedded as a JPEG.
  if (body.overlay && photo) body.overlay.photoHref = photo.toDataURL("image/jpeg", 0.8);
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    let res, j;
    try {
      res = await fetch(base() + "/v1/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
      j = await res.json();
    } finally { clearTimeout(timer); }
    if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    // Preview renders in <img> (script-inert), but the downloaded .svg opens
    // as a document and would run embedded scripts. Strip scriptable content.
    const cleanSvg = String(j.result.svg)
      .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
      .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    const blob = new Blob([cleanSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = document.getElementById("annexImg");
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error("preview failed to render")); img.src = url; img.hidden = false; });
    document.querySelector("#annexWrap .skel")?.remove();
    const dl = $("dl");
    dl.href = url;
    dl.download = "snapclaim-annexure.svg";
    dl.style.display = "block";
    dl.textContent = "Download SVG annexure";
    fillReportDoc(true);
    setShareCopyEnabled(true);
    state.textContent = "";
    saveCaseFromReport();
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const what = name === "AbortError" ? "timed out after 30 s" : (e instanceof Error ? e.message : String(e));
    $("annexWrap").innerHTML = `<img id="annexImg" alt="Generated report annexure" hidden />
      <div class="statecard err" role="alert"><b>Report failed.</b><p style="margin:8px 0 12px;color:#5b6b8c">${esc(what)}</p><button class="btn-dark" type="button" id="renderRetry" style="width:100%">Retry</button></div>`;
    document.getElementById("renderRetry").onclick = () => $("renderBtn").click();
    state.textContent = "";
  }
};

/* ---------- sample (no camera) ---------- */
async function loadSample() {
  const sample = {
    component: { id: "wall-panel-north", areaPx: 480000, confidence: 0.93 },
    masks: [
      { id: "crack-1", label: "crack", areaPx: 24800, skeletonPx: 913, regionCount: 1, confidence: 0.88 },
      { id: "stain-1", label: "stain", areaPx: 6200, regionCount: 2, confidence: 0.71 },
    ],
    scaleReference: { id: "coin-27mm", knownMm: 27, lengthPx: 287, confidence: 0.88 },
  };
  try {
    const mres = await fetch(base() + "/v1/measure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample) });
    const measured = await mres.json();
    if (!mres.ok || !measured.ok) throw new Error(measured.error ?? mres.status);
    payloadObj = sample;
    fillPhotoCard();
    showMeasured(measured.result);
    show("sSay");
    startListening();
  } catch (e) { hint.textContent = `Sample failed (${e.message ?? e}). Is the backend reachable?`; }
}
/* ---------- local cases, tabs, settings (store.js) ---------- */
let caseStore;
try { caseStore = createCaseStore(localStorage); } catch { caseStore = createCaseStore({ getItem: () => null, setItem: () => {}, removeItem: () => {} }); }
let currentCaseId = null;
let dlgCaseId = null;
let swReg = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  $("appLive").textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}
function download(name, text, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function caseItem(c) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "caseitem";
  const when = new Date(c.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const meta = [c.label ? `${c.label} ${c.percent ?? "?"}%` : null, c.severity, when].filter(Boolean).join(" · ");
  // c.photo is a canvas data URL we wrote; never interpolate it raw — a
  // quote-breakout (" onerror=) would run on open. Validate before use.
  const img = document.createElement("img");
  img.alt = "";
  const span = document.createElement("span");
  const name = document.createElement("b");
  name.textContent = c.name ?? "Untitled case";
  const small = document.createElement("small");
  small.textContent = meta;
  span.append(name, small);
  if (typeof c.photo === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(c.photo)) {
    img.src = c.photo;
    b.append(img, span);
  } else {
    b.append(span);
  }
  b.onclick = () => openCase(c.id);
  return b;
}
function renderCases() {
  const cases = caseStore.list();
  const recent = $("recentList");
  recent.replaceChildren(...cases.slice(0, 3).map(caseItem));
  $("recentEmpty").style.display = cases.length ? "none" : "block";
  const list = $("caseList");
  list.replaceChildren(...cases.map(caseItem));
  $("caseEmpty").style.display = cases.length ? "none" : "block";
  if (cases.length) {
    $("nextTitle").textContent = "Start a new claim";
    $("nextSub").textContent = `${cases.length} case${cases.length === 1 ? "" : "s"} saved on this device.`;
  }
  updateStoreInfo();
}
async function updateStoreInfo() {
  const n = caseStore.list().length;
  const kb = Math.max(1, Math.round(caseStore.bytesUsed() / 1024));
  let quota = "";
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) quota = ` of ~${Math.round(est.quota / 1048576)} MB available to this site`;
  } catch { /* estimate is advisory */ }
  $("storeInfo").textContent = `Storage: ${n} case${n === 1 ? "" : "s"} · ~${kb} KB used${quota}. Saved cases and capture work offline; measuring and reports need a connection. Tapping damage sends the photo to the backend for outlining (falls back to on-device once its model has downloaded); cross-check and report attach also upload. First use contacts Google Fonts, jsDelivr and Hugging Face for fonts and on-device models.`;
  $("sc-store-meter").style.width = `${Math.min(100, (caseStore.bytesUsed() / (5 * 1048576)) * 100)}%`;
}
function showTab(id) {
  for (const s of ["sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"]) document.getElementById(s)?.classList.remove("on");
  for (const t of TAB_SCREENS) document.getElementById(t)?.classList.toggle("on", t === id);
  document.body.classList.add("tabbing");
  document.body.classList.remove("reviewing", "step2");
  for (const b of document.querySelectorAll("#tabs [data-tab]")) {
    if (b.dataset.tab === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  stopCamera();
  renderCases();
  syncNetPill();
}
function startCapture() {
  currentCaseId = null;
  backToCam();
  setLocked(true, "Add a coin for scale");
  acquireCamera();
}
function syncNetPill() {
  const pill = $("netPill");
  pill.textContent = navigator.onLine ? "Online" : "Offline";
  pill.className = `badge ${navigator.onLine ? "ok" : "wait"}`;
}
for (const b of document.querySelectorAll("#tabs [data-tab]")) {
  b.onclick = () => { if (b.dataset.tab === "capture") startCapture(); else showTab(b.dataset.tab); };
}
$("ctaNew").onclick = startCapture;
$("tabNew").onclick = startCapture;
$("ctaSample").onclick = () => { backToCam(); loadSample(); };
$("doneHome").onclick = () => showTab("tHome");
function openCase(id) {
  const c = caseStore.get(id);
  if (!c) return;
  dlgCaseId = id;
  $("dlgName").value = c.name ?? "";
  $("dlgProp").value = c.property ?? "";
  $("dlgNotes").value = c.notes ?? "";
  $("dlgPhotos").replaceChildren();
  if (typeof c.photo === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(c.photo)) {
    const img = document.createElement("img");
    img.src = c.photo;
    img.alt = "Case photo";
    $("dlgPhotos").append(img);
  } else {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = c.photoDropped ? "Photo was dropped to fit device storage." : "No photo saved for this case.";
    $("dlgPhotos").append(div);
  }
  $("caseDlg").showModal();
}
$("dlgClose").onclick = () => $("caseDlg").close();
$("dlgSave").onclick = () => {
  if (!dlgCaseId) return;
  caseStore.save({ id: dlgCaseId, name: $("dlgName").value.trim() || "Untitled case", property: $("dlgProp").value.trim(), notes: $("dlgNotes").value.trim() });
  renderCases();
  toast("Case saved on this device");
};
$("dlgDelete").onclick = () => {
  if (!dlgCaseId || !confirm("Delete this case? This cannot be undone.")) return;
  caseStore.remove(dlgCaseId);
  dlgCaseId = null;
  $("caseDlg").close();
  renderCases();
  toast("Case deleted");
};
$("dlgExport").onclick = () => {
  const c = dlgCaseId ? caseStore.get(dlgCaseId) : null;
  if (c) download(`snapclaim-case-${c.id}.json`, JSON.stringify(c, null, 2));
};
$("dlgAddPhoto").onclick = () => $("dlgFile").click();
$("dlgFile").addEventListener("change", () => {
  const file = $("dlgFile").files?.[0];
  $("dlgFile").value = "";
  if (!file || !dlgCaseId) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const side = Math.max(img.width, img.height) > 1024 ? 1024 / Math.max(img.width, img.height) : 1;
    const cap = document.createElement("canvas");
    cap.width = Math.round(img.width * side); cap.height = Math.round(img.height * side);
    cap.getContext("2d").drawImage(img, 0, 0, cap.width, cap.height);
    const saved = caseStore.save({ id: dlgCaseId, photo: cap.toDataURL("image/jpeg", 0.85), photoDropped: false });
    openCase(saved.id);
    renderCases();
    toast(saved.photoDropped ? "Photo too large for device storage — case kept without it" : "Photo updated");
  };
  img.src = url;
});
$("exportAllBtn").onclick = () => {
  if (!caseStore.list().length) { toast("No cases to export"); return; }
  download("snapclaim-cases.json", caseStore.exportAll());
};
$("wipeBtn").onclick = () => {
  if (!caseStore.list().length) { toast("No cases to delete"); return; }
  if (!confirm("Delete ALL cases from this device? Export first — there is no cloud copy.")) return;
  caseStore.clear();
  renderCases();
  toast("All cases deleted");
};
/* theme (theme.js applied it before paint; these buttons change it) */
function paintThemeButtons() {
  const theme = caseStore.getSettings().theme ?? document.documentElement.dataset.theme ?? "auto";
  for (const [id, v] of [["sc-theme-light", "light"], ["sc-theme-auto", "auto"], ["sc-theme-dark", "dark"]]) {
    $(id).classList.toggle("on", v === theme);
  }
}
for (const [id, v] of [["sc-theme-light", "light"], ["sc-theme-auto", "auto"], ["sc-theme-dark", "dark"]]) {
  $(id).onclick = () => {
    caseStore.setSettings({ theme: v });
    document.documentElement.dataset.theme = v;
    paintThemeButtons();
  };
}
paintThemeButtons();
/* settings: donate default, backend (single input), health, updates */
try { $("donateSetting").checked = !!localStorage.getItem("snapclaim.donatePhoto"); } catch { /* ignore */ }
$("donateSetting").onchange = () => {
  try {
    if ($("donateSetting").checked) localStorage.setItem("snapclaim.donatePhoto", "1");
    else localStorage.removeItem("snapclaim.donatePhoto");
  } catch { /* ignore */ }
  $("donateCheck").checked = $("donateSetting").checked;
};
syncBackendInputs();
$("baseUrl2").addEventListener("input", () => {
  // Commit while valid so base() never reads a rejected URL; surface the
  // security-policy message inline instead of silently keeping the old value.
  const draft = $("baseUrl2").value.trim().replace(/\/$/, "");
  if (draft === "") { $("setHealth").textContent = ""; return; }
  if (isAllowedBackendUrl(draft)) {
    try { setBackendUrl(draft); } catch { /* validated above */ }
    $("setHealth").textContent = "";
  } else {
    $("setHealth").textContent = POLICY_BACKEND_MESSAGE;
  }
});
async function checkBackend() {
  // The Settings Check button validates the visible draft: with an invalid
  // draft still in the box, reporting "ok" for the last good value would lie.
  const draft = $("baseUrl2").value.trim().replace(/\/$/, "");
  if (!isAllowedBackendUrl(draft)) {
    $("setHealth").textContent = POLICY_BACKEND_MESSAGE;
    $("healthOut").textContent = POLICY_BACKEND_MESSAGE;
    syncNetPill();
    return;
  }
  let b;
  try {
    b = setBackendUrl(draft);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    $("setHealth").textContent = msg;
    $("healthOut").textContent = msg;
    syncNetPill();
    return;
  }
  try {
    const r = await fetch(b + "/v1/health");
    const j = await r.json();
    $("setHealth").textContent = `ok v${j.version} mode:${j.mode}`;
    $("healthOut").textContent = $("setHealth").textContent;
  } catch { $("setHealth").textContent = "unreachable — check the URL and your connection"; }
  syncNetPill();
}
$("setCheck").onclick = checkBackend;
$("updateBtn").onclick = async () => {
  if (!swReg) { toast("Service worker not registered yet — reload once, then check again"); return; }
  await swReg.update().catch(() => {});
  toast($("updateBar").hidden ? "You are on the latest version" : "Update ready — tap Reload at the top");
};
function saveCaseFromReport() {
  const f = (lastMeasurement?.findings ?? [])[0];
  if (!f) return;
  const saved = caseStore.save({
    id: currentCaseId ?? undefined,
    name: `${String(f.label).charAt(0).toUpperCase() + String(f.label).slice(1)} — ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`,
    transcript: $("transcriptBox").value.trim(),
    label: String(f.label), percent: f.percent, severity: String(f.severity),
    crackLengthMm: f.crackLengthMm ?? null, areaCm2: f.areaCm2 ?? null,
    mode: lastMeasurement?.mode ?? "", photo: stillDataUrl || null,
  });
  currentCaseId = saved.id;
  renderCases();
  toast(saved.photoDropped ? "Case saved without photo (device storage full)" : "Case saved on this device");
}

/* ---------- offline banner + service-worker update flow ---------- */
function syncOfflineBar() { $("offlineBar").hidden = navigator.onLine; syncNetPill(); }
window.addEventListener("online", syncOfflineBar);
window.addEventListener("offline", syncOfflineBar);
syncOfflineBar();
let waitingSw = null;
let reloading = false;
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      swReg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) { waitingSw = reg.waiting; $("updateBar").hidden = false; }
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) { waitingSw = sw; $("updateBar").hidden = false; }
        });
      });
    } catch { /* the app still runs uncached */ }
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}
$("updateGo").onclick = () => { if (waitingSw) waitingSw.postMessage("SKIP_WAITING"); };
// Land on Home; the camera starts from New (tab bar or Home CTA), so arrival
// never triggers a permission prompt before the user asks for it.
showTab("tHome");
