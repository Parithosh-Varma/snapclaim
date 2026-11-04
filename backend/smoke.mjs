// Zero-deps smoke: boots health + measure, asserts shape. Run: npm run backend:smoke
const base = process.env.SMOKE_BASE ?? "http://127.0.0.1:8787";

async function main() {
  const health = await fetch(`${base}/v1/health`).then((r) => r.json());
  if (!health?.ok || typeof health?.version !== "string") throw new Error("health failed: " + JSON.stringify(health));
  console.log("health ok", health);

  const payload = {
    component: { id: "wall-1", areaPx: 100000, confidence: 0.95 },
    masks: [{ id: "m1", label: "crack", areaPx: 2500, skeletonPx: 220, confidence: 0.9 }],
    scaleReference: { id: "coin-1", knownMm: 25, lengthPx: 100, confidence: 0.95 },
    extra_future_field: "ignored",
  };
  const measured = await fetch(`${base}/v1/measure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
  if (!measured?.ok || !Array.isArray(measured?.result?.findings)) {
    throw new Error("measure failed: " + JSON.stringify(measured));
  }
  console.log("measure ok", JSON.stringify({ requestId: measured.requestId, durationMs: measured.durationMs, mode: measured.result.mode }));

  const reported = await fetch(`${base}/v1/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, transcript: "crack near window" }),
  });
  const live = health.mode === "live";
  const mock = health.mode === "mock";
  if (live || mock) {
    const body = await reported.json();
    if (!body?.ok || body?.result?.gate?.ok !== true) throw new Error("report failed: " + JSON.stringify(body));
    console.log(`report ok (${health.mode})`, JSON.stringify({ findings: body.result.findings.length, gate: body.result.gate.ok }));
  } else {
    // MOCK_MODE=0 with no keys: the backend must refuse, never fake findings.
    if (reported.status !== 503) throw new Error("report without keys should 503, got " + reported.status);
    console.log("report fails closed 503 (MOCK_MODE=0, no META_API_KEY)");
  }

  // One-call claim from masks: keyless, deterministic, works in mock and live.
  // A 100x100 frame with a one-pixel line across row 50 (COCO RLE: column-major,
  // runs start with zeros).
  const size = 100;
  const row = 50;
  const counts = [row];
  for (let x = 0; x < size; x++) {
    counts.push(1);
    counts.push(x === size - 1 ? size - row - 1 : size - 1);
  }
  const claimPayload = {
    masks: [{ id: "damage-1", label: "crack", confidence: 0.9, rle: { size: [size, size], counts } }],
    transcript: "crack across the panel",
    render: false,
  };
  const claimed = await fetch(`${base}/v1/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(claimPayload),
  });
  if (live || mock) {
    const body = await claimed.json();
    if (!body?.ok || body?.result?.gate?.ok !== true) throw new Error("claim failed: " + JSON.stringify(body));
    if (body.result.measurement?.provenance !== "pixel-verified") {
      throw new Error("claim must stay pixel-verified: " + JSON.stringify(body.result.measurement?.provenance));
    }
    console.log(`claim ok (${health.mode})`, JSON.stringify({ findings: body.result.findings.length, gate: body.result.gate.ok, provenance: body.result.measurement.provenance }));
  } else {
    // MOCK_MODE=0 with no keys: the findings provider is missing, so the claim
    // must refuse rather than invent sentences.
    if (claimed.status !== 503) throw new Error("claim without keys should 503, got " + claimed.status);
    console.log("claim fails closed 503 (MOCK_MODE=0, no META_API_KEY)");
  }

  const gated = await fetch(`${base}/v1/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, drafts: [{ statement: "crack covers 99.99%.", citations: [] }] }),
  });
  if (gated.status !== 422) throw new Error("gate should 422, got " + gated.status);
  console.log("gate ok 422");

  const spend = await fetch(`${base}/v1/spend`).then((r) => r.json());
  if (typeof spend?.spentUsd !== "number" || (!live && spend.spentUsd !== 0)) {
    throw new Error("spend should be $0 after this run: " + JSON.stringify(spend));
  }
  console.log("spend ok", spend.spentUsd);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
