const $ = (id) => document.getElementById(id);

function base() { return $("base").value.replace(/\/$/, ""); }

$("health").onclick = async () => {
  try {
    const r = await fetch(base() + "/v1/health");
    const j = await r.json();
    $("healthOut").textContent = `ok v${j.version} mode:${j.mode}`;
  } catch (e) {
    $("healthOut").textContent = "unreachable — run npm run backend:start";
  }
};

// ---- photo intake + on-device segmentation (transformers.js, SlimSAM) ----
const TF_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
const MODEL_ID = "Xenova/slimsam-77-uniform";
const MAX_SIDE = 1024;
const COLORS = { damage: [196, 31, 41], coin: [15, 122, 54] };

let tf = null, model = null, processor = null;
let rawImage = null, embeddings = null;
let photo = null; // offscreen canvas holding the downscaled photo
let active = "damage";
// per step: tap points in photo pixels, one SAM mask per tap, and their union (row-major 0/1)
const emptyStep = () => ({ points: [], pointMasks: [], mask: null, iou: 0 });
const steps = { damage: emptyStep(), coin: emptyStep() };

async function loadModel() {
  if (model) return;
  // dynamic import so a CDN failure only disables outlining, not the rest of the page
  tf = await import(TF_URL);
  const progress_callback = (p) => {
    if (p.status === "progress") $("status").textContent = `Downloading model… ${Math.round(p.progress)}%`;
  };
  model = await tf.SamModel.from_pretrained(MODEL_ID, { progress_callback });
  processor = await tf.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });
}

