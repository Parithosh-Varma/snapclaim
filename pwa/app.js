import { checkPhoto } from "./photo-check.js";
const $ = (id) => document.getElementById(id);
function base() { return $("baseUrl").value.replace(/\/$/, ""); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/* ---------- navigation ---------- */
const SCREENS = ["sCam", "sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"];
function show(id) {
  for (const s of ["sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"]) {
    document.getElementById(s)?.classList.toggle("on", s === id);
  }
  try { const c = document.getElementById("donateCheck"); if (c && id === "sReview") c.checked = readDonate(); } catch { /* advisory */ }
  document.body.classList.toggle("reviewing", id === "sReview");
  document.body.classList.toggle("step2", id === "sSay");
}
function backToCam() {
  for (const s of ["sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"]) document.getElementById(s)?.classList.remove("on");
  document.body.classList.remove("reviewing", "step2");
}

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
  if (!navigator.mediaDevices?.getUserMedia) { setLocked(false); return; }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: "environment" } }, audio: false })
    .catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }))
    .then((stream) => {
      camStream = stream;
      feed.srcObject = stream;
      return feed.play().catch(() => {});
    })
    .then(() => scan())
    .catch(() => { hint.textContent = "Camera blocked — demo mode, shutter open"; setLocked(false); });
}
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
    } else { coinLabel = ""; hint.textContent = "Coin found — hold steady…"; }
  } catch { /* ID is advisory; the gate stands on geometry */ }
}
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
  const det = found && !tooClose ? { cx: found.cx, cy: found.cy, rr: found.rr, score: found.score } : null;
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
  const flash = $("flash");
  flash.classList.add("go");
  setTimeout(() => { show("sReview"); flash.classList.remove("go"); }, 160);
});
$("retake").onclick = () => {
  backToCam();
  coinSeen = false; smooth = null; coinLabel = ""; gateCoin = null; stillDataUrl = ""; noScaleMode = false;
  history.length = 0;
  setLocked(true, "Add a coin for scale");
  acquireCamera();
};
$("camClose").onclick = () => {
  stopCamera();
  cancelCapture();
  showTab("tHome");
};
$("doneHome").onclick = () => showTab("tHome");
$("usePhoto").onclick = () => { show("sMark"); setupMarkPhoto(); };
$("altEntry").onclick = () => { loadSample(); };
$("noCoin").onclick = () => {
  noScaleMode = true;
  gateCoin = null;
  setLocked(false, "Percent-only — no scale. Tap to snap.");
  cancelCapture();
};

