const $ = (id) => document.getElementById(id);

const FIXTURE = {
  component: { id: "wall-panel-north", areaPx: 480000, confidence: 0.93 },
  masks: [
    { id: "crack-1", label: "crack", areaPx: 24800, skeletonPx: 913, regionCount: 1, confidence: 0.88 },
    { id: "stain-1", label: "stain", areaPx: 6200, regionCount: 2, confidence: 0.71 }
  ],
  scaleReference: { id: "coin-10inr", knownMm: 27, lengthPx: 287, confidence: 0.88 }
};

function base() { return $("base").value.replace(/\/$/, ""); }

$("fixture").onclick = () => {
  $("payload").value = JSON.stringify(FIXTURE, null, 2);
  $("status").textContent = "fixture loaded";
};

$("health").onclick = async () => {
  try {
    const r = await fetch(base() + "/v1/health");
    const j = await r.json();
    $("healthOut").textContent = `ok v${j.version} mode:${j.mode}`;
  } catch (e) {
    $("healthOut").textContent = "unreachable — run npm run backend:start";
  }
};

$("photo").onchange = () => {
  const f = $("photo").files?.[0];
  if (!f) return;
  const img = $("preview");
  img.src = URL.createObjectURL(f);
  img.style.display = "block";
};

$("send").onclick = async () => {
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
  if (!res.ok || !j.ok) {
    $("status").textContent = `gate ${res.status}`;
    const fails = j.details ?? j.failures ?? [j.error];
    $("findings").innerHTML = `<span class="badge fail">GATED</span><pre>${String(JSON.stringify(fails, null, 2))}</pre>`;
    drawScheme([]);
    return;
  }
  $("status").textContent = `ok ${j.requestId} ${j.durationMs}ms`;
  const rows = j.result.findings.map((f) => {
    const mm = f.crackLengthMm === null ? "—" : `${f.crackLengthMm} mm`;
    return `<li><b>${f.label}</b> ${f.percent}% · ${mm} · <span class="badge ok">${f.severity}</span><br/><small>${f.statement ?? ""}</small></li>`;
  }).join("");
  const gate = j.result.gate?.ok ? `<span class="badge ok">GATE PASS</span>` : `<span class="badge fail">GATE FAIL</span>`;
  $("findings").innerHTML = `${gate}<ul>${rows}</ul>`;
  drawScheme(j.result.measurement?.findings ?? j.result.findings ?? []);
};

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

$("fixture").click();