$("photo").onchange = async () => {
  const f = $("photo").files?.[0];
  if (!f) return;
  $("measure").disabled = true;
  embeddings = null;
  for (const k of Object.keys(steps)) steps[k] = emptyStep();
  let bmp;
  try {
    bmp = await createImageBitmap(f);
  } catch {
    $("status").textContent = "Could not read that photo. Try another one.";
    return;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  photo = document.createElement("canvas");
  photo.width = Math.round(bmp.width * scale);
  photo.height = Math.round(bmp.height * scale);
  photo.getContext("2d").drawImage(bmp, 0, 0, photo.width, photo.height);
  $("canvas").width = photo.width;
  $("canvas").height = photo.height;
  $("canvas").style.display = "block";
  $("steps").style.display = "block";
  redraw();
  try {
    $("status").textContent = "Preparing the photo…";
    await loadModel();
    const blob = await new Promise((r) => photo.toBlob(r, "image/png"));
    rawImage = await tf.RawImage.read(URL.createObjectURL(blob));
    // image embeddings are computed once per photo; point prompts reuse them
    const inputs = await processor(rawImage);
    embeddings = await model.get_image_embeddings(inputs);
    $("status").textContent = "Ready. Mark the damage, then the coin.";
  } catch (e) {
    $("status").textContent = `The outlining model failed to load (${e.message ?? e}). Check your connection and retry.`;
  }
};

function redraw() {
  const c = $("canvas"), ctx = c.getContext("2d");
  ctx.drawImage(photo, 0, 0);
  for (const [name, st] of Object.entries(steps)) {
    const [r, g, b] = COLORS[name];
    if (st.mask) {
      const img = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < st.mask.length; i++) {
        if (!st.mask[i]) continue;
        const o = i * 4;
        img.data[o] = img.data[o] * 0.55 + r * 0.45;
        img.data[o + 1] = img.data[o + 1] * 0.55 + g * 0.45;
        img.data[o + 2] = img.data[o + 2] * 0.55 + b * 0.45;
      }
      ctx.putImageData(img, 0, 0);
    }
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    for (const [x, y] of st.points) {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(5, c.width / 120), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  $("measure").disabled = !steps.damage.mask;
}

// One SAM decoder run per tap, then union. Prompting all taps at once makes SAM
// outline the object a thin crack runs through instead of the crack itself.
// Cracks are thin: SAM's highest-scoring candidate is often the wall the crack runs
// through (71% of the photo on a real facade), so damage takes the smallest candidate
// that still scores MIN_FINE_SCORE. Coins are compact, so they keep the best score.
const MIN_FINE_SCORE = 0.5;

async function decodePoint(point, preferSmallest) {
  // input_points shape: [image][prompt][point][x,y], in original image pixels
  const inputs = await processor(rawImage, { input_points: [[point]] });
  const outputs = await model({ ...embeddings, input_points: inputs.input_points, input_labels: inputs.input_labels });
  // masks[0] has dims [1, 3, H, W]: three candidate masks at original size
  const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const scores = outputs.iou_scores.data; // 3 scores, one per candidate
  const [, , h, w] = masks[0].dims;
  const areaOf = (k) => {
    let n = 0;
    for (const v of masks[0].data.subarray(k * h * w, (k + 1) * h * w)) if (v) n++;
    return n;
  };
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  if (preferSmallest) {
    let fine = -1, fineArea = Infinity;
    for (let i = 0; i < scores.length; i++) {
      const a = areaOf(i);
      if (scores[i] >= MIN_FINE_SCORE && a > 0 && a < fineArea) { fine = i; fineArea = a; }
    }
    if (fine >= 0) best = fine;
  }
  const m = masks[0].data.subarray(best * h * w, (best + 1) * h * w);
  const out = new Uint8Array(h * w);
  let area = 0;
  for (let i = 0; i < out.length; i++) if (m[i]) { out[i] = 1; area++; }
  return area ? { mask: out, iou: scores[best] } : null;
}

async function segment(name) {
  const st = steps[name];
  st.pointMasks.length = Math.min(st.pointMasks.length, st.points.length);
  if (!st.points.length) {
    st.mask = null;
    redraw();
    return;
  }
  if (!embeddings) {
    $("status").textContent = "The photo is still being prepared. Wait a moment.";
    return;
  }
  $("status").textContent = "Outlining…";
  try {
    while (st.pointMasks.length < st.points.length) {
      st.pointMasks.push(await decodePoint(st.points[st.pointMasks.length], name === "damage"));
    }
    const found = st.pointMasks.filter(Boolean);
    if (!found.length) {
      st.mask = null;
      $("status").textContent = "No mask found there. Tap closer to the middle of it.";
    } else {
      const union = new Uint8Array(found[0].mask.length);
      for (const { mask } of found) for (let i = 0; i < union.length; i++) union[i] |= mask[i];
      st.mask = union;
      // the union is only as trustworthy as its weakest piece
      st.iou = Math.min(...found.map((f) => f.iou));
      const missed = st.pointMasks.length - found.length;
      $("status").textContent = `Outlined (${Math.round(st.iou * 100)}% sure)` +
        (missed ? `; ${missed} tap${missed > 1 ? "s" : ""} found nothing.` : ".");
    }
  } catch (e) {
    st.mask = null;
    $("status").textContent = `Outlining failed (${e.message ?? e}).`;
  }
  redraw();
}

// Tap or click: scale from displayed size to canvas pixels, add a point to the active step.
$("canvas").onpointerdown = (ev) => {
  if (!photo) return;
  const c = $("canvas"), r = c.getBoundingClientRect();
  const x = Math.round((ev.clientX - r.left) * (c.width / r.width));
  const y = Math.round((ev.clientY - r.top) * (c.height / r.height));
  steps[active].points.push([x, y]);
  segment(active);
};

function setActive(name) {
  active = name;
  $("stepDamage").style.fontWeight = name === "damage" ? "bold" : "normal";
  $("stepCoin").style.fontWeight = name === "coin" ? "bold" : "normal";
}
$("stepDamage").onclick = () => setActive("damage");
$("stepCoin").onclick = () => setActive("coin");
$("undoDamage").onclick = () => { steps.damage.points.pop(); segment("damage"); };
$("undoCoin").onclick = () => { steps.coin.points.pop(); segment("coin"); };
$("clearDamage").onclick = () => { steps.damage = emptyStep(); redraw(); };
$("clearCoin").onclick = () => { steps.coin = emptyStep(); redraw(); };
setActive("damage");

// COCO RLE as src/vision/mask.ts decodeRle reads it: column-major pixel order
// (index i -> x = floor(i/h), y = i%h), first run counts zeros (may be 0).
function encodeRle(mask, w, h) {
  const counts = [];
  let cur = 0, run = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const v = mask[y * w + x] ? 1 : 0;
      if (v === cur) run++;
      else { counts.push(run); cur = v; run = 1; }
    }
  }
  counts.push(run);
  return { size: [h, w], counts };
}

$("measure").onclick = async () => {
  const d = steps.damage, k = steps.coin;
  if (!d.mask) {
    $("status").textContent = "Mark the damage first.";
    return;
  }
  const w = photo.width, h = photo.height;
  const body = {
    masks: [{
      id: "damage-1",
      label: $("damageLabel").value,
      rle: encodeRle(d.mask, w, h),
      confidence: d.iou
    }]
  };
  if (k.mask) {
    body.reference = {
      id: "coin",
      rle: encodeRle(k.mask, w, h),
      knownMm: Number($("coinKind").value),
      confidence: k.iou
    };
  }
  $("status").textContent = "Measuring…";
  let res, j;
  try {
    res = await fetch(base() + "/v1/observe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    j = await res.json();
  } catch {
    $("status").textContent = "backend unreachable — run npm run backend:start";
    return;
  }
  if (!res.ok || !j.ok) {
    $("status").textContent = `Backend error: ${j.error ?? res.status}`;
    return;
  }
  $("payload").value = JSON.stringify(j.result, null, 2);
  // Measuring is pure math and needs no key; show it before asking for AI findings.
  let measured;
  try {
    const mres = await fetch(base() + "/v1/measure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(j.result)
    });
    measured = await mres.json();
    if (!mres.ok || !measured.ok) throw new Error(measured.error ?? mres.status);
  } catch (e) {
    $("status").textContent = `Measuring failed (${e.message ?? e}).`;
    return;
  }
  showMeasured(measured.result);
  await runReport(true);
};