/* ---------- mark damage (photo canvas + SlimSAM taps) ---------- */
const TF_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
const MODEL_ID = "Xenova/slimsam-77-uniform";
const MAX_SIDE = 512;
const MIN_FINE_SCORE = 0.5;
let tf = null, model = null, processor = null, embeddings = null;
let dmg = { points: [], pointMasks: [], mask: null, iou: 0 };
let dmgLabel = "crack";
let maskOverlayOn = true;
/** UI hook for the overlay toggle (ui.js). Re-draws the mark canvas with the current setting. */
window.__snapclaimOverlay = function (on) { maskOverlayOn = on !== false; if (photo) drawMark(); };

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
async function loadModel() {
  if (model) return;
  tf = await import(TF_URL);
  model = await tf.SamModel.from_pretrained(MODEL_ID, { dtype: "q8" });
  processor = await tf.AutoProcessor.from_pretrained(MODEL_ID, { dtype: "q8" });
}
function setupMarkPhoto() {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    photo = document.createElement("canvas");
    photo.width = Math.round(img.width * scale);
    photo.height = Math.round(img.height * scale);
    photo.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, photo.width, photo.height);
    dmg = { points: [], pointMasks: [], mask: null, iou: 0 };
    lastMeasureLabel = ""; lastMeasureText = "";
    if ($("numBadge")) $("numBadge").hidden = true;
    drawMark();
    $("measureBtn").disabled = true;
    $("status").textContent = "Tap the crack, then Measure.";
    loadModel().then(prepareEmbeddings).catch(() => { $("status").textContent = "Outlining unavailable — measuring the whole-frame fallback is off. Retry."; });
  };
  img.src = stillDataUrl;
}
async function prepareEmbeddings() {
  const blob = await new Promise((r) => photo.toBlob(r, "image/png"));
  const rawImage = await tf.RawImage.read(URL.createObjectURL(blob));
  const inputs = await processor(rawImage);
  embeddings = await model.get_image_embeddings(inputs);
  $("tfState").textContent = "";
}
async function decodePoint(point) {
  const inputs = await processor(await tf.RawImage.read(URL.createObjectURL(await new Promise((r) => photo.toBlob(r, "image/png")))), { input_points: [[point]] });
  const outputs = await model({ ...embeddings, input_points: inputs.input_points, input_labels: inputs.input_labels });
  const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const scores = outputs.iou_scores.data;
  const [, , h, w] = masks[0].dims;
  const areaOf = (k) => { let n = 0; for (const v of masks[0].data.subarray(k * h * w, (k + 1) * h * w)) if (v) n++; return n; };
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  let fine = -1, fineArea = Infinity;
  for (let i = 0; i < scores.length; i++) {
    const a = areaOf(i);
    if (scores[i] >= MIN_FINE_SCORE && a > 0 && a < fineArea) { fine = i; fineArea = a; }
  }
  if (fine >= 0) best = fine;
  const m = masks[0].data.subarray(best * h * w, (best + 1) * h * w);
  const out = new Uint8Array(h * w);
  let area = 0;
  for (let i = 0; i < out.length; i++) if (m[i]) { out[i] = 1; area++; }
  return area ? { mask: out, iou: scores[best] } : null;
}
function maskStats(mask, w, h) {
  let sx = 0, sy = 0, n = 0;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    n++; sx += x + 0.5; sy += y + 0.5;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!n) return null;
  return { cx: sx / n, cy: sy / n, x0, y0, x1, y1, area: n };
}
function badgeHtml(label, mmText) {
  const cap = String(label.charAt(0).toUpperCase() + label.slice(1));
  return `<span class="sq"></span><span>${esc(mmText ? `${cap} · ${mmText}` : cap)}</span>`;
}
function placeBadge(el, stats, w, h) {
  if (!el || !stats) { if (el) el.hidden = true; return; }
  // Anchor at the mask's right edge, vertically centered — like the reference.
  const ax = Math.min(w - 4, Math.max(4, stats.x1));
  const ay = Math.min(h - 4, Math.max(4, stats.cy));
  el.style.left = (ax / w * 100).toFixed(2) + "%";
  el.style.top = (ay / h * 100).toFixed(2) + "%";
  el.hidden = false;
}
let lastMeasureLabel = "";
let lastMeasureText = "";
function updateMarkBadge() {
  const el = $("markBadge");
  if (!el) return;
  if (!dmg.mask || !maskOverlayOn || !photo) { el.hidden = true; return; }
  const stats = maskStats(dmg.mask, photo.width, photo.height);
  dmg.stats = stats;
  if (!stats) { el.hidden = true; return; }
  el.innerHTML = badgeHtml(dmgLabel, "");
  placeBadge(el, stats, photo.width, photo.height);
}
function updateNumBadge() {
  const el = $("numBadge");
  if (!el) return;
  const stats = dmg.stats || (dmg.mask && photo ? maskStats(dmg.mask, photo.width, photo.height) : null);
  if (!stats || !maskOverlayOn || !dmg.mask || !photo) { el.hidden = true; return; }
  el.innerHTML = badgeHtml(lastMeasureLabel || dmgLabel, lastMeasureText);
  placeBadge(el, stats, photo.width, photo.height);
}
function drawMark() {
  const c = $("markCanvas");
  c.width = photo.width; c.height = photo.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(photo, 0, 0);
  if (dmg.mask && maskOverlayOn) {
    const w = c.width, h = c.height, mask = dmg.mask;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    // Pass 1: translucent red fill over the damage area.
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const o = i * 4;
      d[o] = d[o] * 0.55 + 224 * 0.45;
      d[o + 1] = d[o + 1] * 0.55 + 26 * 0.45;
      d[o + 2] = d[o + 2] * 0.55 + 43 * 0.45;
    }
    // Pass 2: crisp solid outline — edge pixels (3x3 touches background)
    // go full red so the crack reads like the reference: tint + border.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (!edge) {
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) { edge = true; break; }
        }
      }
      if (!edge) continue;
      const o = i * 4;
      d[o] = 224; d[o + 1] = 26; d[o + 2] = 43; d[o + 3] = 255;
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
  updateMarkBadge();
}
$("markCanvas").addEventListener("pointerdown", async (ev) => {
  if (!photo || !embeddings) { $("status").textContent = "Outlining model still loading…"; return; }
  const c = $("markCanvas"), r = c.getBoundingClientRect();
  const x = Math.round((ev.clientX - r.left) * (c.width / r.width));
  const y = Math.round((ev.clientY - r.top) * (c.height / r.height));
  dmg.points.push([x, y]);
  $("status").textContent = "Outlining…";
  try {
    while (dmg.pointMasks.length < dmg.points.length) dmg.pointMasks.push(await decodePoint(dmg.points[dmg.pointMasks.length]));
    const found = dmg.pointMasks.filter(Boolean);
    if (found.length) {
      const union = new Uint8Array(found[0].mask.length);
      for (const { mask } of found) for (let i = 0; i < union.length; i++) union[i] |= mask[i];
      dmg.mask = union;
      dmg.iou = Math.min(...found.map((f) => f.iou));
      $("status").textContent = `Outlined (${Math.round(dmg.iou * 100)}% sure).`;
    } else { dmg.mask = null; $("status").textContent = "No mask there. Tap the middle of it."; }
  } catch { dmg.mask = null; $("status").textContent = "Outlining failed."; }
  drawMark();
});
for (const [id, label] of [["chipCrack", "crack"], ["chipStain", "stain"], ["chipPeel", "peel"], ["chipDent", "dent"]]) {
  $(id).onclick = () => {
    dmgLabel = label;
    for (const [o] of [["chipCrack"], ["chipStain"], ["chipPeel"], ["chipDent"]]) $(o).classList.remove("on");
    $(id).classList.add("on");
    updateMarkBadge();
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
let payloadObj = null;
let lastMeasurement = null;
$("measureBtn").onclick = async () => {
  if (!dmg.mask) return;
  checkPhotoNotes();
  const w = photo.width, h = photo.height;
  const body = { masks: [{ id: "damage-1", label: dmgLabel, rle: encodeRle(dmg.mask, w, h), confidence: dmg.iou || 0.8 }] };
  if (gateCoin) {
    const kx = w / gateCoin.sw, ky = h / gateCoin.sh;
    const cx = (gateCoin.cx / gateCoin.fw) * gateCoin.sw * kx;
    const cy = (gateCoin.cy / gateCoin.fh) * gateCoin.sh * ky;
    const r = Math.max(3, (gateCoin.rr / gateCoin.fw) * gateCoin.sw * kx);
    body.reference = { id: "coin", rle: circleRle(cx, cy, r, w, h), knownMm: Number($("coinKind").value), confidence: 0.85 };
  } else if (noScaleMode) body.note = "percent-only requested";
  $("status").textContent = "Measuring…";
  try {
    const res = await fetch(base() + "/v1/observe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok || !j.ok) throw new Error(j.error ?? res.status);
    const mres = await fetch(base() + "/v1/measure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(j.result) });
    const measured = await mres.json();
    if (!mres.ok || !measured.ok) throw new Error(measured.error ?? mres.status);
    payloadObj = j.result;
    showMeasured(measured.result);
    upsertCurrentCase({ component: j.result.component, masks: j.result.masks, scaleReference: j.result.scaleReference, measurement: measured.result, receipts: measured.result?.receipts, status: "measured" }).catch(() => {});
    show("sSay");
    startListening();
  } catch (e) { $("status").textContent = `Measuring failed (${e.message ?? e}).`; }
};
function measuredRows(findings) {
  return findings.map((f) => {
    const mm = f.crackLengthMm === null ? "—" : `${esc(String(f.crackLengthMm))} mm`;
    const area = f.areaCm2 == null ? "" : ` · ${esc(String(f.areaCm2))} cm²`;
    const width = f.crackWidthMm == null ? "" : ` · w ${esc(String(f.crackWidthMm))} mm`;
    const cap = String(f.label);
    return `<li><p class="found">${esc(cap.charAt(0).toUpperCase() + cap.slice(1))} found</p>` +
      `<b>${esc(String(f.percent))}%</b> <small>of the wall</small> · <b>${mm}</b> <small>length</small>${area} · ` +
      `${esc(String(f.regionCount ?? 1))} region${(f.regionCount ?? 1) === 1 ? "" : "s"} · ` +
      `<span class="badge ok">${esc(String(f.severity))}</span>${width}` +
      `${f.statement ? `<br/><small>${esc(String(f.statement))}</small>` : ""}</li>`;
  }).join("");
}
/* Gated finding drafts carry {statement, citations} — never measurement fields. */
function draftRows(drafts) {
  return drafts.map((d) => `<li><p class="found">Finding</p>${esc(String(d.statement ?? ""))}` +
    `<br/><small>cites: ${esc((d.citations ?? []).join(", "))}</small></li>`).join("");
}
function showMeasured(result) {
  const mode = result.mode === "absolute" ? "" : " (no coin: percent only)";
  $("measured").innerHTML = `<span class="badge ok">MEASURED${mode}</span><ul>${measuredRows(result.findings)}</ul>`;
  drawScheme(result.findings);
  const first = (result.findings || [])[0];
  lastMeasureLabel = first ? String(first.label || "") : "";
  lastMeasureText = first && first.crackLengthMm !== null && first.crackLengthMm !== undefined ? `${first.crackLengthMm} mm` : "";
  updateNumBadge();
  show("sNum");
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
async function ensureMic() {
  if (micReady) return true;
  if (!navigator.mediaDevices?.getUserMedia) { heard.textContent = "No microphone on this device."; return false; }
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
  } catch { heard.textContent = "Mic blocked — allow access or type below."; return false; }
}
function stopListening(landed, text) {
  clearTimeout(micTimer); micTimer = null; listening = false;
  document.getElementById("micwrap").classList.remove("live");
  micState.textContent = landed ? "Heard" : "Listening";
  heard.textContent = landed ? (text ?? "") : "";
}
async function startListening() {
  if (listening) return;
  heard.textContent = "Asking for the mic…";
  if (!(await ensureMic())) { micState.textContent = "Mic off"; return; }
  try {
    const health = await fetch(base() + "/v1/health").then((r) => r.json()).catch(() => null);
    if (health && health.mode === "mock") $("voiceErr").textContent = "Demo mode: voice transcription is off — type the line below.";
  } catch { /* advisory only */ }
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
  const rec = recorder;
  if (!landed || !rec || rec.state === "recording") {
    try { if (rec?.state === "recording") rec.stop(); } catch { /* noop */ }
  }
  if (rec && rec.state !== "inactive") {
    await Promise.race([
      new Promise((res) => { rec.onstop = () => res(); }),
      new Promise((res) => setTimeout(res, 2000)),
    ]);
  } else {
    await new Promise((r) => setTimeout(r, 300));
  }
  const clip = new Blob(recChunks, { type: recorder?.mimeType || "audio/webm" });
  if (!landed || clip.size === 0) { if (landed) { heard.textContent = "Didn't catch anything — type the line."; micState.textContent = "Type instead"; } mic.disabled = false; return; }
  micState.textContent = "Transcribing…";
  mic.disabled = true;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const decoded = await Promise.race([
      ctx.decodeAudioData(await clip.arrayBuffer()),
      new Promise((_, rej) => setTimeout(() => rej(new Error("audio decode timed out")), 15000)),
    ]);
    const off = new OfflineAudioContext(1, Math.ceil(Math.min(decoded.duration, 10) * 16000), 16000);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start(0, 0, Math.min(decoded.duration, 10));
    const rendered = await off.startRendering();
    ctx.close().catch(() => {});
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
    if (res.status === 400 && /fixtureTranscript|mock/i.test(String(j.error ?? ""))) { $("voiceErr").textContent = "Demo mode has no voice model — type the line instead."; micState.textContent = "Type instead"; mic.disabled = false; return; }
    if (!res.ok || !j.ok) throw new Error(j.error ?? res.status);
    const text = String(j.result?.transcript ?? "").trim();
    if (!text) { heard.textContent = "Didn't catch anything — type the line."; mic.disabled = false; return; }
    $("transcriptBox").value = text;
    heard.textContent = `“${text}”`;
    micState.textContent = "Heard";
    mic.disabled = false;
  } catch (e) { $("voiceErr").textContent = `Transcription failed — type the line. (${e.message ?? e})`; mic.disabled = false; }
}
mic.onclick = () => { if (listening) finishListening(true); else startListening(); };
$("sendBtn").onclick = () => runReport();
$("backMark").onclick = () => {
  if (sampleFlow || !stillDataUrl) { sampleFlow = false; writeDraft(null); showTab("tHome"); }
  else show("sReview");
};
$("backCam").onclick = () => {
  if (sampleFlow || !stillDataUrl) { sampleFlow = false; writeDraft(null); showTab("tHome"); }
  else { $("retake").onclick(); }
};
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
  if (res.status === 503) {
    $("findings").innerHTML = `<span class="badge fail">AI FINDINGS UNAVAILABLE</span><pre>${esc(j.error ?? "API key missing")}</pre>`;
    toast(`Report failed: ${j.error ?? "API key missing"}`);
    return;
  }
  if (!res.ok || !j.ok) {
    const fails = j.details ?? j.failures ?? [j.error];
    $("findings").innerHTML = `<span class="badge fail">GATED</span><pre>${esc(JSON.stringify(fails, null, 2))}</pre>`;
    toast(`Report ${res.status === 422 ? "blocked by the evidence gate" : "failed"} — retry or check raw output.`);
    return;
  }
  lastMeasurement = j.result.measurement ?? null;
  upsertCurrentCase({ measurement: j.result.measurement, receipts: j.result.measurement?.receipts, findings: j.result.findings, transcript: body.transcript, mode: j.result.measurement?.mode, status: "reported" }).then(() => refreshCases().catch(() => {}));
  $("findings").innerHTML = `<span class="badge ok">GATE PASS</span><ul>${draftRows(j.result.findings)}</ul>`;
  drawScheme(j.result.measurement?.findings ?? []);
  show("sNum");
}
$("toCheck").onclick = () => show("sCheck");
$("toReport").onclick = () => show("sReport");
$("backNum").onclick = () => show("sNum");
$("backCheck").onclick = () => show("sCheck");
$("skepticBtn").onclick = async () => {
  if (!lastMeasurement || !payloadObj) { $("skStatus").textContent = "run report first"; return; }
  $("skStatus").textContent = "asking…";
  $("skOut").innerHTML = "";
  let res, j;
  try {
    // Send measurement inputs too so the backend recomputes receipts
    // server-side instead of trusting client-supplied findings.
    res = await fetch(base() + "/v1/skeptic", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        component: payloadObj.component,
        masks: payloadObj.masks,
        ...(payloadObj.scaleReference ? { scaleReference: payloadObj.scaleReference } : {}),
        transcript: $("transcriptBox").value, findings: lastMeasurement.findings, receipts: lastMeasurement.receipts,
      }),
    });
    j = await res.json();
  } catch { $("skStatus").textContent = "backend unreachable"; return; }
  if (!res.ok || !j.ok) {
    $("skStatus").textContent = `skeptic ${res.status}: ${j.error ?? "failed"}`;
    return;
  }
  $("skStatus").textContent = `skeptic ok ${j.requestId}`;
  $("skOut").innerHTML = `<ul>${j.result.findings.map((f) => {
    const disputed = /disputed/i.test(f.statement);
    return `<li><span class="badge ${disputed ? "fail" : "ok"}">${disputed ? "DISPUTED" : "AGREED"}</span> ${esc(f.statement)}<br/><small>cites: ${esc((f.citations ?? []).join(", "))}</small></li>`;
  }).join("")}</ul>`;
};
$("xcheckBtn").onclick = async () => {
  if (!dmg.mask || !photo) { $("xStatus").textContent = "Mark the damage first."; return; }
  try {
    const health = await fetch(base() + "/v1/health").then((r) => r.json()).catch(() => null);
    if (health && health.mode === "mock") { $("xStatus").textContent = "Demo mode has no SAM 3.1 — measure is still real. Set MOCK_MODE=0 + keys for cross-check."; return; }
  } catch { /* fall through to segment attempt */ }
  $("xStatus").textContent = "Asking SAM 3.1…";
  try {
    const segRes = await fetch(base() + "/v1/segment", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageUrl: photo.toDataURL("image/jpeg", 0.85),
        width: photo.width, height: photo.height,
        points: dmg.points.map(([x, y]) => ({ x, y })),
      }),
    });
    const seg = await segRes.json();
    if (!segRes.ok || !seg.ok) throw new Error(seg.error ?? "SAM segment failed");
    const record = seg.result?.records?.[0];
    if (!record) { $("xStatus").textContent = "SAM found nothing there."; return; }
    const ccRes = await fetch(base() + "/v1/crosscheck", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: encodeRle(dmg.mask, photo.width, photo.height), b: record.rle, threshold: 0.5 }),
    });
    const cc = await ccRes.json();
    if (!ccRes.ok || !cc.ok) throw new Error(cc.error ?? "cross-check failed");
    const badge = cc.result.verdict === "AGREED" ? "ok" : "fail";
    $("xStatus").innerHTML = "";
    const chip = document.createElement("span");
    chip.className = `badge ${badge}`;
    chip.textContent = `${cc.result.verdict} · IoU ${cc.result.iou}`;
    $("xStatus").appendChild(chip);
  } catch (e) { $("xStatus").textContent = `Cross-check failed (${e.message ?? e}). Live SAM needs MOCK_MODE=0 + META_API_KEY.`; }
};
$("renderBtn").onclick = async () => {
  if (!payloadObj) return;
  const body = JSON.parse(JSON.stringify(payloadObj));
  body.transcript = $("transcriptBox").value;
  const res = await fetch(base() + "/v1/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok || !j.ok) { toast(`Render failed (${j.error ?? res.status}) — retry or check the report first.`); return; }
  $("annex").innerHTML = j.result.svg;
  upsertCurrentCase({ annexSvg: j.result.svg, status: "reported" }).catch(() => {});
  const blob = new Blob([j.result.svg], { type: "image/svg+xml" });
  const dl = $("dl");
  dl.href = URL.createObjectURL(blob);
  dl.download = "snapclaim-annexure.svg";
  dl.style.display = "inline";
  dl.textContent = "download svg";
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
  try {
    const mres = await fetch(base() + "/v1/measure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample) });
    const measured = await mres.json();
    if (!mres.ok || !measured.ok) throw new Error(measured.error ?? mres.status);
    payloadObj = sample;
    sampleFlow = true;
    try {
      currentCaseId = CaseStore.newId();
      await CaseStore.put({ id: currentCaseId, title: "Sample damage", property: "", notes: "", photos: [], createdAt: Date.now(), status: "measured", measurement: measured.result, receipts: measured.result?.receipts });
      writeDraft(null);
      refreshCases().catch(() => {});
    } catch { /* demo path stays usable without storage */ }
    showMeasured(measured.result);
    show("sSay");
    startListening();
  } catch (e) { hint.textContent = `Sample failed (${e.message ?? e}). Is the backend reachable?`; toast("Sample failed — the backend looks unreachable."); }
}
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

/* ---------- tabs + local-first cases ---------- */
const TABS = ["tHome", "tCases", "tSettings"];
let currentCaseId = null;
let sampleFlow = false;
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
function hideTabs() {
  for (const t of TABS) document.getElementById(t)?.classList.remove("on");
  document.body.classList.remove("tabbing");
}
function showTab(id) {
  hideTabs();
  for (const s of ["sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"]) document.getElementById(s)?.classList.remove("on");
  document.body.classList.remove("reviewing", "step2");
  stopCamera();
  cancelCapture();
  document.getElementById(id)?.classList.add("on");
  document.body.classList.add("tabbing");
  for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === id));
  if (id === "tHome" || id === "tCases") refreshCases().catch(() => {});
  if (id === "tSettings") refreshSettings().catch(() => {});
}
function enterCapture() {
  hideTabs();
  sampleFlow = false;
  for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === "capture"));
  coinSeen = false; smooth = null; coinLabel = ""; gateCoin = null; stillDataUrl = ""; noScaleMode = false;
  history.length = 0;
  setLocked(true, "Add a coin for scale");
  acquireCamera();
}
for (const b of document.querySelectorAll("#tabs button")) {
  b.addEventListener("click", () => {
    const t = b.dataset.tab;
    if (t === "capture") enterCapture();
    else showTab(t);
  });
}
function fmtDate(ts) {
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return ""; }
}
function statusLabel(c) {
  return c.status === "reported" ? "reported" : c.status === "measured" ? "measured" : c.photos?.length ? "photo" : "draft";
}
async function refreshCases() {
  let cases = [];
  try { cases = await CaseStore.list(); } catch { cases = []; }
  const recent = $("recentList"), all = $("caseList");
  const row = (c) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const n = c.photos?.length ?? 0;
    b.innerHTML = `<span class="badge ok">${esc(statusLabel(c))}</span> <span class="case-title">${esc(c.title || "Untitled damage")}</span>` +
      `<div class="case-meta">${esc(c.property || "No location")} · ${n} photo${n === 1 ? "" : "s"} · ${esc(fmtDate(c.updatedAt))} (device time)</div>`;
    b.addEventListener("click", () => openCase(c.id));
    li.appendChild(b);
    return li;
  };
  recent.innerHTML = "";
  cases.slice(0, 3).forEach((c) => recent.appendChild(row(c)));
  $("recentEmpty").style.display = cases.length ? "none" : "block";
  const draft = readDraft();
  $("nextTitle").textContent = draft ? "Continue your draft" : "Document new damage";
  $("nextSub").textContent = draft ? "Photo captured — pick up where you left off." : "Capture a photo, tap the damage, say what happened.";
  $("ctaNew").textContent = draft ? "Continue draft" : "Document damage";
  all.innerHTML = "";
  cases.forEach((c) => all.appendChild(row(c)));
  $("caseEmpty").style.display = cases.length ? "none" : "block";
}
function readDraft() {
  try { return JSON.parse(localStorage.getItem("sc_draft") || "null"); } catch { return null; }
}
function writeDraft(d) {
  try { if (d) localStorage.setItem("sc_draft", JSON.stringify(d)); else localStorage.removeItem("sc_draft"); } catch { /* private mode */ }
}
async function upsertCurrentCase(patch) {
  if (!currentCaseId) return null;
  try {
    const c = (await CaseStore.get(currentCaseId)) || { id: currentCaseId, title: "", property: "", notes: "", photos: [], createdAt: Date.now(), status: "draft" };
    const next = { ...c, ...patch };
    await CaseStore.put(next);
    return next;
  } catch { toast("Couldn't save locally — storage is full or blocked."); return null; }
}
function downscaleDataUrl(dataUrl, maxSide = 1024) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      if (k >= 1) { resolve({ url: dataUrl, w: img.width, h: img.height }); return; }
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve({ url: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
/* upload fallback: file picker feeds the same review flow as the camera */
$("uploadBtn").onclick = () => $("camFile").click();
$("camFile").addEventListener("change", async () => {
  const f = $("camFile").files?.[0];
  $("camFile").value = "";
  if (!f) return;
  if (!f.type.startsWith("image/")) { toast("That file is not an image."); return; }
  const url = URL.createObjectURL(f);
  const raw = await new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      res({ url: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height });
    };
    img.onerror = () => res(null);
    img.src = url;
  });
  URL.revokeObjectURL(url);
  if (!raw) { toast("Couldn't read that photo."); return; }
  hideTabs();
  stillDataUrl = raw.url;
  gateCoin = null; noScaleMode = true;
  document.getElementById("shotFull").src = stillDataUrl;
  show("sReview");
});
/* hook photo capture into the case record */
$("usePhoto").addEventListener("click", async () => {
  try {
    sampleFlow = false;
    currentCaseId = CaseStore.newId();
    await CaseStore.put({ id: currentCaseId, title: "", property: "", notes: "", photos: [{ id: "p1", url: stillDataUrl, caption: "", capturedAt: Date.now(), source: "camera" }], createdAt: Date.now(), status: "photo" });
    writeDraft({ caseId: currentCaseId, at: Date.now() });
  } catch { toast("Couldn't save locally — storage is full or blocked."); }
  donatePhoto().catch(() => {});
});

