# SnapClaim

> Point your phone at damage, speak one line about it — get a claim-ready report where every number is measured, cited, and checked before it ships. **Computed, not generated.**

[![tests](https://img.shields.io/badge/tests-214%20passing-brightgreen)](./tests)
[![node](https://img.shields.io/badge/node-%3E%3D22.18-339933)](./package.json)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

SnapClaim turns a damage photo plus a one-line description into a replayable evidence package: calibrated measurements (% damaged, crack length/width, area in cm²), each backed by a machine-checkable receipt, with AI-written findings that the server refuses to ship unless every number cites its receipt.

**Global by design:** the measurement engine assumes no currency, locale, or language — a scale reference is any known-size object (coin, ruler, bank card), and the transcript is free text in any language. The demo is shot in India; nothing in the pipeline is India-specific.

## Contents

- [Quickstart](#quickstart)
- [How it works](#how-it-works)
- [Modes: demo vs live](#modes-demo-vs-live)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Deploying](#deploying)
- [Cost and limits](#cost-and-limits)
- [Privacy and security](#privacy-and-security)
- [Evaluation](#evaluation)
- [Project structure](#project-structure)
- [Development](#development)
- [Scope and boundaries](#scope-and-boundaries)
- [Provenance and license](#provenance-and-license)

## Quickstart

Requirements: Node.js ≥ 22.18. No keys needed — the default mode runs fully offline at $0.

```bash
npm install
npm test            # full suite, live paths with fetch stubbed, zero API spend
npm run typecheck
npm run backend:start   # http://127.0.0.1:8787
```

Then open `pwa/index.html` (or serve `pwa/` with any static server) and press **Use sample measurement** — the full loop runs in one tap: measure → gated findings → skeptic → SVG annexure. No photo needed.

```bash
npm run eval        # deterministic measurement bench
npm run replay -- request.json measurement.json   # recompute a report: MATCH or DRIFT
npm run backend:smoke   # end-to-end smoke against a running backend
```

## How it works

```
photo (+ coin for scale)  +  one spoken line
   ↓
MASKS — tap damage + coin: on-device SlimSAM preview, or live SAM 3.1
   point prompts; every mask becomes pixel statistics (area, skeleton,
   region count) with no model in the loop
   ↓
MATH — deterministic measurement engine
   % damaged · crack length (mm) · mean crack width (mm) · area (cm²)
   no scale reference → percentages only, clearly labeled, never upgraded
   ↓
RECEIPTS — every value carries its formula, inputs, confidence and id
   (R001…), serializable for replay
   ↓
FINDINGS — Muse Spark drafts sentences; the evidence gate ships them only if
   every number cites its receipt (else HTTP 422 with named failures)
   ↓
SKEPTIC — Spark Open re-checks the findings; unreproducible ones are
   printed DISPUTED, never hidden
   ↓
ANNEXURE — code-drawn SVG: mask outlines, findings, receipts table
```

Three principles run through all of it:

1. **No LLM touches the numbers.** Models write sentences; arithmetic is code.
2. **Fail closed.** No key → 503. No evidence → 422. Empty model output → error. The backend never invents a mask, a transcript, or a number.
3. **Everything replays.** `npm run replay` recomputes a report from request + receipts and prints MATCH or DRIFT.

## Modes: demo vs live

| | Demo (default) | Live (`MOCK_MODE=0` + keys) |
|---|---|---|
| Masks | Supplied fixture (`backend invents no masks`) | SAM 3.1 point prompts via `/v1/segment`; the PWA falls back to on-device SlimSAM on any failure |
| Findings / skeptic | Deterministic mocks ($0) | Muse Spark 1.3 / Spark Open on Baseten |
| Voice | Supplied `fixtureTranscript` | Muse Voice Transcribe proxy (`/v1/transcribe`) |
| Measure, observe, gate, render, replay | Real in both modes | Real in both modes |

The health badge reports the mode: `GET /v1/health` → `{mode: "mock" | "live" | "config-error"}`.

### Meta models used

| Role | Model | Where |
|---|---|---|
| Perception — damage masks | **SAM 3.1** | `https://api.meta.ai/v1` |
| Reasoning — evidence-gated findings | **Muse Spark 1.3** | `https://api.meta.ai/v1/chat/completions` |
| Independent skeptic (open weights) | **Spark Open** | `https://inference.baseten.co/v1` · `meta-models/muse-spark-open-1026` |
| Voice intake (any language; demoed in Hindi / Telugu / Hinglish) | **Muse Voice Transcribe** | `POST https://api.meta.ai/v1/asr/transcribe` (file) · `wss://api.meta.ai/v1/asr/realtime` (live) |

No image generation anywhere: every visual is drawn in code from the masks and the math. (Muse Image is unavailable in our region under Meta's Geographic Use Policy — the receipts pattern turns that constraint into a design principle, not a product boundary.)

## API reference

All replies are enveloped: `{ok: true, requestId, durationMs, result}`. Errors: `{ok: false, error, code, requestId, details?}` with HTTP 400 (bad input), 422 (gate or receipt mismatch), 429 (spend exhausted), 503 (key missing in live mode), 501 (unwired live path).

| Method & path | Input | Output |
|---|---|---|
| `GET /v1/health` | — | `{version, time, mode}` |
| `GET /v1/spend` | — | `{spentUsd, remainingUsd, limitUsd, entries}` |
| `POST /v1/measure` | `{component, masks, scaleReference?, thresholds?}` · keyless | `{findings, receipts, mode: "absolute" \| "percent-only"}` |
| `POST /v1/observe` | `{masks: [{id, label, rle, confidence}], component?, reference?}` (COCO RLE) · keyless | `{component, masks, scaleReference}` — feeds `/v1/report` |
| `POST /v1/crosscheck` | `{a, b}` COCO RLE masks of one frame, `threshold?` (default 0.5) · keyless | `{intersection, union, iou, dice, verdict: AGREED/DISPUTED, threshold}` — SlimSAM-vs-SAM check |
| `POST /v1/report` | measure fields + `transcript?` (+ optional `drafts[]` to test the gate) | `{measurement, findings, gate}` |
| `POST /v1/segment` | demo: `{imageId, labels, fixture}` · live: `{imageUrl, width, height, points[1–16]}` | demo: `{component, masks}` · live: `{records: [{objectId, box, confidence, rle}]}` |
| `POST /v1/transcribe` | demo: `{fixtureTranscript}` · live: `{audioBase64, languageBias?, keywords?}` (mono WAV) | `{transcript, audioDurationMs, turns}` |
| `POST /v1/findings` | `{transcript?, findings, receipts}` (+ `component`/`masks` triggers a server-side recomputation cross-check) | `{findings, gate}` |
| `POST /v1/skeptic` | same as findings | `{findings, gate}` |
| `POST /v1/render` | report body (+ optional `overlay`) | `{svg, gate, findings}` |

**The evidence gate** (`src/findings/evidence-gate.ts`) enforces, per finding: at least one cited measured number; every number matches a cited receipt within rounding tolerance; `%` numbers match `percent` receipts and `mm` numbers match calibrated-length receipts; severity words match the cited severity receipt; all citations belong to one mask; ISO dates never count as evidence. Violations throw `EvidenceError` (HTTP 422), listing each failure.

**Measurement rules.** Reference confidence below `MIN_REFERENCE_CONFIDENCE` (default 0.6) drops the report to percent-only with a `scale_rejected` receipt. Default severity bands: cosmetic below 1% damaged, moderate up to 5%, significant above — escalated by crack length ≥ 150 mm or ≥ 3 disconnected regions. Thresholds are configurable per call and printed in the report.

## Configuration

Copy `.env.example` to `.env` (never commit it). Every variable is optional; unset means demo mode.

| Variable | Default | Effect |
|---|---|---|
| `MOCK_MODE` | unset (= demo) | Set `0` for live calls; live routes fail closed without keys |
| `META_API_KEY` | — | Muse Spark findings, SAM 3.1 segment, voice transcribe |
| `META_API_BASE` | `https://api.meta.ai/v1` | Override for proxies / debugging |
| `BASETEN_API_KEY` | — | Spark Open skeptic |
| `BASETEN_API_BASE` | `https://inference.baseten.co/v1` | Override for proxies / debugging |
| `SPEND_GUARD_USD` | `5` | Hard cap on live spend; 429 at $0 remaining |
| `MIN_REFERENCE_CONFIDENCE` | `0.6` | Below this, reports stay percent-only |
| `PORT` | `8787` | Node server port |

## Deploying

**Backend** (one router, Node + Cloudflare Workers):

```bash
cd backend && npx wrangler deploy   # requires Cloudflare login; not run in CI
npx wrangler secret put META_API_KEY
npx wrangler secret put BASETEN_API_KEY   # when Baseten access is granted
```

**PWA** — any static host serves `pwa/` (no build step). Point the Backend URL box at the Worker. Installable via `manifest.webmanifest`; the service worker caches the shell and never caches `/v1`.

### Self-hosted backend

The app keeps one strict backend policy in two places that must stay in sync: the `<meta>` CSP `connect-src` in `pwa/index.html` (and `react/index.html`) and the `isAllowedBackendUrl()` allowlist in `pwa/app.js` (and `react/src/lib/api.ts`). Only `https://snapclaim-backend.parithosh.workers.dev` and loopback `http` (`localhost`, `127.0.0.1`, `[::1]`) are allowed; anything else shows "This backend isn't allowed by the app's security policy". To point at your own Worker: add its `https://host` to `connect-src` in both HTML files **and** to `DEFAULT_BACKEND_HOST`/`isAllowedBackendUrl` in both JS/TS files. `tests/pwa-csp-allowlist.test.ts` fails if the two drift apart.

## Cost and limits

Per-claim live cost at current pricing: SAM 3.1 ≈ $0.0025/image, voice ≈ $0.0005 per 10 s line, skeptic per Baseten token rates, Spark findings metered at $0 until Meta publishes pricing. The default $5 cap covers well over a thousand full live claims.

Hard limits: 50 masks per call (chunk above), 1–16 point prompts per segment call, 1 MB JSON body on Node, 4 MB audio uploads, 10 s voice clips, 512 px PWA photo side. The spend guard is per-process (per-isolate on Workers — use Durable Objects/D1 for a global cap).

## Privacy and security

- The photo stays on the phone: only COCO RLE masks travel to `/v1/observe`. Two explicit exceptions, both your tap: **Cross-check masks** sends the photo once to SAM 3.1 via the backend, and **Render** attaches it to the annexure. Only `data:`/`https:` URLs are accepted.
- Keys live in server env / Worker secrets, never in the PWA. Fail-closed 503 without them.
- All model output rendered in the PWA is HTML-escaped; the page ships a Content-Security-Policy.
- Note: `frame-ancestors` in the `<meta>` CSP is ignored by browsers — it only works as an HTTP response header, so the static host must send it (e.g. `Content-Security-Policy: frame-ancestors 'self'`). No meta-tag change can fix that; the directive is kept in the markup as documented intent.
- EXIF/XMP metadata is stripped from photos on intake.

## Evaluation

- `npm run eval` — deterministic bench over `fixtures/masks/*.json` vs `fixtures/expected/` (missing expected file = SKIP, never a pass). Current: wall-crack 5.17% / 85.9 mm / 2.6 mm wide / 2.19 cm² (significant), stain 1.29% percent-only (moderate).
- `bench/split.json` — dev/held-out split, frozen before tuning. Held-out cases are public no-scale photos that must stay percent-only.
- `bench/score.ts` — skeptic DISPUTED scoring with missing-label accounting.
- Full write-up, baselines protocol and open gaps: [`docs/eval-report.md`](./docs/eval-report.md).

## Project structure

```
src/engine/     measurement math, severity bands, session + receipts
src/vision/     RLE masks, skeletonize, observe, coin calibration, SAM 3.1 adapter
src/findings/   evidence gate (EvidenceError)
src/receipts/   receipt ledger (deterministic ids, JSONL replay)
src/render/     code-drawn SVG annexure
src/adapters/   deterministic mock vision + findings
src/config/     env config, spend guard
backend/        one router (Node server + Cloudflare Worker), providers, transcribe proxy
pwa/            capture app: photo, tap-to-mask, hold-to-speak, report, skeptic, annexure
eval/           bench + replay CLI
bench/          held-out split + dispute scorer
fixtures/       masks, expected outputs, scale references (photos gitignored)
tests/          214 tests, mock by default, live paths with stubbed fetch
```

## Development

| Command | What it does |
|---|---|
| `npm test` | Full suite (mock mode, stubbed live paths, $0) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run eval` | Deterministic bench |
| `npm run replay -- request.json measurement.json` | Recompute a report: MATCH or DRIFT (exit 1) |
| `npm run backend:start` / `backend:live` | Node server, mock / live (`.env`) |
| `npm run backend:smoke` | End-to-end smoke against a running backend |

## Scope and boundaries

- **Documentation, not advice.** No coverage decisions, no legal claims, no approval predictions. A human decides; SnapClaim produces the evidence package.
- **Measurement ≠ causation.** The chain proves what was measured, not who broke it.
- **Staged photos are a known limit.** Receipts make measurement replayable and partly tamper-evident; they do not prove provenance.
- No medical, health, or insurance-advice functionality. No image generation — every visual is drawn in code. SVG only (no PDF).
- No geo-circumvention, no VPN. Credits claimed only with each builder's own registration email; no pooling. Build-time tooling disclosed in `DEV-LOG.md`.

## Provenance and license

Built during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026) by a 3-person student team. Build log: [`DEV-LOG.md`](./DEV-LOG.md) (every live call recorded with its cost).

Apache-2.0. See [LICENSE](./LICENSE).
