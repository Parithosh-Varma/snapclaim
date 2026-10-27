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
  }).then((r) => r.json());
  if (!reported?.ok || reported?.result?.gate?.ok !== true) throw new Error("report failed: " + JSON.stringify(reported));
  console.log("report ok", JSON.stringify({ findings: reported.result.findings.length, gate: reported.result.gate.ok }));

  const gated = await fetch(`${base}/v1/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, drafts: [{ statement: "crack covers 99.99%.", citations: [] }] }),
  });
  if (gated.status !== 422) throw new Error("gate should 422, got " + gated.status);
  console.log("gate ok 422");

  const spend = await fetch(`${base}/v1/spend`).then((r) => r.json());
  if (typeof spend?.spentUsd !== "number" || spend.spentUsd !== 0) {
    throw new Error("spend should be $0 after mock run: " + JSON.stringify(spend));
  }
  console.log("spend ok $0");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