/* ---------- dataset donation (opt-in, D1 via /v1/collect) ---------- */
function readDonate() { try { return localStorage.getItem("sc_donate") === "1"; } catch { return false; } }
function writeDonate(v) { try { localStorage.setItem("sc_donate", v ? "1" : "0"); } catch { /* private mode */ } }
function downscaleDonate(dataUrl, maxSide = 768) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
async function donatePhoto() {
  if (!readDonate() || !stillDataUrl) return;
  const small = await downscaleDonate(stillDataUrl).catch(() => null);
  if (!small) return;
  const coinMm = noScaleMode ? null : Number($("coinKind")?.value ?? NaN);
  const res = await fetch(base() + "/v1/collect", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      consent: true,
      image: small,
      label: typeof dmgLabel === "string" ? dmgLabel : null,
      coinMm: Number.isFinite(coinMm) ? coinMm : null,
      transcript: null,
      userAgent: String(navigator.userAgent || "").slice(0, 200),
    }),
  }).catch(() => null);
  if (!res) { toast("Donation failed — offline? Photo kept locally."); return; }
  const j = await res.json().catch(() => null);
  if (res.ok && j?.ok) toast("Photo donated — thank you.");
  else toast(`Donation skipped (${j?.error ?? res.status}).`);
}
function syncDonateBoxes(from) {
  const a = $("donateCheck"), b = $("donateSetting");
  if (from === "a" && a) writeDonate(a.checked);
  else if (from === "b" && b) writeDonate(b.checked);
  const v = readDonate();
  if (a && a.checked !== v) a.checked = v;
  if (b && b.checked !== v) b.checked = v;
}
$("retake").addEventListener("click", () => { writeDraft(null); });
/* double-submit guards on the async actions */
function guard(btn, fn) {
  return async (...a) => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(...a); } finally { btn.disabled = false; }
  };
}
/* export: real evidence package (JSON) + printable report + Web Share */
function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
function caseFilename(c, ext) {
  const slug = (c.title || "snapclaim-case").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "snapclaim-case";
  return `${slug}-${String(c.id).slice(-6)}.${ext}`;
}
function reportHtml(c) {
  const photos = (c.photos || []).map((p, i) => `
    <figure><img src="${p.url}" /><figcaption>Photo ${i + 1}${p.caption ? ` — ${esc(p.caption)}` : ""} · device time ${esc(fmtDate(p.capturedAt))} · source: ${esc(p.source || "unknown")}</figcaption></figure>`).join("");
  const meas = (c.measurement?.findings || []).map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(String(f.percent))}%</td><td>${esc(String(f.crackLengthMm ?? "—"))}</td><td>${esc(f.severity)}</td></tr>`).join("");
  const finds = (c.findings || []).map((f) => `<li>${esc(f.statement)} <small>(${(f.citations || []).map(esc).join(", ")})</small></li>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.title || "SnapClaim report")}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:700px;margin:32px auto;padding:0 20px;color:#111}figure{margin:0 0 16px}img{max-width:100%;border:1px solid #ccc}figcaption{font-size:12px;color:#555}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:left}small{color:#555}.warn{background:#fff8e1;border:1px solid #e0c36a;padding:10px;font-size:13px}</style></head><body>