function measuredRows(findings) {
  return findings.map((f) => {
    const mm = f.crackLengthMm === null ? "—" : `${f.crackLengthMm} mm`;
    return `<li><b>${f.label}</b> ${f.percent}% · ${mm} · <span class="badge ok">${f.severity}</span>${f.statement ? `<br/><small>${f.statement}</small>` : ""}</li>`;
  }).join("");
}

function showMeasured(result) {
  const mode = result.mode === "absolute" ? "" : " (no coin: percent only)";
  $("measured").innerHTML = `<span class="badge ok">MEASURED${mode}</span><ul>${measuredRows(result.findings)}</ul>`;
  drawScheme(result.findings);
}

let lastMeasurement = null;

$("send").onclick = () => runReport();

// keepMeasured: called right after a real measurement, so a missing key must not hide it.
async function runReport(keepMeasured = false) {
  $("status").textContent = "sending…";
  $("findings").innerHTML = "";
  let body;
  try {
    body = JSON.parse($("payload").value || "{}");
  } catch {
    $("status").textContent = "bad JSON in masks box";
    return;
  }
  body.transcript = $("transcript").value;
  let res, j;
  try {
    res = await fetch(base() + "/v1/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    j = await res.json();
  } catch {
    $("status").textContent = "backend unreachable — run npm run backend:start";
    return;
  }
  $("raw").textContent = JSON.stringify(j, null, 2);
  if (res.status === 503) {
    $("status").textContent = "Measured. AI findings are off: the backend has no API key.";
    $("findings").innerHTML = `<span class="badge fail">AI FINDINGS UNAVAILABLE</span><pre>${j.error ?? "API key missing"}</pre>`;
    if (!keepMeasured) drawScheme([]);
    return;
  }
  if (!res.ok || !j.ok) {
    $("status").textContent = `gate ${res.status}`;
    const fails = j.details ?? j.failures ?? [j.error];
    $("findings").innerHTML = `<span class="badge fail">GATED</span><pre>${String(JSON.stringify(fails, null, 2))}</pre>`;
    if (!keepMeasured) drawScheme([]);
    return;
  }
  $("status").textContent = `ok ${j.requestId} ${j.durationMs}ms`;
  lastMeasurement = j.result.measurement ?? null;
  $("skepStatus").textContent = lastMeasurement ? "ready for skeptic" : "";
  const rows = measuredRows(j.result.findings);
  const gate = j.result.gate?.ok ? `<span class="badge ok">GATE PASS</span>` : `<span class="badge fail">GATE FAIL</span>`;
  $("findings").innerHTML = `${gate}<ul>${rows}</ul>`;
  drawScheme(j.result.measurement?.findings ?? j.result.findings ?? []);
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
  if (!findings.length) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", "8"); t.setAttribute("y", "24");
    t.setAttribute("font-size", "12");
    t.textContent = "no findings — gated or empty";
    svg.appendChild(t);
  }
}

$("skeptic").onclick = async () => {
  if (!lastMeasurement) {
    $("skepStatus").textContent = "run report first";
    return;
  }
  $("skepStatus").textContent = "asking…";
  $("skepticOut").innerHTML = "";
  let res, j;
  try {
    res = await fetch(base() + "/v1/skeptic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcript: $("transcript").value,
        findings: lastMeasurement.findings,
        receipts: lastMeasurement.receipts
      })
    });
    j = await res.json();
  } catch {
    $("skepStatus").textContent = "backend unreachable";
    return;
  }
  if (!res.ok || !j.ok) {
    const msg = j.error ?? "skeptic failed";
    $("skepStatus").textContent = `skeptic ${res.status}: ${msg}`;
    if (res.status === 503) $("skepticOut").innerHTML = "<small>live skeptic needs BASETEN_API_KEY; live keys missing on the server.</small>";
    return;
  }
  $("skepStatus").textContent = `skeptic ok ${j.requestId}`;
  const rows = j.result.findings.map((f) => {
    const disputed = /disputed/i.test(f.statement);
    const badge = disputed ? `<span class="badge fail">DISPUTED</span>` : `<span class="badge ok">AGREED</span>`;
    const cites = (f.citations ?? []).join(", ");
    return `<li>${badge} ${escapeHtml(f.statement)}<br/><small>cites: ${escapeHtml(cites)}</small></li>`;
  }).join("");
  $("skepticOut").innerHTML = `<ul>${rows}</ul>`;
};

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

$("render").onclick = async () => {
  let body;
  try {
    body = JSON.parse($("payload").value || "{}");
  } catch {
    return;
  }
  body.transcript = $("transcript").value;
  const res = await fetch(base() + "/v1/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await res.json();
  if (!res.ok || !j.ok) return;
  $("annex").innerHTML = j.result.svg;
  const blob = new Blob([j.result.svg], { type: "image/svg+xml" });
  const dl = $("dl");
  dl.href = URL.createObjectURL(blob);
  dl.download = "snapclaim-annexure.svg";
  dl.style.display = "inline";
  dl.textContent = "download svg";
};

