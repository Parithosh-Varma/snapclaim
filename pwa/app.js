const $ = (id) => document.getElementById(id);

function base() { return $("base").value.replace(/\/$/, ""); }

$("health").onclick = async () => {
  try {
    const r = await fetch(base() + "/v1/health");
    const j = await r.json();
    $("healthOut").textContent = `ok v${j.version} mode:${j.mode}`;
    $("healthOut").className = "is-ok";
  } catch (e) {
    $("healthOut").textContent = "unreachable — run npm run backend:start";
    $("healthOut").className = "is-bad";
  }
};

// ---- photo intake + on-device segmentation (transformers.js SlimSAM, in sam-worker.js) ----
// 512 keeps Worker CPU alive: skeletonize is O(pixels × passes), 1024² trips the free-tier limit
// and the edge returns a no-CORS error page the browser reports as a CORS failure.
const MAX_SIDE = 512;
const COLORS = { damage: [196, 31, 41], coin: [15, 122, 54] };

let photo = null; // offscreen canvas holding the downscaled photo
let photoId = 0, ready = false;
let active = "damage";
// per step: tap points in photo pixels, one SAM mask per tap, and their union (row-major 0/1)
const emptyStep = () => ({ points: [], pointMasks: [], mask: null, iou: 0 });
const steps = { damage: emptyStep(), coin: emptyStep() };

// The model runs in a worker so the ~30 s embedding never freezes the page.
// A worker that fails to start only disables outlining, not the rest of the page.
let worker = null;
const pending = new Map();
let nextId = 0;
function samWorker() {
  if (worker) return worker;
  // ?device=wasm|webgpu on the page URL forces the worker's backend, for comparisons.
  const url = new URL("./sam-worker.js", import.meta.url);
  const device = new URLSearchParams(location.search).get("device");
  if (device) url.searchParams.set("device", device);
  worker = new Worker(url, { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "decoded") {
      const p = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) p?.reject(new Error(data.error));
      else p?.resolve(data.result);
      return;
    }
    if (data.photoId !== undefined && data.photoId !== photoId) return; // stale photo
    if (data.type === "progress") $("status").textContent = `Downloading model… ${data.percent}%`;
    else if (data.type === "ready") {
      ready = true;
      $("status").textContent = "Ready. Mark the damage, then the coin.";
      console.info(`[sam] embedded on ${data.device} in ${data.embedMs} ms`);
    } else if (data.type === "error") {
      $("status").textContent = `The outlining model failed to load (${data.message}). Check your connection and retry.`;
    }
  };
  worker.onerror = (e) => {
    $("status").textContent = `The outlining model failed to start (${e.message ?? "worker error"}).`;
  };
  return worker;
}

function decodePoint(point, preferSmallest) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    samWorker().postMessage({ type: "decode", id, photoId, point, preferSmallest });
  });
}

document.querySelectorAll("[data-line]").forEach((b) => {
  b.onclick = () => { $("transcript").value = b.dataset.line; };
});

async function handlePhotoFile(f) {
  if (!f) return;
  $("photoName").textContent = f.name || "Pasted image";
  $("pillPhoto")?.classList.add("done");
  $("measure").disabled = true;
  ready = false;
  photoId++;
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
  photo.getContext("2d", { willReadFrequently: true }).drawImage(bmp, 0, 0, photo.width, photo.height);
  $("canvas").width = photo.width;
  $("canvas").height = photo.height;
  $("canvas").style.display = "block";
  $("steps").style.display = "block";
  document.body.classList.add("has-photo");
  redraw();
  $("status").textContent = "Preparing the photo… (you can look around; the page stays usable)";
  const image = photo.getContext("2d").getImageData(0, 0, photo.width, photo.height);
  samWorker().postMessage({ type: "embed", photoId, image: { data: image.data, width: image.width, height: image.height } }, [image.data.buffer]);
}

$("photo").onchange = () => handlePhotoFile($("photo").files?.[0]);

// Cmd/Ctrl+V anywhere: grab the first image in the clipboard.
document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  const f = item?.getAsFile();
  if (f) {
    e.preventDefault();
    handlePhotoFile(f);
  }
});

function redraw() {
  const c = $("canvas"), ctx = c.getContext("2d", { willReadFrequently: true });
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
  $("pillMark")?.classList.toggle("done", !!steps.damage.mask);
}

async function segment(name) {
  const st = steps[name];
  st.pointMasks.length = Math.min(st.pointMasks.length, st.points.length);
  if (!st.points.length) {
    st.mask = null;
    redraw();
    return;
  }
  if (!ready) {
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
  for (const [key, id] of [["damage", "stepDamage"], ["coin", "stepCoin"]]) {
    $(id).classList.toggle("is-active", name === key);
    $(id).setAttribute("aria-pressed", String(name === key));
  }
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
    $("status").textContent = "Backend didn't answer (Worker CPU cap on big photos?) — try local: npm run backend:start, set Backend to http://127.0.0.1:8787";
    return;
  }
  if (!res.ok || !j.ok) {
    $("status").textContent = `Backend error: ${j.error ?? res.status}`;
    return;
  }
  $("payload").value = JSON.stringify(j.result, null, 2);
  const warnings = shapeWarnings(j.result);
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
  if (warnings.length) $("measured").insertAdjacentHTML("beforeend", warnings.map((w) => `<p><span class="badge">CHECK</span> ${w}</p>`).join(""));
  await runReport(true);
};

// The coin and crack shape checks from /v1/observe, in words the user can act on.
function shapeWarnings(result) {
  const out = [];
  const coin = result.referenceCheck;
  if (coin?.rejected) {
    const fix = /tilted/.test(coin.rejected) ? "Retake the photo from more directly in front." : "Undo the coin taps and tap its centre again.";
    out.push(`Coin not used: ${coin.rejected}. ${fix}`);
  } else if (coin?.tiltDeg >= 12) {
    out.push(`The wall is seen at a ${Math.round(coin.tiltDeg)}° angle (from the coin's shape); crack lengths are corrected for it.`);
  }
  for (const m of result.masks) {
    if (!m.blockyAreaPx) continue;
    const share = Math.round((100 * m.blockyAreaPx) / m.areaPx);
    out.push(`${m.blockyRegionCount} piece(s) of the ${m.label} mask look blocky, not crack-shaped (${share}% of its area). Undo the tap that grabbed them.`);
  }
  for (const m of result.masks) {
    if (!m.straightAreaPx) continue;
    const share = Math.round((100 * m.straightAreaPx) / m.areaPx);
    out.push(`${m.straightRegionCount} piece(s) of the ${m.label} mask have a ruler-straight edge, like a ledge or frame rather than a crack (${share}% of its area). Undo the tap that grabbed them.`);
  }
  return out;
}

function measuredRows(findings) {
  return findings.map((f) => {
    const mm = f.crackLengthMm === null ? "—" : `${f.crackLengthMm} mm`;
    return `<li><b>${f.label}</b> ${f.percent}% · ${mm} · <span class="badge ok">${f.severity}</span>${f.statement ? `<br/><small>${f.statement}</small>` : ""}</li>`;
  }).join("");
}

function showMeasured(result) {
  $("pillReport")?.classList.add("done");
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
  if (!Array.isArray(body.masks) || body.masks.length === 0) {
    $("status").textContent = "Measure first — no measured payload yet.";
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
  // The annexure draws the measured outlines over the photo itself, embedded as a JPEG.
  if (body.overlay && photo) body.overlay.photoHref = photo.toDataURL("image/jpeg", 0.8);
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