<h1>${esc(c.title || "Damage report")}</h1>
<p>Property: ${esc(c.property || "—")} · Device time: ${esc(fmtDate(c.updatedAt))} · Mode: ${esc(c.mode || "—")}</p>
<div class="warn">Computed measurements, not generated claims. Dates are device-clock labels, not verified evidence time. Photos are stored locally; this export was created by an explicit user action.</div>
<h2>Photos (${(c.photos || []).length})</h2>${photos || "<p>No photos.</p>"}
<h2>Measurements</h2><table><tr><th>Damage</th><th>%</th><th>Length mm</th><th>Severity</th></tr>${meas}</table>
<h2>Findings</h2><ul>${finds || "<li>—</li>"}</ul>
${c.transcript ? `<h2>Spoken line</h2><p>“${esc(c.transcript)}”</p>` : ""}
<p><small>SnapClaim · receipts ${((c.receipts || []).map((r) => r.id)).map(esc).join(", ") || "—"} · computed, not generated.</small></p>
</body></html>`;
}
async function exportCase(id) {
  const c = await CaseStore.get(id).catch(() => null);
  if (!c) { toast("Case not found."); return; }
  const payload = { ...c, exportedAt: new Date().toISOString(), exportedAtNote: "device clock, not verified evidence time" };
  const file = new File([JSON.stringify(payload, null, 2)], caseFilename(c, "json"), { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: c.title || "SnapClaim case" }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  downloadBlob(caseFilename(c, "json"), file);
  toast("Evidence package downloaded.");
}
function printCase(id) {
  CaseStore.get(id).then((c) => {
    if (!c) { toast("Case not found."); return; }
    const w = window.open("", "_blank");
    if (!w) { toast("Pop-up blocked — allow pop-ups to print."); return; }
    w.document.write(reportHtml(c));
    w.document.close();
    w.focus();
    w.print();
  }).catch(() => toast("Couldn't open the report."));
}
/* case dialog */
let dlgPhotos = [];
async function openCase(id) {
  const c = await CaseStore.get(id).catch(() => null);
  if (!c) { toast("Case not found."); return; }
  currentCaseId = id;
  $("dlgTitle").textContent = c.title || "Untitled damage";
  $("dlgMeta").textContent = `${statusLabel(c)} · ${(c.photos || []).length} photo${(c.photos || []).length === 1 ? "" : "s"} · ${fmtDate(c.updatedAt)} (device time)`;
  $("dlgName").value = c.title || "";
  $("dlgProp").value = c.property || "";
  $("dlgNotes").value = c.notes || "";
  dlgPhotos = (c.photos || []).map((p) => ({ ...p }));
  paintDlgPhotos();
  $("dlgDelete").textContent = "Delete case";
  $("dlgDelete").dataset.armed = "";
  try { document.getElementById("caseDlg").showModal(); }
  catch { toast("This browser can't open the case sheet — update iOS/Safari."); }
}
function paintDlgPhotos() {
  const box = $("dlgPhotos");
  box.innerHTML = "";
  dlgPhotos.forEach((p, i) => {
    const wrap = document.createElement("div");
    wrap.style.position = "relative";
    const img = document.createElement("img");
    img.src = p.url; img.alt = `Case photo ${i + 1}`;
    const cap = document.createElement("input");
    cap.type = "text"; cap.value = p.caption || ""; cap.maxLength = 120;
    cap.setAttribute("aria-label", `Caption for photo ${i + 1}`);
    cap.placeholder = "Add a caption…";
    cap.style.cssText = "width:100%;margin-top:4px;min-height:44px;border:1px solid #e2ddd0;border-radius:10px;font:inherit;font-size:13px;padding:0 10px;background:#fff";
    cap.addEventListener("input", () => { dlgPhotos[i].caption = cap.value.slice(0, 120); });
    const del = document.createElement("button");
    del.type = "button"; del.textContent = "Remove"; del.setAttribute("aria-label", `Remove photo ${i + 1}`);
    del.style.cssText = "position:absolute;left:4px;bottom:4px;min-height:44px;padding:6px 12px;border-radius:999px;border:0;background:rgba(11,30,70,.85);color:#fff;font-size:12px;font-weight:700";
    del.addEventListener("click", () => {
      if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "Tap again to confirm"; return; }
      dlgPhotos.splice(i, 1);
      paintDlgPhotos();
    });
    wrap.append(img, cap, del);
    box.appendChild(wrap);
  });
}
$("dlgAddPhoto").onclick = () => $("dlgFile").click();
$("dlgFile").addEventListener("change", async () => {
  const f = $("dlgFile").files?.[0];
  $("dlgFile").value = "";
  if (!f || !f.type.startsWith("image/")) { if (f) toast("That file is not an image."); return; }
  const url = URL.createObjectURL(f);
  const raw = await new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      res({ url: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height });
    };
    img.onerror = () => res(null);
    img.src = url;
  });
  URL.revokeObjectURL(url);
  if (!raw) { toast("Couldn't read that photo."); return; }
  dlgPhotos.push({ id: "p" + Date.now().toString(36), url: raw.url, caption: "", capturedAt: Date.now(), source: "upload" });
  paintDlgPhotos();
});
$("dlgSave").onclick = guard($("dlgSave"), async () => {
  const patch = { title: $("dlgName").value.trim().slice(0, 80), property: $("dlgProp").value.trim().slice(0, 120), notes: $("dlgNotes").value.trim().slice(0, 500), photos: dlgPhotos };
  await upsertCurrentCase(patch);
  document.getElementById("caseDlg").close();
  refreshCases();
  toast("Case saved on this device.");
});
$("dlgExport").onclick = () => { if (currentCaseId) exportCase(currentCaseId); };
$("dlgDelete").onclick = guard($("dlgDelete"), async () => {
  const b = $("dlgDelete");
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again to confirm delete"; return; }
  await CaseStore.remove(currentCaseId).catch(() => toast("Couldn't delete."));
  b.dataset.armed = "";
  document.getElementById("caseDlg").close();
  if (currentCaseId && readDraft()?.caseId === currentCaseId) writeDraft(null);
  refreshCases();
  toast("Case deleted.");
});
$("dlgClose").onclick = () => document.getElementById("caseDlg").close();
/* home actions */
$("ctaNew").onclick = () => {
  const d = readDraft();
  if (d && d.photo) {
    stillDataUrl = d.photo;
    gateCoin = null; noScaleMode = true;
    hideTabs();
    document.getElementById("shotFull").src = stillDataUrl;
    show("sReview");
  } else enterCapture();
};
$("ctaSample").onclick = () => { hideTabs(); loadSample(); };
/* persist draft photo on capture */
$("usePhoto").addEventListener("click", () => writeDraft({ caseId: currentCaseId, photo: stillDataUrl, at: Date.now() }));
/* settings */
function syncUrls(from) {
  const a = $("baseUrl"), b = $("baseUrl2");
  if (from === "a") b.value = a.value; else a.value = b.value;
}
$("baseUrl").addEventListener("input", () => syncUrls("a"));
$("baseUrl2").addEventListener("input", () => syncUrls("b"));
$("setCheck").onclick = async () => {
  $("setHealth").textContent = "checking…";
  try {
    const r = await fetch(base() + "/v1/health");
    const j = await r.json();
    $("setHealth").textContent = `ok v${j.version} mode:${j.mode}`;
    $("healthOut").textContent = `ok v${j.version} mode:${j.mode}`;
  } catch { $("setHealth").textContent = "unreachable — measuring needs a connection."; }
};
async function refreshSettings() {
  $("baseUrl2").value = $("baseUrl").value;
  let info = "";
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) info += `Using ${Math.round((est.usage || 0) / 1024 / 1024)} MB of ~${Math.round((est.quota || 0) / 1024 / 1024)} MB. `;
  } catch { /* advisory */ }
  try { info += `${(await CaseStore.list()).length} case(s) stored on this device.`; }
  catch { info += "Local storage unavailable."; }
  $("storeInfo").textContent = info;
}
$("exportAllBtn").onclick = guard($("exportAllBtn"), async () => {
  const cases = await CaseStore.list().catch(() => null);
  if (!cases) { toast("Storage unavailable."); return; }
  downloadBlob("snapclaim-cases.json", new Blob([JSON.stringify(cases, null, 2)], { type: "application/json" }));
  toast(`${cases.length} case(s) downloaded.`);
});
$("wipeBtn").onclick = async () => {
  const b = $("wipeBtn");
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again to delete everything"; return; }
  b.dataset.armed = "";
  await CaseStore.clear().catch(() => toast("Couldn't clear storage."));
  writeDraft(null);
  refreshCases(); refreshSettings();
  toast("All local cases deleted.");
};
$("updateBtn").onclick = async () => {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { toast("No service worker — reload the page."); return; }
    await reg.update();
    toast(reg.waiting ? "Update ready — tap Reload." : "Already up to date.");
    if (reg.waiting) $("updateBar").classList.add("show");
  } catch { toast("Update check failed while offline."); }
};
$("updateGo").onclick = async () => {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
  } catch { /* reload below still applies */ }
  location.reload();
};
/* network + install honesty */
function updateNet() {
  const pill = $("netPill");
  const on = navigator.onLine;
  pill.textContent = on ? "online" : "offline — cases still open";
  pill.className = "pill " + (on ? "ok" : "bad");
}
window.addEventListener("online", updateNet);
window.addEventListener("offline", updateNet);
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  const hint = $("installHint");
  if (!hint || deferredInstall) return; // no UI slot (or already holding one): let the browser handle it
  e.preventDefault();
  deferredInstall = e;
  hint.textContent = "Install: tap here — Add to Home Screen, or use the button.";
  const btn = document.createElement("button");
  btn.type = "button"; btn.textContent = "Install app"; btn.className = "btn-ghostline";
  btn.style.marginTop = "8px";
  btn.onclick = async () => {
    try { await deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); }
    catch { /* user dismissed or prompt unavailable */ }
    deferredInstall = null; btn.remove();
  };
  hint.after(btn);
});
/* ---------- init: tabbed home first, camera starts on capture ---------- */
$("baseUrl2").value = $("baseUrl").value;
try {
  const v = readDonate();
  if ($("donateCheck")) $("donateCheck").checked = v;
  if ($("donateSetting")) $("donateSetting").checked = v;
  $("donateCheck")?.addEventListener("change", () => syncDonateBoxes("a"));
  $("donateSetting")?.addEventListener("change", () => syncDonateBoxes("b"));
} catch { /* donate boxes are advisory */ }
updateNet();
showTab("tHome");
refreshSettings().catch(() => {});
