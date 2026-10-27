# DEV-LOG

Honest, dated build log. Mock mode by default; every live API call gets recorded here with its cost.

## 2026-10-27 — Day 1: the deterministic core

**Shipped**

- Deterministic measurement engine: mask areas → area ratio and percent, calibrated crack length from a reference object in the same image plane, severity bands with thresholds printed into the report.
- Receipt ledger: every measured value carries its formula, inputs, confidence and a deterministic ID (`R001`…), serializable to JSONL for replay.
- Evidence gate: every number in a finding must match a cited receipt; millimetres require a calibrated-length receipt; unknown units and uncited numbers throw `EvidenceError` instead of shipping.
- Mock vision and findings adapters, so the full loop runs offline.
- Spend guard with a hard cap and per-call ledger; config defaults to mock mode and requires `MOCK_MODE=0` for live calls.
- 24 tests green, `tsc --noEmit` clean, $0 spent.
- Fixtures: synthetic wall-crack mask statistics plus a scale reference; real-photo checklist in `fixtures/README.md`.

**Not done yet**

- Real model calls (SAM 3.1, Muse Spark, Spark Open, voice transcription) — no keys in the repo, none needed for mock CI.
- PWA capture UI and the SVG/PDF annexure renderer.
- Real damage photos.

**Spend:** $0.00 (mock mode only).

Credits claim ✅ — billing verified, $150 active on 2026-10-27.

**Next:** live adapters behind the spend guard; real-photo intake; then the renderer.
