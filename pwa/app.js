import { checkPhoto } from "./photo-check.js";

const $ = (id) => document.getElementById(id);
let payloadObj = null;
let lastMeasurement = null;
function base() { return $("baseUrl").value.replace(/\/$/, ""); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/* ---------- navigation ---------- */
const SCREENS = ["sCam", "sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"];
function show(id) {
  for (const s of ["sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"]) {
    document.getElementById(s)?.classList.toggle("on", s === id);
  }
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
  const tooClose = !!found && found.r > fw * 0.32;
  const det = found && !tooClose ? { cx: found.x, cy: found.y, rr: found.r, score: found.score } : null;
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
$("usePhoto").onclick = () => { show("sMark"); setupMarkPhoto(); };
$("backCam").onclick = () => { $("retake").onclick(); };
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
  model = await tf.SamModel.from_pretrained(MODEL_ID);
  processor = await tf.AutoProcessor.from_pretrained(MODEL_ID);
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
  if (gateCoin) {
    const kx = w / gateCoin.sw, ky = h / gateCoin.sh;
    const cx = (gateCoin.cx / gateCoin.fw) * gateCoin.sw * kx;
    const cy = (gateCoin.cy / gateCoin.fh) * gateCoin.sh * ky;
    const r = Math.max(3, (gateCoin.rr / gateCoin.fw) * gateCoin.sw * kx);
    body.reference = { id: "coin", rle: circleRle(cx, cy, r, w, h), knownMm: Number($("coinKind").value), confidence: 0.85 };
  } else if (noScaleMode) body.note = "percent-only requested";
  $("status").textContent = "";
  try {
    const res = await fetch(base() + "/v1/observe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
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
    <div class="sevbar sev-${esc(String(f.severity))}"><span>${esc(String(f.severity)).toUpperCase()}</span><small>severity band</small></div>`;
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

function fillPhotoCard() {
  const card = $("numPhotoCard");
  if (!card || !stillDataUrl) return;
  card.hidden = false;
  $("numPhoto").src = stillDataUrl;
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
  if (!(await ensureMic())) return;
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
  if (!landed || clip.size === 0) { if (landed) heard.textContent = "Didn't catch anything — type the line."; return; }
  micState.textContent = "Transcribing…";
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(await clip.arrayBuffer());
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
    if (!res.ok || !j.ok) throw new Error(j.error ?? res.status);
    const text = String(j.result?.transcript ?? "").trim();
    if (!text) { heard.textContent = "Didn't catch anything — type the line."; return; }
    $("transcriptBox").value = text;
    heard.textContent = `“${text}”`;
    micState.textContent = "Heard";
  } catch (e) { $("voiceErr").textContent = `Transcription failed — type the line. (${e.message ?? e})`; }
}
mic.onclick = () => { if (listening) finishListening(true); else startListening(); };
$("sendBtn").onclick = () => runReport();
// Back chain follows the screen order: Say → Mark, Numbers → Say,
// Checked → Numbers, Report → Checked. (Was off by one, skipping a screen.)
$("backMark").onclick = () => show("sMark");

/* ---------- report / skeptic / render ---------- */
function updateOfflineBar() {
  const bar = document.getElementById("offlineBar");
  if (bar) bar.hidden = navigator.onLine;
}
window.addEventListener("online", updateOfflineBar);
window.addEventListener("offline", updateOfflineBar);
updateOfflineBar();

async function runReport() {
  if (!payloadObj) return;
  // Numbers screen first, with visible loading — no dead air on send.
  show("sNum");
  fillPhotoCard();
  setNumLoading(true);
  $("numError").hidden = true;
  $("measured").innerHTML = "";
  $("findings").innerHTML = "<p>Running gated report…</p>";
  drawScheme([]);
  const body = JSON.parse(JSON.stringify(payloadObj));
  body.transcript = $("transcriptBox").value;
  let res, j;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000);
    try {
      res = await fetch(base() + "/v1/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
      j = await res.json();
    } finally { clearTimeout(timer); }
  } catch (e) { j = { ok: false, error: e instanceof Error && e.name === "AbortError" ? "timed out after 45 s" : "backend unreachable" }; res = { status: 0 }; }
  $("raw").textContent = JSON.stringify(j, null, 2);
  setNumLoading(false);
  if (!res.ok || !j.ok) {
    const fails = res.status === 503 ? [j.error ?? "API key missing"] : (j.details ?? j.failures ?? [j.error]);
    const title = res.status === 503 ? "AI findings unavailable" : (!navigator.onLine ? "You are offline" : res.status === 422 ? "Evidence gate failed" : "Report failed");
    $("findings").innerHTML =
      `<div class="statecard err" role="alert"><span class="badge fail">${res.status === 503 ? "NO KEY" : res.status === 422 ? "GATED" : "ERROR"}</span> ` +
      `<b>${esc(title)}</b><pre style="margin-top:8px">${esc(JSON.stringify(fails, null, 2))}</pre>` +
      `<button class="btn-dark" type="button" id="reportRetry" style="width:100%;margin-top:8px">Try again</button></div>`;
    const rb = document.getElementById("reportRetry");
    if (rb) rb.onclick = () => runReport();
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
$("toCheck").onclick = () => { resetCheckState(); show("sCheck"); runChecksAuto(); };
$("toReport").onclick = () => { if (canProceedToReport()) show("sReport"); };
$("backSay").onclick = () => show("sSay");
$("backNum").onclick = () => show("sNum");
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
  if (s) {
    if (checkState.skeptic === "loading") s.textContent = "Asking the skeptic model…";
    else if (checkState.skeptic === "idle") s.textContent = "Waiting — runs automatically, or tap Ask skeptic.";
  }
  const x = $("xStatus");
  if (x) {
    if (checkState.xcheck === "loading") x.textContent = "Asking SAM 3.1…";
    else if (checkState.xcheck === "idle") x.textContent = "Waiting — runs automatically, or tap Cross-check.";
  }
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
async function runSkeptic(auto) {
  if (checkState.skeptic === "loading") return;
  if (!lastMeasurement) { if (!auto) $("skStatus").textContent = "run report first"; return; }
  checkState.skeptic = "loading";
  renderCheckCard(); updateReportGate();
  $("skOut").innerHTML = `<div class="skel" role="status" aria-label="Skeptic is checking"></div>`;
  try {
    const res = await fetch(base() + "/v1/skeptic", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: $("transcriptBox").value, findings: lastMeasurement.findings, receipts: lastMeasurement.receipts }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    const rows = (j.result.findings ?? []).map((f) => {
      const disputed = /disputed/i.test(f.statement || "");
      return `<li>${verdictBadge(disputed ? "DISPUTED" : "AGREED")} ${esc(f.statement ?? "")}<br/><small>cites: ${esc((f.citations ?? []).join(", "))}</small></li>`;
    }).join("");
    $("skOut").innerHTML = `<ul>${rows}</ul>`;
    $("skStatus").textContent = `skeptic ok ${j.requestId ?? ""}`.trim();
    setCheck("skeptic", "ok");
  } catch (e) {
    $("skOut").innerHTML = `<div class="statecard err" role="alert"><b>Skeptic check failed.</b><p style="margin:8px 0 12px;color:#5b6b8c">${esc(e instanceof Error ? e.message : String(e))}</p><button class="btn-dark" type="button" id="skRetry" style="width:100%">Retry skeptic</button></div>`;
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
    const segRes = await fetch(base() + "/v1/segment", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageUrl: photo.toDataURL("image/jpeg", 0.85),
        width: photo.width, height: photo.height,
        points: dmg.points.map(([x, y]) => ({ x, y })),
      }),
    });
    const seg = await segRes.json().catch(() => ({}));
    if (!segRes.ok || !seg.ok) throw new Error(seg.error ?? "SAM segment failed");
    const record = seg.result?.records?.[0];
    if (!record) throw new Error("SAM found nothing there — tap the middle of the damage and retry.");
    const ccRes = await fetch(base() + "/v1/crosscheck", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: encodeRle(dmg.mask, photo.width, photo.height), b: record.rle, threshold: 0.5 }),
    });
    const cc = await ccRes.json().catch(() => ({}));
    if (!ccRes.ok || !cc.ok) throw new Error(cc.error ?? "cross-check failed");
    const x = $("xStatus");
    x.innerHTML = "";
    const chip = document.createElement("span");
    chip.className = `badge ${cc.result.verdict === "AGREED" ? "ok" : "fail"}`;
    chip.textContent = `${cc.result.verdict} · IoU ${cc.result.iou}`;
    x.appendChild(chip);
    setCheck("xcheck", "ok");
  } catch (e) {
    const x = $("xStatus");
    x.innerHTML = `<div class="statecard err" role="alert"><b>Cross-check failed.</b><p style="margin:8px 0 12px;color:#5b6b8c">${esc(e instanceof Error ? e.message : String(e))}</p><button class="btn-ghostline" type="button" id="xRetry" style="width:100%">Retry cross-check</button></div>`;
    const b = document.getElementById("xRetry");
    if (b) b.onclick = () => { checkState.xcheck = "idle"; runXcheck(false); };
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
  payloadObj = null; lastMeasurement = null;
  dmg = { points: [], pointMasks: [], mask: null, iou: 0 };
  gateCoin = null; stillDataUrl = ""; noScaleMode = false; coinLabel = "";
  history.length = 0; smooth = null; coinSeen = false;
  $("transcriptBox").value = ""; $("heard").textContent = "";
  $("voiceErr").textContent = ""; $("raw").textContent = "{}";
  $("measured").innerHTML = ""; $("findings").innerHTML = ""; drawScheme([]);
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
    document.querySelector("#annexWrap .skel")?.remove();
    const dl = $("dl");
    dl.href = url;
    dl.download = "snapclaim-annexure.svg";
    dl.style.display = "block";
    dl.textContent = "Download SVG annexure";
    fillReportDoc(true);
    setShareCopyEnabled(true);
    state.textContent = "";
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
    scaleReference: { id: "coin-10inr", knownMm: 27, lengthPx: 287, confidence: 0.88 },
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
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
