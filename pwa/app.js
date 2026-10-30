import { checkPhoto } from "./photo-check.js";
import { decodeRle } from "./rle.js";
import { mountTiltMeter, tiltFromOrientation, tiltZone } from "./tilt-meter.js";

const $ = (id) => document.getElementById(id);
mountTiltMeter($("tiltMeter")); // live level over the camera; hidden without orientation sensors
let payloadObj = null;
let lastMeasurement = null;
function base() { return $("baseUrl").value.replace(/\/$/, ""); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/* ---------- navigation ---------- */
// Home, then four steps: Photo (camera + review), Mark, Describe, Report. The camera sits under every screen.
const SCREENS = ["sHome", "sReview", "sMark", "sSay", "sReport"];
function show(id) {
  for (const s of SCREENS) document.getElementById(s)?.classList.toggle("on", s === id);
}
function backToCam() {
  for (const s of SCREENS) document.getElementById(s)?.classList.remove("on");
}
const COIN_ASK = "Put a coin next to the damage";

/* ---------- backend ---------- */
$("healthBtn").onclick = async () => {
  try {
    const r = await fetch(base() + "/v1/health");
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
const COUNTRIES = ["INR", "USA", "EUR", "GBP"];
let coinLabel = "";
let gateCoin = null; // {cx, cy, rr} in capture-still pixels + still size
let photo = null;    // downscaled capture canvas for marking
let stillDataUrl = "";

/* Guided capture: each tick is a signal the app actually reads, never a promise. */
const ckCoin = $("ckCoin"), ckSteady = $("ckSteady"), ckLevel = $("ckLevel");
function updateChecklist() {
  ckCoin.hidden = ckSteady.hidden = noScaleMode;
  ckCoin.classList.toggle("on", coinSeen || (lastDetAt > 0 && scanCount - lastDetAt < 5));
  ckSteady.classList.toggle("on", coinSeen);
}
window.addEventListener("deviceorientation", (e) => {
  const deg = tiltFromOrientation(e.beta, e.gamma);
  if (deg == null) return; // no sensor readings: the level tick stays hidden
  ckLevel.hidden = false;
  ckLevel.classList.toggle("on", tiltZone(deg) === "ok");
});

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
  if (!navigator.mediaDevices?.getUserMedia) { explainCam({ name: "unsupported" }); return; }
  const backCam = { video: { facingMode: { exact: "environment" } }, audio: false };
  const anyCam = { video: { facingMode: "environment" }, audio: false };
  navigator.mediaDevices.getUserMedia(backCam)
    .catch(() => navigator.mediaDevices.getUserMedia(anyCam))
    .then((stream) => {
      camStream = stream;
      stream.oninactive = () => {
        if (camStream !== stream) return; // stopped on purpose (closed, captured)
        coinSeen = false; smooth = null; history.length = 0; cancelCapture();
        setLocked(true, COIN_ASK);
        explainCam({ name: "stopped" });
      };
      feed.srcObject = stream;
      return feed.play().then(() => {
        $("enableCam").style.display = "none";
        startScan();
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
    const best = clf.predict(fv, { countries: COUNTRIES })[0];
    if (best && best.label !== "unknown") {
      const def = CoinModel.DB.find((d) => d.id === best.label);
      coinLabel = def ? `${def.label} · Ø${def.diam} mm` : best.label;
      hint.textContent = `${coinLabel} (${Math.round(best.confidence * 100)}%) — hold steady…`;
      // Preselect the matching coin on the mark screen; the user still confirms it there.
      const opt = def && [...$("coinKind").options].find((o) => Math.abs(Number(o.value) - def.diam) < 0.05);
      if (opt) $("coinKind").value = opt.value;
    } else { coinLabel = ""; hint.textContent = "Coin found — hold steady…"; }
  } catch { /* ID is advisory; the gate stands on geometry */ }
}
// One scan loop for the page's life: reopening the camera must not start a second one.
let scanning = false;
function startScan() { if (!scanning) { scanning = true; scan(); } }
function scan() {
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

function scanFrame() {
  const fw = SW, fh = Math.round((SW * feed.videoHeight) / feed.videoWidth);
  work.width = fw; work.height = fh;
  wctx.drawImage(feed, 0, 0, fw, fh);
  const img = wctx.getImageData(0, 0, fw, fh);
  // Tap-to-assist narrows the search window; without it, whole frame.
  const edge = grayEdges(img.data, fw, fh);
  let found = null;
  if (assistPt) {
    const r = Math.round(fw * 0.25);
    const x0 = Math.max(0, Math.round(assistPt.x - r)), x1 = Math.min(fw, Math.round(assistPt.x + r));
    const y0 = Math.max(0, Math.round(assistPt.y - r)), y1 = Math.min(fh, Math.round(assistPt.y + r));
    const sub = new Uint8Array((x1 - x0) * (y1 - y0));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sub[(y - y0) * (x1 - x0) + (x - x0)] = edge[y * fw + x];
    const sub0 = findRing(sub, x1 - x0, y1 - y0);
    if (sub0) found = { cx: sub0.cx + x0, cy: sub0.cy + y0, rr: sub0.rr, score: sub0.score };
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
    updateChecklist();
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
    setLocked(true, COIN_ASK);
  }
  updateChecklist();
}
// Tap-to-assist: tapping the viewfinder narrows the search to that spot.
// The ring must still be detected there — a tap alone never unlocks.
document.getElementById("cam").addEventListener("pointerdown", (ev) => {
  if (coinSeen || !feed.videoWidth) return;
  const r = feed.getBoundingClientRect();
  const fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
  const fw = SW, fh = Math.round((SW * feed.videoHeight) / feed.videoWidth);
  const vw = feed.videoWidth, vh = feed.videoHeight;
  const scale = Math.max(vw / fw, vh / fh);
  const ox = (vw - fw * scale) / 2 / scale, oy = (vh - fh * scale) / 2 / scale;
  assistPt = {
    x: Math.max(0, Math.min(fw, fx * vw / scale - ox)),
    y: Math.max(0, Math.min(fh, fy * vh / scale - oy)),
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
  $("reviewNote").textContent = gateCoin
    ? `Coin locked${coinLabel ? ` (${coinLabel})` : ""}. Check the damage is sharp.`
    : "No coin, so the report gives percentages, not millimetres.";
  const flash = $("flash");
  flash.classList.add("go");
  setTimeout(() => { show("sReview"); flash.classList.remove("go"); }, 160);
});

/** Back to a fresh viewfinder. Keeps the coin / no-coin choice. */
function openCamera() {
  backToCam();
  coinSeen = false; smooth = null; coinLabel = ""; gateCoin = null; stillDataUrl = "";
  history.length = 0;
  cancelCapture();
  if (noScaleMode) setLocked(false, "No coin: percentages only. Tap to snap.");
  else setLocked(true, COIN_ASK);
  updateChecklist();
  acquireCamera();
}
$("retake").onclick = openCamera;
$("usePhoto").onclick = () => { show("sMark"); setupMarkPhoto(); };
$("backCam").onclick = openCamera;
$("startBtn").onclick = openCamera;
$("camClose").onclick = () => { cancelCapture(); stopCamera(); show("sHome"); };
$("altEntry").onclick = () => { loadSample(); };

/* ---------- the website in front of the app ---------- */
// Every "Start a claim" / "See a sample" on the site goes through the same two paths.
const menu = document.querySelector(".menu");
for (const b of document.querySelectorAll("[data-start]")) b.addEventListener("click", () => { if (menu) menu.open = false; openCamera(); });
for (const b of document.querySelectorAll("[data-sample]")) b.addEventListener("click", () => { if (menu) menu.open = false; loadSample(); });
for (const a of document.querySelectorAll(".menu .panel a")) a.addEventListener("click", () => { menu.open = false; });
// Footer audience links open their tab.
for (const a of document.querySelectorAll("[data-tab]")) a.addEventListener("click", () => { const r = $(a.dataset.tab); if (r) r.checked = true; });
// Quick starts in the describe composer.
for (const b of document.querySelectorAll("[data-say]")) b.addEventListener("click", () => { const box = $("transcriptBox"); box.value = b.dataset.say; box.focus(); });
// Sections fade up as they scroll in; the numbers band counts up once.
{
  const items = document.querySelectorAll("#sHome .rv");
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        if (e.target.querySelector("[data-count]")) countUp(e.target);
        io.unobserve(e.target);
      }
    }, { root: $("sHome"), threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    items.forEach((el) => io.observe(el));
  } else items.forEach((el) => el.classList.add("in"));
}
function setScaleMode(none) {
  noScaleMode = none;
  $("withCoin").classList.toggle("on", !none); $("withCoin").setAttribute("aria-pressed", String(!none));
  $("noCoin").classList.toggle("on", none); $("noCoin").setAttribute("aria-pressed", String(none));
  cancelCapture();
  if (none) { gateCoin = null; setLocked(false, "No coin: percentages only. Tap to snap."); }
  else { coinSeen = false; smooth = null; history.length = 0; setLocked(true, COIN_ASK); }
  updateChecklist();
}
$("noCoin").onclick = () => setScaleMode(true);
$("withCoin").onclick = () => setScaleMode(false);

/* ---------- mark damage (photo canvas + SlimSAM taps) ---------- */
const MAX_SIDE = 512;
let embeddings = null; // true once the worker has embedded the current photo
let dmg = { points: [], pointMasks: [], mask: null, iou: 0, source: null };
let dmgLabel = "crack";

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
    if (data.type === "progress") $("tfState").textContent = data.percent >= 100 ? "Preparing the on-device outliner…" : `Downloading the on-device outliner… ${data.percent}%`;
    else if (data.type === "ready") {
      embeddings = true;
      $("tfState").textContent = "";
      console.info(`[sam] embedded on ${data.device} in ${data.embedMs} ms`);
    } else if (data.type === "error") {
      $("tfState").textContent = `On-device outliner unavailable (${data.message}).`;
    }
  };
  samWorker.onerror = (e) => { $("tfState").textContent = `On-device outliner failed to start (${e.message ?? "worker error"}).`; };
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
    drawMark();
    syncTapButtons();
    $("measureBtn").disabled = true;
    $("coinField").hidden = !gateCoin; // no coin, no coin to confirm
    $("photoNotes").textContent = "";
    setStatus("Tap the damage to outline it.");
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
  if (!res.ok || !j.ok) throw new Error(j.error ?? `segment HTTP ${res.status}`);
  const rec = j.result?.records?.[0];
  if (!rec) throw new Error("SAM found nothing there — tap the middle of the damage and retry.");
  return { mask: decodeRle(rec.rle), iou: rec.confidence ?? 0, rle: rec.rle };
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
  // auto coin outline from the gate (green ring)
  if (gateCoin) {
    const kx = photo.width / gateCoin.sw, ky = photo.height / gateCoin.sh;
    const cx = (gateCoin.cx / gateCoin.fw) * gateCoin.sw * kx;
    const cy = (gateCoin.cy / gateCoin.fh) * gateCoin.sh * ky;
    const r = (gateCoin.rr / gateCoin.fw) * gateCoin.sw * kx;
    ctx.strokeStyle = "#0e8a4d"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = "#c81e2b"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  for (const [x, y] of dmg.points) {
    ctx.beginPath(); ctx.arc(x, y, Math.max(5, c.width / 120), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  $("measureBtn").disabled = !dmg.mask;
}
function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("err", isError);
}
function syncTapButtons() {
  $("undoBtn").disabled = !dmg.points.length;
  $("clearBtn").disabled = !dmg.points.length;
}
/** Outlines all taps so far; on failure the last tap is dropped (when dropOnFail) so a bad tap never sticks. */
async function outline(dropOnFail) {
  setStatus("Outlining…");
  // SAM 3.1 API first; the on-device model only when the API call fails.
  let out = null, source = "api";
  try {
    out = await segmentViaApi(dmg.points);
  } catch (e) {
    console.info("[sam] API failed, using on-device", e);
    source = "device";
    if (!embeddings) {
      if (dropOnFail) dmg.points.pop();
      setStatus("The outlining model is still loading. Tap again in a moment.");
      drawMark(); syncTapButtons();
      return;
    }
    try { out = await segmentOnDevice(); } catch { out = null; }
  }
  if (out) {
    dmg.mask = out.mask; dmg.iou = out.iou; dmg.source = source;
    const n = dmg.points.length;
    setStatus(`Outlined · ${n} tap${n === 1 ? "" : "s"} · ${Math.round(dmg.iou * 100)}% sure`);
    $("status").title = source === "api" ? "Outlined by SAM 3.1" : "Outlined on this phone";
  } else { dmg.mask = null; dmg.source = null; setStatus("Nothing outlined there. Tap the middle of the damage.", true); }
  drawMark(); syncTapButtons();
}
$("markCanvas").addEventListener("pointerdown", (ev) => {
  if (!photo) return;
  const c = $("markCanvas"), r = c.getBoundingClientRect();
  const x = Math.round((ev.clientX - r.left) * (c.width / r.width));
  const y = Math.round((ev.clientY - r.top) * (c.height / r.height));
  dmg.points.push([x, y]);
  drawMark();
  outline(true);
});
$("undoBtn").onclick = () => {
  dmg.points.pop();
  dmg.pointMasks.length = Math.min(dmg.pointMasks.length, dmg.points.length);
  if (dmg.points.length) { outline(false); return; }
  dmg.mask = null; dmg.source = null;
  setStatus("Tap the damage to outline it.");
  drawMark(); syncTapButtons();
};
$("clearBtn").onclick = () => {
  dmg = { points: [], pointMasks: [], mask: null, iou: 0, source: null };
  setStatus("Tap the damage to outline it.");
  drawMark(); syncTapButtons();
};
for (const [id, label] of [["chipCrack", "crack"], ["chipStain", "stain"], ["chipPeel", "peel"], ["chipDent", "dent"]]) {
  $(id).onclick = () => {
    dmgLabel = label;
    for (const o of ["chipCrack", "chipStain", "chipPeel", "chipDent"]) {
      $(o).classList.toggle("on", o === id);
      $(o).setAttribute("aria-pressed", String(o === id));
    }
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
let skepticTally = null; // { agreed, disputed } from the last skeptic run, for the report

$("measureBtn").onclick = async () => {
  if (!dmg.mask) return;
  checkPhotoNotes();
  const w = photo.width, h = photo.height;
  // Measuring takes a second or two: the button says so, and the page stays put until numbers exist.
  const btn = $("measureBtn");
  btn.disabled = true; btn.classList.add("busy"); btn.textContent = "Measuring…";
  const done = () => { btn.classList.remove("busy"); btn.textContent = "Measure it"; btn.disabled = !dmg.mask; };
  $("measured").innerHTML = "";
  const body = { masks: [{ id: "damage-1", label: dmgLabel, rle: encodeRle(dmg.mask, w, h), confidence: dmg.iou || 0.8 }] };
  let circleRef = null;
  if (gateCoin) {
    const kx = w / gateCoin.sw, ky = h / gateCoin.sh;
    const cx = (gateCoin.cx / gateCoin.fw) * gateCoin.sw * kx;
    const cy = (gateCoin.cy / gateCoin.fh) * gateCoin.sh * ky;
    const r = Math.max(3, (gateCoin.rr / gateCoin.fw) * gateCoin.sw * kx);
    circleRef = { id: "coin", rle: circleRle(cx, cy, r, w, h), knownMm: Number($("coinKind").value), confidence: 0.85 };
    // The coin's real outline, not the gate's circle: a tilted wall shows the coin as an
    // ellipse, and the backend uses that ellipse to correct the crack lengths.
    const traced = await traceCoin(cx, cy, r, w, h);
    body.reference = traced ? { ...circleRef, rle: encodeRle(traced.mask, w, h), confidence: traced.iou } : circleRef;
  } else if (noScaleMode) body.note = "percent-only requested";
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
    reportKey = "";
    showMeasured(lastMeasurement);
    done();
    show("sSay");
  } catch (e) {
    done();
    setStatus(`Measuring failed (${e.message ?? e}). Tap Measure to try again.`, true);
  }
};
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
  if (area < circle * 0.4 || area > circle * 1.6) return null;
  if (Math.hypot(sx / area - cx, sy / area - cy) > r * 0.5) return null;
  return out;
}

/** A number that counts up into place; the final text is in the markup, so it reads right without the motion. */
function num(value, unit) {
  return `<b data-count="${esc(String(value))}" data-unit="${esc(unit)}">${esc(String(value))}${esc(unit)}</b>`;
}
/** Receipts are "R001" in the ledger; models cite them as "r1". One key for both. */
function receiptKey(id) { return String(id).trim().toLowerCase().replace(/^r0*(\d+)$/, "r$1"); }
function rid(id) { return id ? `<code class="rid" title="Receipt ${esc(id)}">${esc(id)}</code>` : ""; }
const cap = (s) => { const t = String(s); return t.charAt(0).toUpperCase() + t.slice(1); };
const sevChip = (s) => `<span class="sev sev-${esc(String(s))}">${esc(String(s))}</span>`;
/** The card in the chat: one big number (length with a coin, share of the wall without), then the rest as facts. */
function measuredCard(f, more) {
  const big = f.crackLengthMm != null ? num(f.crackLengthMm, " mm") : num(f.percent, "%");
  const facts = [
    f.crackLengthMm != null && `${esc(String(f.percent))}% of the wall`,
    f.crackLengthMm == null && "No coin, so no millimetres",
    f.areaCm2 != null && `${esc(String(f.areaCm2))} cm² area`,
    f.crackWidthMm != null && `${esc(String(f.crackWidthMm))} mm wide`,
    `${esc(String(f.regionCount ?? 1))} region${(f.regionCount ?? 1) === 1 ? "" : "s"}`,
    more > 0 && `+${more} more finding${more === 1 ? "" : "s"}`,
  ].filter(Boolean).map((t) => `<span>${t}</span>`).join("");
  return `<span class="lbl">${esc(cap(f.label))} · ${f.crackLengthMm != null ? "length" : "of the wall"}</span>
    <div class="big">${big}${sevChip(f.severity)}</div><div class="facts">${facts}</div>`;
}
/** Stripe-style count-up, same decimals as the measured value; skipped under reduced motion. */
function countUp(root) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of root.querySelectorAll("[data-count]")) {
    const target = Number(el.dataset.count);
    if (!Number.isFinite(target)) continue;
    const dp = (el.dataset.count.split(".")[1] || "").length;
    const unit = el.dataset.unit || "";
    const t0 = performance.now(), ms = 700;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (k < 1 ? (target * e).toFixed(dp) : el.dataset.count) + unit;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

function receiptChips(receipts) {
  return (receipts || []).slice(0, 12).map((r) => `<code>${esc(r.id)} · ${esc(String(r.output?.value ?? ""))} ${esc(r.output?.unit ?? "")}</code>`).join("");
}
/** Receipts folded away: the proof is one tap off, not in the way. */
function receiptsBlock(receipts) {
  const n = (receipts || []).length;
  if (!n) return "";
  return `<details class="ticker"><summary><span class="mono">${n}</span> receipt${n === 1 ? "" : "s"} behind these numbers</summary>` +
    `<div class="receipts" aria-label="Receipts">${receiptChips(receipts)}</div></details>`;
}

function fillPhotoCard() {
  const card = $("numPhotoCard");
  if (!card) return;
  card.hidden = !stillDataUrl;
  if (!stillDataUrl) return;
  // The marked photo (outline + coin ring) when there is one: it shows what was measured.
  let src = stillDataUrl;
  if (photo && dmg.mask) { try { src = $("markCanvas").toDataURL("image/jpeg", 0.85); } catch { /* keep the still */ } }
  $("numPhoto").src = src;
  $("numChip").textContent = coinLabel ? `Scale: ${coinLabel}` : (gateCoin ? "Scale: coin" : "Outlined damage");
}
function showMeasured(result) {
  fillPhotoCard();
  const first = result.findings[0];
  $("measured").innerHTML = first
    ? measuredCard(first, result.findings.length - 1)
    : `<span class="lbl">Nothing measurable</span><p style="margin-top:6px">Go back and tap the middle of the damage.</p>`;
  countUp($("measured"));
  $("thread").scrollTop = 0;
}
/** Bars compare findings, so the chart only appears when there are two or more. */
function drawScheme(findings) {
  const svg = $("scheme");
  svg.innerHTML = "";
  const rows = findings.slice(0, 8);
  svg.hidden = rows.length < 2;
  if (svg.hidden) return;
  const NS = "http://www.w3.org/2000/svg";
  const color = (s) => s === "significant" ? "var(--damage)" : s === "moderate" ? "#d9822b" : "var(--go)";
  const max = Math.max(...rows.map((f) => f.percent ?? 0), 0.01);
  svg.setAttribute("viewBox", `0 0 400 ${16 + rows.length * 30}`);
  rows.forEach((f, i) => {
    const y = 12 + i * 30;
    const track = document.createElementNS(NS, "rect");
    track.setAttribute("x", "116"); track.setAttribute("y", String(y)); track.setAttribute("rx", "5");
    track.setAttribute("width", "220"); track.setAttribute("height", "14");
    track.style.fill = "var(--sand-deep)";
    svg.appendChild(track);
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", "116"); rect.setAttribute("y", String(y)); rect.setAttribute("rx", "5");
    rect.setAttribute("width", String(Math.max(6, (220 * (f.percent ?? 0)) / max))); rect.setAttribute("height", "14");
    rect.style.fill = color(f.severity);
    svg.appendChild(rect);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", "14"); t.setAttribute("y", String(y + 11.5));
    t.setAttribute("font-size", "13"); t.setAttribute("font-weight", "700"); t.setAttribute("fill", "currentColor");
    t.textContent = String(f.label);
    svg.appendChild(t);
    const v = document.createElementNS(NS, "text");
    v.setAttribute("x", "386"); v.setAttribute("y", String(y + 11.5)); v.setAttribute("text-anchor", "end");
    v.setAttribute("font-size", "12.5"); v.setAttribute("fill", "currentColor");
    v.textContent = `${f.percent}%`;
    svg.appendChild(v);
  });
}

/* ---------- mic + transcribe ---------- */
const mic = $("micBtn"), micState = $("micState"), heard = $("heard"), wave = $("wave");
const NBARS = 28, barEls = [];
for (let i = 0; i < NBARS; i++) { const b = document.createElement("i"); wave.appendChild(b); barEls.push(b); }
let micTimer = null, micStream = null, micReady = false, listening = false, analyser = null, analyserData = null;
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
setInterval(() => { if ($("sSay").classList.contains("on")) paintWave(); }, 90);
/** Small notices (mic blocked, nothing heard) live under the mic, not in the transcript headline. */
function voiceNote(text) { $("voiceErr").textContent = text; }
async function ensureMic() {
  if (micReady) return true;
  if (!navigator.mediaDevices?.getUserMedia) { micState.textContent = "Mic off"; voiceNote("No microphone on this device. Type the line below."); return false; }
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
  } catch { micState.textContent = "Mic off"; voiceNote("The mic is blocked. Allow it in the browser, or type the line below."); return false; }
}
function stopListening(landed, text) {
  clearTimeout(micTimer); micTimer = null; listening = false;
  document.getElementById("micwrap").classList.remove("live");
  micState.textContent = landed ? "Heard" : "Tap to talk";
  if (landed) heard.textContent = text ?? "";
}
/** The composer's listening row also shows while asking for the mic and transcribing. */
function micWorking(on) { $("micwrap").classList.toggle("working", on); }
async function startListening() {
  if (listening) return;
  voiceNote("");
  micWorking(true);
  micState.textContent = "Asking for the mic…";
  const ok = await ensureMic();
  micWorking(false);
  if (!ok) return;
  listening = true;
  document.getElementById("micwrap").classList.add("live");
  micState.textContent = "Listening";
  heard.textContent = "";
  recorderStart();
  micTimer = setTimeout(() => finishListening(true), 8000);
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
  if (!landed || clip.size === 0) { if (landed) voiceNote("Didn't catch anything. Tap the mic to try again, or type it."); return; }
  micState.textContent = "Transcribing…";
  micWorking(true);
  try { await transcribeClip(clip); } finally { micWorking(false); micState.textContent = "Tap to talk"; }
}
async function transcribeClip(clip) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(await clip.arrayBuffer());
    const off = new OfflineAudioContext(1, Math.ceil(Math.min(decoded.duration, 10) * 16000), 16000);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start(0, 0, Math.min(decoded.duration, 10));
    const rendered = await off.startRendering();
    ctx.close().catch(() => {});
    // On the device first (Whisper in voice-worker.js): the voice never leaves the phone
    // and it works without the backend key. The server transcriber is the fallback.
    try {
      // Whisper writes non-speech as tags like [Music] or (wind blowing); those are not words.
      const local = (await transcribeOnDevice(rendered.getChannelData(0).slice())).replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim();
      if (local) landTranscript(local); else voiceNote("Didn't catch anything. Tap the mic to try again, or type it.");
      return;
    } catch (e) { console.info(`[voice] on-device failed, trying the server: ${e.message ?? e}`); }
    micState.textContent = "Transcribing…";
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
    if (res.status === 503) { $("voiceErr").textContent = "Voice needs the backend API key — type the line."; $("transcriptBox").value = ""; return; }
    if (!res.ok || !j.ok) throw new Error(j.error ?? res.status);
    const text = String(j.result?.transcript ?? "").trim();
    if (!text) { voiceNote("Didn't catch anything. Tap the mic to try again, or type it."); return; }
    landTranscript(text);
  } catch (e) { $("voiceErr").textContent = `Transcription failed — type the line. (${e.message ?? e})`; }
}
function landTranscript(text) {
  $("transcriptBox").value = text;
  heard.textContent = text;
  micState.textContent = "Heard";
  heard.scrollIntoView({ block: "end", behavior: "smooth" });
}
// Typing shows up as the user's reply in the chat, same as a spoken line.
$("transcriptBox").addEventListener("input", () => { heard.textContent = $("transcriptBox").value.trim(); });
$("transcriptBox").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("sendBtn").click(); } });
let voiceWorker = null, voiceId = 0;
/** Mono 16 kHz samples → text, on the device. Empty string means nothing heard. */
function transcribeOnDevice(audio) {
  voiceWorker ??= new Worker(new URL("./voice-worker.js", import.meta.url), { type: "module" });
  const id = voiceId++;
  return new Promise((resolve, reject) => {
    voiceWorker.onmessage = ({ data }) => {
      if (data.type === "progress") micState.textContent = `Downloading speech model… ${data.percent}%`;
      else if (data.type === "transcribed" && data.id === id) data.error ? reject(new Error(data.error)) : resolve(data.text);
    };
    voiceWorker.onerror = (e) => reject(new Error(e.message ?? "speech worker failed to start"));
    voiceWorker.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  });
}
mic.onclick = () => { if (listening) finishListening(true); else startListening(); };
// The summary and both checks are billed calls: going back and forward again with the same
// measurement and the same line reuses them instead of paying twice.
let reportKey = "";
$("sendBtn").onclick = () => {
  if (listening) finishListening(true);
  if (!lastMeasurement) return;
  const key = JSON.stringify([payloadObj, $("transcriptBox").value.trim()]);
  show("sReport");
  if (key === reportKey) return;
  reportKey = key;
  resetRender();
  fillReportDoc();
  runReport();
};
$("backMark").onclick = () => show(photo ? "sMark" : "sHome");
$("backSay").onclick = () => show("sSay");

/* ---------- report / skeptic / render ---------- */
async function runReport() {
  if (!payloadObj) return;
  const ask = reportKey;
  $("findings").innerHTML = `<div class="skel"></div><div class="skel" style="width:70%"></div>`;
  const body = JSON.parse(JSON.stringify(payloadObj));
  body.transcript = $("transcriptBox").value;
  let res, j;
  try {
    res = await fetch(base() + "/v1/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    j = await res.json();
  } catch { j = { ok: false, error: "backend unreachable" }; res = { status: 0 }; }
  if (ask !== reportKey) return; // a newer report started meanwhile
  $("raw").textContent = JSON.stringify(j, null, 2);
  if (res.status === 503 || !res.ok || !j.ok) {
    const fails = res.status === 503 ? [j.error ?? "API key missing"] : (j.details ?? j.failures ?? [j.error]);
    const reasons = (Array.isArray(fails) ? fails : [fails]).map((f) => `<li>${esc(typeof f === "string" ? f : JSON.stringify(f))}</li>`).join("");
    $("findings").innerHTML = res.status === 503
      ? `<p class="muted"><span class="chip wait">Unavailable</span> The measurements stand on their own. The written summary needs the backend's API key.</p><ul>${reasons}</ul>`
      : `<p class="muted"><span class="chip fail">Held back</span> The summary was blocked because a sentence didn't cite a measured number:</p><ul>${reasons}</ul>`;
  } else {
    lastMeasurement = j.result.measurement ?? lastMeasurement;
    const drafts = (j.result.findings ?? []).filter((f) => f && typeof f.statement === "string" && f.statement.trim());
    $("findings").innerHTML = drafts.length
      ? drafts.map((d) => `<p>${esc(d.statement)} ${(d.citations ?? []).map(rid).join(" ")}</p>`).join("") +
        `<p style="margin-top:8px"><span class="chip ok">Every number cited</span></p>`
      : `<p class="muted">No written summary came back. The measurements above stand on their own.</p>`;
    fillReportDoc();
    if (lastMeasurement) {
      fetch(base() + "/v1/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findings: lastMeasurement.findings.length, mode: lastMeasurement.mode }),
      }).catch(() => {});
    }
  }
  runChecksAuto();
}
function resetCheckState() {
  checkState = { skeptic: "idle", xcheck: "idle" };
  skepticTally = null;
  delete $("xState").dataset.verdict;
  renderCheckCard();
  updateReportGate();
}
function setCheck(which, state, html) {
  checkState[which] = state;
  renderCheckCard();
  updateReportGate();
  void html;
}
function verdictBadge(verdict) {
  if (verdict === "AGREED") return `<span class="chip ok">Agreed</span>`;
  if (verdict === "DISPUTED") return `<span class="chip fail">Disputed</span>`;
  return `<span class="chip wait">Pending</span>`;
}
function checkStates() {
  return [
    { key: "skeptic", title: "Independent skeptic", el: $("skStatus"), out: $("skOut") },
    { key: "xcheck", title: "Mask cross-check", el: $("xStatus"), out: null },
  ];
}
const CHECK_CHIP = { idle: ["wait", "Waiting"], loading: ["wait spin", "Checking"], ok: ["ok", "Done"], error: ["fail", "Failed"] };
function renderCheckCard() {
  const s = $("skStatus");
  if (!s) return;
  if (checkState.skeptic === "loading") s.textContent = "Asking the skeptic model…";
  const x = $("xStatus");
  if (x && checkState.xcheck === "loading") x.textContent = "Outlining the same taps with the second model…";
  // header chips; a finished cross-check shows its verdict instead of "Done"
  for (const [key, id] of [["skeptic", "skState"], ["xcheck", "xState"]]) {
    const el = $(id);
    if (!el || (key === "xcheck" && checkState.xcheck === "ok" && el.dataset.verdict)) continue;
    const [cls, text] = CHECK_CHIP[checkState[key]] ?? CHECK_CHIP.idle;
    el.className = `chip ${cls}`; el.textContent = text;
  }
}
/** The report file waits for both checks (a failed check counts as finished: it shows in the report). */
function updateReportGate() {
  const btn = $("renderBtn");
  const done = (k) => checkState[k] === "ok" || checkState[k] === "error";
  const finished = done("skeptic") && done("xcheck");
  if (!btn.classList.contains("busy")) {
    btn.disabled = !finished || !payloadObj;
    btn.textContent = finished ? "Create report file" : "Waiting for the checks…";
  }
  const gate = $("docGate");
  const disputed = (skepticTally?.disputed ?? 0) > 0 || $("xState").dataset.verdict === "DISPUTED";
  const failed = checkState.skeptic === "error" || checkState.xcheck === "error";
  const [cls, text] = !lastMeasurement ? ["wait", "Pending"]
    : !finished ? ["wait spin", "Checking"]
    : disputed ? ["fail", "Disputed"]
    : failed ? ["warn", "Check failed"]
    : ["ok", "Checked"];
  gate.className = `chip ${cls}`; gate.textContent = text;
}
async function runSkeptic(auto) {
  if (checkState.skeptic === "loading") return;
  if (!lastMeasurement) { if (!auto) $("skStatus").textContent = "run report first"; return; }
  checkState.skeptic = "loading";
  renderCheckCard(); updateReportGate();
  $("skOut").innerHTML = `<div class="skel" role="status" aria-label="Skeptic is checking"></div>`;
  try {
    const res = await fetch(base() + "/v1/skeptic", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcript: $("transcriptBox").value,
        findings: lastMeasurement.findings,
        receipts: lastMeasurement.receipts,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    skepticTally = { agreed: 0, disputed: 0, disputedIds: new Set() };
    const rows = (j.result.findings ?? []).map((f) => {
      const disputed = /disputed/i.test(f.statement || "");
      skepticTally[disputed ? "disputed" : "agreed"]++;
      if (disputed) for (const c of f.citations ?? []) skepticTally.disputedIds.add(receiptKey(c));
      return `<li>${verdictBadge(disputed ? "DISPUTED" : "AGREED")} ${esc(f.statement ?? "")}<br/><small>cites: ${esc((f.citations ?? []).join(", "))}</small></li>`;
    }).join("");
    $("skOut").innerHTML = `<ul>${rows}</ul>`;
    $("skStatus").textContent = "";
    setCheck("skeptic", "ok");
    fillReportDoc(); // disputed rows turn red
  } catch (e) {
    skepticTally = null;
    $("skOut").innerHTML = `<div class="statecard err" role="alert"><b>The skeptic couldn't finish.</b><p style="margin-top:6px">${esc(e instanceof Error ? e.message : String(e))}</p></div>`;
    $("skStatus").textContent = "";
    setCheck("skeptic", "error");
  }
}
async function runXcheck(auto) {
  if (checkState.xcheck === "loading") return;
  if (!dmg.mask || !photo) { if (!auto) $("xStatus").textContent = "Mark the damage first."; return; }
  checkState.xcheck = "loading";
  delete $("xState").dataset.verdict;
  renderCheckCard(); updateReportGate();
  try {
    // Cross-check against the model that did NOT draw the mask: API mask vs on-device, or the reverse.
    let other;
    if (dmg.source === "api") {
      if (!embeddings) throw new Error("On-device model still loading — retry in a moment.");
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
    if (!ccRes.ok || !cc.ok) throw new Error(cc.error ?? "cross-check failed");
    const agreed = cc.result.verdict === "AGREED";
    const chip = $("xState");
    chip.dataset.verdict = String(cc.result.verdict);
    chip.className = `chip ${agreed ? "ok" : "fail"}`;
    chip.textContent = agreed ? "Agreed" : "Disputed";
    $("xStatus").textContent = agreed
      ? `The two outlines overlap (IoU ${cc.result.iou}, needs 0.5).`
      : `The two outlines don't match (IoU ${cc.result.iou}, needs 0.5). Check the taps before sending.`;
    setCheck("xcheck", "ok");
  } catch (e) {
    $("xStatus").innerHTML = `<div class="statecard err" role="alert"><b>The cross-check couldn't finish.</b><p style="margin-top:6px">${esc(e instanceof Error ? e.message : String(e))}</p></div>`;
    setCheck("xcheck", "error");
  }
}
function runChecksAuto() {
  resetCheckState();
  runSkeptic(true);
  runXcheck(true);
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
/** Close-up for the report grid: the marked photo cropped to the outline, with some margin. */
function outlineCrop() {
  const c = $("markCanvas");
  if (!photo || !dmg.mask || !c.width) return "";
  const w = c.width, h = c.height;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < dmg.mask.length; i++) {
    if (!dmg.mask[i]) continue;
    const x = i % w, y = (i / w) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return "";
  const pad = Math.max(16, Math.round(Math.max(x1 - x0, y1 - y0) * 0.25));
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0; out.height = y1 - y0;
  out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  try { return out.toDataURL("image/jpeg", 0.85); } catch { return ""; }
}
/** The report document, filled from what is known so far; called again as the summary and checks land. */
let heroCounted = "";
function fillReportDoc() {
  updateReportGate();
  $("docGrid").hidden = !stillDataUrl;
  if (stillDataUrl) {
    // Spectora-style grid: the whole photo with the outline drawn on, then a close-up.
    let full = stillDataUrl;
    if (photo && dmg.mask) { try { full = $("markCanvas").toDataURL("image/jpeg", 0.85); } catch { /* keep the still */ } }
    $("docPhoto").src = full;
    $("docCrop").src = outlineCrop() || full;
    $("docGrid").hidden = false;
  }
  const t = $("transcriptBox").value.trim();
  const q = $("docQuote");
  if (t) { q.hidden = false; q.textContent = `“${t}”`; } else q.hidden = true;
  const d = new Date();
  $("docMeta").textContent = `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${lastMeasurement ? lastMeasurement.findings.length : 0} finding${lastMeasurement?.findings?.length === 1 ? "" : "s"}`;
  const f = (lastMeasurement?.findings ?? [])[0];
  $("docTable").hidden = $("docHero").hidden = !f;
  $("docEmpty").hidden = !!f;
  if (!f) return;
  const ids = f.receiptIds ?? {};
  const tally = skepticTally;
  $("heroLabel").textContent = `${cap(f.label)} · ${f.crackLengthMm != null ? "length" : "share of the wall"}`;
  const heroText = f.crackLengthMm != null ? [f.crackLengthMm, " mm"] : [f.percent, "%"];
  // Count up once per measurement, not on every refill.
  const heroKey = JSON.stringify(heroText);
  if (heroCounted !== heroKey) { heroCounted = heroKey; $("heroValue").innerHTML = num(heroText[0], heroText[1]); countUp($("docHero")); }
  $("heroSev").className = `sev sev-${String(f.severity)}`; $("heroSev").textContent = String(f.severity);
  $("receiptsOut").innerHTML = receiptsBlock(lastMeasurement.receipts);
  drawScheme(lastMeasurement.findings ?? []);
  $("heroSub").textContent = [
    f.crackLengthMm != null ? `${f.percent} % of the wall` : "Percent only, no coin for scale",
    coinLabel ? `scale: ${coinLabel}` : "",
    tally ? (tally.disputed ? `${tally.disputed} disputed by the second model` : "second model agreed") : "",
  ].filter(Boolean).join(" · ");
  // Rows are measured, not "confirmed". A row whose receipt the skeptic disputed turns red.
  const rows = [
    f.crackLengthMm != null && ["Crack length", `${f.crackLengthMm} mm`, ids.length],
    ["Surface affected", `${f.percent} %`, ids.ratio],
    f.areaCm2 != null && ["Area", `${f.areaCm2} cm²`, ids.area],
    f.crackWidthMm != null && ["Width", `${f.crackWidthMm} mm`, ids.width],
    ["Severity", String(f.severity), ids.severity],
    ...(lastMeasurement.findings ?? []).slice(1).flatMap((extra) => {
      const eids = extra.receiptIds ?? {};
      const prefix = cap(extra.label);
      return [
        [`${prefix} surface`, `${extra.percent} %`, eids.ratio],
        extra.areaCm2 != null && [`${prefix} area`, `${extra.areaCm2} cm²`, eids.area],
        [`${prefix} severity`, String(extra.severity), eids.severity],
      ].filter(Boolean);
    }),
  ].filter(Boolean);
  let n = 0;
  $("docRows").innerHTML = rows.map(([name, value, id]) => {
    const bad = !!(id && tally?.disputedIds?.has(receiptKey(id)));
    const badge = bad ? `<span class="chip fail">Disputed</span>` : `<span class="chip ok">Measured</span>`;
    return `<tr${bad ? ' class="disputed"' : ""}><td class="n">${++n}</td><th scope="row">${esc(name)} ${rid(id)}</th><td>${esc(value)}</td><td>${badge}</td></tr>`;
  }).join("") + (!tally ? ""
    : `<tr${tally.disputed ? ' class="disputed"' : ""}><td class="n">${++n}</td><th scope="row">Second model</th><td>${tally.agreed} agreed</td><td>${tally.disputed
      ? `<span class="chip fail">${tally.disputed} disputed</span>` : `<span class="chip ok">None disputed</span>`}</td></tr>`);
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
    catch { $("reportState").textContent = "Sharing unavailable here. Use Download annexure."; }
  }
};
$("copyBtn").onclick = async () => {
  const text = reportSummaryText();
  if (!text) return;
  try { await navigator.clipboard.writeText(text); $("reportState").textContent = "Summary copied to clipboard."; }
  catch { $("reportState").textContent = "Copy failed in this browser — select the summary manually."; }
};
/** Forget the current claim: photo, taps, numbers, line, checks and the report file. */
function resetClaim() {
  payloadObj = null; lastMeasurement = null; reportKey = ""; heroCounted = "";
  dmg = { points: [], pointMasks: [], mask: null, iou: 0, source: null };
  photo = null; gateCoin = null; stillDataUrl = ""; coinLabel = "";
  history.length = 0; smooth = null; coinSeen = false;
  $("transcriptBox").value = ""; $("heard").textContent = "";
  $("voiceErr").textContent = ""; $("raw").textContent = "{}";
  $("measured").innerHTML = ""; $("findings").innerHTML = ""; drawScheme([]);
  $("skOut").innerHTML = ""; $("skStatus").textContent = ""; $("xStatus").textContent = "";
  $("numPhotoCard").hidden = true;
  $("docMeta").textContent = "Not started";
  $("docGrid").hidden = true; $("docHero").hidden = true; $("docTable").hidden = true; $("docEmpty").hidden = false;
  $("docPhoto").removeAttribute("src"); $("docCrop").removeAttribute("src");
  $("docQuote").hidden = true;
  $("docRows").innerHTML = ""; $("receiptsOut").innerHTML = "";
  resetRender();
  resetCheckState();
}
/** Back to "no report file yet": the file is made from this report's numbers only. */
function resetRender() {
  $("annexWrap").innerHTML = `<img id="annexImg" alt="Generated report annexure" hidden />`;
  $("fileBox").hidden = true; $("fileBox").open = false;
  $("dl").style.display = "none"; $("dl").removeAttribute("href");
  $("renderBtn").hidden = false;
  $("shareRow").hidden = true;
  $("reportState").textContent = "";
  setShareCopyEnabled(false);
}
$("newClaimBtn").onclick = () => { resetClaim(); openCamera(); };
$("renderBtn").onclick = async () => {
  if (!payloadObj) return;
  const btn = $("renderBtn");
  btn.classList.add("busy"); btn.disabled = true; btn.textContent = "Creating the file…";
  $("reportState").textContent = "";
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
    const blob = new Blob([j.result.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = document.getElementById("annexImg");
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error("preview failed to render")); img.src = url; img.hidden = false; });
    const dl = $("dl");
    dl.href = url;
    dl.download = "snapclaim-report.svg";
    dl.style.display = "flex";
    $("fileBox").hidden = false;
    btn.hidden = true;
    $("shareRow").hidden = false;
    setShareCopyEnabled(true);
    $("reportState").textContent = "Report file ready.";
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const what = name === "AbortError" ? "it timed out after 30 s" : (e instanceof Error ? e.message : String(e));
    $("reportState").textContent = `The file couldn't be created (${what}). Tap to try again.`;
  } finally {
    btn.classList.remove("busy");
    updateReportGate();
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
    scaleReference: { id: "coin-10inr", knownMm: 27, lengthPx: 287, confidence: 0.88 },
  };
  const btn = $("altEntry");
  btn.classList.add("busy"); btn.disabled = true;
  try {
    const mres = await fetch(base() + "/v1/measure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample) });
    const measured = await mres.json();
    if (!mres.ok || !measured.ok) throw new Error(measured.error ?? mres.status);
    resetClaim();
    payloadObj = sample;
    lastMeasurement = measured.result;
    showMeasured(measured.result);
    show("sSay");
  } catch (e) {
    $("homeNote").textContent = `The sample couldn't load (${e.message ?? e}). Is the backend reachable?`;
  } finally { btn.classList.remove("busy"); btn.disabled = false; }
}
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
const syncOffline = () => { const bar = $("offlineBar"); if (bar) bar.hidden = navigator.onLine !== false; };
window.addEventListener("online", syncOffline);
window.addEventListener("offline", syncOffline);
syncOffline();
// The camera opens from Start a claim, so the permission prompt comes with a reason.
