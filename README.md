# SnapClaim

> Point your phone at damage, speak one line about it - get a claim-ready report where every number is measured, cited, and checked before it ships. **Computed, not generated.**

[![tests](https://img.shields.io/badge/tests-347%20passing-brightgreen)](./tests)
[![node](https://img.shields.io/badge/node-%3E%3D22.18-339933)](./package.json)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

SnapClaim turns a damage photo plus a one-line description into a replayable evidence package: calibrated measurements (% damaged, crack length/width, area in cm²), each backed by a machine-checkable receipt, with AI-written findings that the server refuses to ship unless every number cites its receipt.

**Global by design:** the measurement engine assumes no currency, country, or language - a scale reference is any known-size object (coin, ruler, bank card), and the transcript is free text in any language. Voice is auto-detected by default; callers can still send an optional `languageBias`.

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

Requirements: Node.js ≥ 22.18. No keys needed - the default mode runs fully offline at $0.

```bash
npm install
npm test            # full suite, live paths with fetch stubbed, zero API spend
npm run typecheck
npm run backend:start   # http://127.0.0.1:8787
```

Then open `pwa/index.html` (or serve `pwa/` with any static server) and press **Use sample measurement** - the full loop runs in one tap: measure → gated findings → skeptic → SVG annexure. No photo needed.

```bash
npm run eval        # deterministic measurement bench
npm run replay -- request.json measurement.json   # recompute a report: MATCH or DRIFT
npm run backend:smoke   # end-to-end smoke against a running backend
```

## How it works

```
photo (+ coin for scale)  +  one spoken line
   ↓
MASKS - tap damage + coin: on-device SlimSAM preview, or live SAM 3.1
   point prompts; every mask becomes pixel statistics (area, skeleton,
   region count) with no model in the loop
   ↓
MATH - deterministic measurement engine
   % damaged · crack length (mm) · mean crack width (mm) · area (cm²)
   no scale reference → percentages only, clearly labeled, never upgraded
   ↓
RECEIPTS - every value carries its formula, inputs, confidence and id
   (R001…), serializable for replay
   ↓
FINDINGS - Muse Spark drafts sentences; the evidence gate ships them only if
   every number cites its receipt (else HTTP 422 with named failures)
   ↓
SKEPTIC - Spark Open re-derives the sentences from the receipts; the
   server separately re-measures the numbers from component + masks, so
   smuggled receipts fail closed. A DISPUTED verdict alone never kills a
   claim - independent mask agreement is the /v1/crosscheck IoU check
   (SlimSAM vs SAM), and a SAM mask error is common to both writer and
   skeptic. For a stronger check, re-segment with different prompts or
   thresholds and re-run crosscheck before trusting millimetres.
   ↓
ANNEXURE - code-drawn SVG: mask outlines, findings, receipts table
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

For local development, Settings → Developer → **Open admin panel** flips the running backend between mock and live without a restart. It calls `POST /v1/admin/mode` with `Authorization: Bearer $ADMIN_TOKEN`; the token is kept in `sessionStorage` only. The override lives in memory, so a restart or redeploy returns to the `MOCK_MODE` env default. Leave `ADMIN_TOKEN` unset on the public Worker - admin writes then return 403.

### Meta models used

| Role | Model | Where |
|---|---|---|
| Perception - damage masks | **SAM 3.1** | `https://api.meta.ai/v1` |
| Reasoning - evidence-gated findings | **Muse Spark 1.3** | `https://api.meta.ai/v1/chat/completions` |
| Independent skeptic (open weights) | **Spark Open** | `https://inference.baseten.co/v1` · `meta-models/muse-spark-open-1026` |
| Voice intake (any language; auto-detected, optional `languageBias`) | **Muse Voice Transcribe** | `POST https://api.meta.ai/v1/asr/transcribe` (file) · `wss://api.meta.ai/v1/asr/realtime` (live) |

No image generation anywhere: every visual is drawn in code from the masks and the math. (Muse Image is unavailable in our region under Meta's Geographic Use Policy - the receipts pattern turns that constraint into a design principle, not a product boundary.)

All Meta traffic goes through one canonical client, `backend/metaApi.ts`: the official endpoint (`https://api.meta.ai/v1`), `Authorization: Bearer $META_API_KEY` from the environment, OpenAI-compatible `POST {base}/chat/completions` calls, and a read-only `GET {base}/models` connectivity check. Providers (`backend/providers.ts`, `backend/transcribe.ts`, `backend/app.ts` describe) build on it; nothing calls the API anywhere else. Verify the integration end to end (read-only, $0) with:

```bash
node scripts/verify-meta.mjs   # GET {META_API_BASE}/models with the Bearer key
```

`meta.config.json` at the repo root records the endpoint, the model ids (`muse-spark`, `sam-3.1`, `muse-voice`, `muse-glimmer`, `muse-spark-open`), the four pipeline stages, and the verification flags (`meta_api_verified`, `open_weights_tuning`). `tests/metaIntegration.test.ts` asserts the manifest matches the code constants, so docs can't drift from the wiring.

## API reference

All replies are enveloped: `{ok: true, requestId, durationMs, result}`. Errors: `{ok: false, error, code, requestId, details?}` with HTTP 400 (bad input), 422 (gate or receipt mismatch), 429 (spend exhausted), 503 (key missing in live mode), 501 (unwired live path).

| Method & path | Input | Output |
|---|---|---|
| `GET /v1/health` | - | `{version, time, mode}` |
| `GET /v1/spend` | - | `{spentUsd, remainingUsd, limitUsd, entries}` |
| `POST /v1/measure` | `{component, masks, scaleReference?, thresholds?}` · keyless | `{findings, receipts, mode: "absolute" \| "percent-only"}` |
| `POST /v1/observe` | `{masks: [{id, label, rle, confidence}], component?, reference?}` (COCO RLE) · keyless | `{component, masks, scaleReference}` - feeds `/v1/report` |
| `POST /v1/crosscheck` | `{a, b}` COCO RLE masks of one frame, `threshold?` (default 0.5) · keyless | `{intersection, union, iou, dice, verdict: AGREED/DISPUTED, threshold}` - SlimSAM-vs-SAM check |
| `POST /v1/report` | measure fields + `transcript?` (+ optional `drafts[]` to test the gate) | `{measurement, findings, gate}` |
| `POST /v1/segment` | demo: `{imageId, labels, fixture}` · live: `{imageUrl, width, height, points[1–16]}` | demo: `{component, masks}` · live: `{records: [{objectId, box, confidence, rle}]}` |
| `POST /v1/transcribe` | demo: `{fixtureTranscript}` · live: `{audioBase64, languageBias?, keywords?}` (mono WAV) | `{transcript, audioDurationMs, turns}` |
| `POST /v1/findings` | `{transcript?, findings, receipts}` (+ `component`/`masks` triggers a server-side recomputation cross-check) | `{findings, gate}` |
| `POST /v1/skeptic` | same as findings | `{findings, gate}` |
| `POST /v1/render` | report body (+ optional `overlay`) | `{svg, gate, findings}` |

**The evidence gate** (`src/findings/evidence-gate.ts`) enforces, per finding: at least one cited measured number; **every** number in the statement matches a cited receipt within `max(0.011, 1%)` - typed, so `%` matches only `percent` receipts, `mm` only calibrated-length receipts, `cm²` only calibrated-area receipts, and a bare number matches nothing (a wrong or irrelevant citation fails: it simply does not back the token, HTTP 422 `EvidenceError` with named failures). All citations belong to one mask; ISO dates/times never count as evidence; severity words must match the cited severity receipt; unverifiable severity language (`severe`, `total loss`, `write-off`, …) fails. What the gate does **not** check: causation ("caused by…", "due to…") - measurement ≠ causation, a human decides; and whether the mask itself is right - that is the segmenter's job plus `/v1/crosscheck` and pixel-verified provenance.

**Measurement rules.** A coin is a px→mm factor only in the crack's plane with a roughly fronto-parallel photo - an oblique angle or an off-plane coin skews lengths, and no receipt carries a ± range for that yet. What the pipeline does instead: `/v1/observe` fits the coin ellipse and returns `referenceCheck` (`aspect`, `tiltDeg`, `edgeError`, `rejected`), tilt-corrects crack lengths from the ellipse (capped 1.7x), rejects covered/misshapen coins and coins flatter than 0.5 aspect (60° tilt), discounts reference confidence by mask fill, and drops the report to percent-only with a `scale_rejected` receipt below `MIN_REFERENCE_CONFIDENCE` (default 0.6). Every `scale_calibration` receipt carries the coplanar warning in its notes; a crack that leaves the frame is reported as a visible-length lower bound. Default severity bands: cosmetic below 1% damaged, moderate up to 5%, significant above - escalated by crack length ≥ 150 mm or ≥ 3 disconnected regions. Thresholds are configurable per call and printed in the report.

## Configuration

Copy `.env.example` to `.env` (never commit it). Every variable is optional; unset means demo mode.

| Variable | Default | Effect |
|---|---|---|
| `MOCK_MODE` | unset (= demo) | Set `0` for live calls; live routes fail closed without keys |
| `META_API_KEY` | - | Muse Spark findings, SAM 3.1 segment, voice transcribe |
| `META_API_BASE` | `https://api.meta.ai/v1` | Override for proxies / debugging |
| `BASETEN_API_KEY` | - | Spark Open skeptic |
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

**PWA** - any static host serves `pwa/` (no build step). Point the Backend URL box at the Worker. Installable via `manifest.webmanifest`; the service worker caches the shell and never caches `/v1`.

**Pages site** (public app, gated admin):

```bash
npm --prefix react run build
npx wrangler pages deploy react/dist --project-name snapclaim
```

Production is <https://snapclaim.pages.dev> - open to anyone. Only the dev panel at <https://snapclaim.pages.dev/admin> sits behind Cloudflare Access: anonymous requests there get a 302 to the team login, and only these three emails can get in (one-time PIN, no Cloudflare account or WARP client, 24-hour session):

- `parithvrmo@gmail.com`
- `therealtariqkhalif@gmail.com`
- `rizgarozan7@gmail.com`

`react/public/_redirects` rewrites `/admin/*` to the app shell; `react/src/App.tsx` boots straight into the admin screen when the path starts with `/admin`, and Settings → Developer → *Open admin panel* navigates there as a real page load so Access can challenge it.

Manage it in Zero Trust → Access → Applications (`SnapClaim admin`); adding a person means adding one Email include to the allow policy, no redeploy. The login host (`parithosh-varma.cloudflareaccess.com`) is the account-wide team domain, shared with the other Access apps. Check enforcement with:

```bash
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' https://snapclaim.pages.dev/admin
# 302 -> https://parithosh-varma.cloudflareaccess.com/...
curl -s -o /dev/null -w '%{http_code}\n' https://snapclaim.pages.dev/
# 200
```

The backend Worker is a separate hostname and is **not** behind Access; it relies on `ALLOWED_ORIGINS`, the spend cap, and `ADMIN_TOKEN` (unset in production, so admin writes return 403). Preview/deployment URLs (`<hash>.snapclaim.pages.dev`) are public and not behind the `/admin` app.

### Self-hosted backend

The app keeps one strict backend policy in places that must stay in sync: the `<meta>` CSP `connect-src` in `pwa/index.html` (and `react/index.html`), the matching `Content-Security-Policy` response header in `pwa/_headers` (and `react/public/_headers`), and the `isAllowedBackendUrl()` allowlist in `pwa/app.js` (and `react/src/lib/api.ts`). Only `https://snapclaim-backend.parithosh.workers.dev` and loopback `http` (`localhost`, `127.0.0.1`, `[::1]`) are allowed; anything else shows "This backend isn't allowed by the app's security policy". To point at your own Worker: add its `https://host` to `connect-src` in both HTML files and both `_headers` files **and** to `DEFAULT_BACKEND_HOST`/`isAllowedBackendUrl` in both JS/TS files. `tests/pwa-csp-allowlist.test.ts` and `tests/csp-headers.test.ts` fail if they drift apart.

### Docker

`Dockerfile` + `compose.yaml` run the backend anywhere Docker runs. Mock mode by default ($0 spend, no keys needed):

```bash
docker compose up --build   # API on http://localhost:8787, /v1/health for checks
```

For live calls, put real keys in `.env` (same file as `backend:live`); compose reads it automatically. The image is Node 22 Alpine, installs production deps only, exposes `8787`, and ships a `HEALTHCHECK` on `/v1/health`.

## Open-weights fine-tuning

`finetune/` distills the receipt-cited findings behavior into open-weights chat models so the skeptic path (and future on-device drafts) can run without a vendor API:

| Target | Role |
|---|---|
| `muse-glimmer` | Small on-device chat model: short damage verdicts |
| `muse-spark-open` | Open findings model (Baseten mirror of Spark): full receipt-cited drafts |

```bash
pip install -r finetune/requirements.txt   # torch + transformers + datasets + peft (training only)
python3 finetune/dataset.py --target muse-glimmer          # JSONL rows from fixtures/expected + fixtures/masks
python3 finetune/train.py --target muse-glimmer --data finetune/data/train.jsonl --smoke-test   # validates config + schema, $0, no weights
python3 finetune/train.py --target muse-spark-open --data finetune/data/train.jsonl --out finetune/checkpoints/spark-open-lora   # real LoRA SFT (needs HF_MODEL_REPO + weights access; --push uploads with HF_TOKEN)
```

Base weights resolve from the `HF_MODEL_REPO` env var (no registry URL hardcoded); checkpoints land in `finetune/checkpoints/` (gitignored build artifacts). Point the skeptic provider at a checkpoint and re-run `npm run eval` - gate pass rate must not regress vs the API model.

## Cost and limits

Per-claim live cost at current pricing: SAM 3.1 ≈ $0.0025/image, voice ≈ $0.0005 per 10 s line, skeptic per Baseten token rates, Spark findings metered at $0 until Meta publishes pricing. The default $5 cap covers well over a thousand full live claims.

Hard limits: 50 masks per call (chunk above), 1–16 point prompts per segment call, 1 MB JSON body on Node, 4 MB audio uploads, 10 s voice clips, 512 px PWA photo side. The spend guard is per-process (per-isolate on Workers - use Durable Objects/D1 for a global cap).

## Privacy and security

- The photo stays on the phone: only COCO RLE masks travel to `/v1/observe`. Two explicit exceptions, both your tap: **Cross-check masks** sends the photo once to SAM 3.1 via the backend, and **Render** attaches it to the annexure. Only `data:`/`https:` URLs are accepted.
- Keys live in server env / Worker secrets, never in the PWA. Fail-closed 503 without them.
- Billable live routes are anonymous by design (public demo), so abuse is throttled in depth: per-IP rate limit keyed on the unspoofable socket address / `cf-connecting-ip` (never `X-Forwarded-For`), a pre-billing spend hold per in-flight call, the hard `SPEND_GUARD_USD` cap, and CORS deny-by-default in live mode without `ALLOWED_ORIGINS`.
- All model output rendered in the PWA is HTML-escaped; the page ships a Content-Security-Policy.
- `frame-ancestors` only works as an HTTP response header, so it is sent from `_headers` (`frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`) and deliberately left out of the `<meta>` CSP, where browsers ignore it and log "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element." `tests/csp-headers.test.ts` keeps the header and meta copies of the policy in sync.
- EXIF/XMP metadata is stripped from photos on intake.

## Evaluation

- `npm run eval` - deterministic bench over `fixtures/masks/*.json` vs `fixtures/expected/` (missing expected file = SKIP, never a pass). Current: 7 pass, 0 skip, 0 fail - wall-crack 5.17% / 85.9 mm / 2.6 mm wide / 2.19 cm² (significant), stain 1.29% percent-only (moderate).
- `npm run bench` - held-out refusal check: 12 cases, 1 archived run; the 4 public no-scale photos must stay percent-only (currently UNRUN until live runs are archived - a missing run fails strict mode, never passes).
- `npm run bench:gap` - guessed-vs-measured gap on scaled held-out cases with a tape ground truth (`bench/runs/` pipeline vs `bench/model-only/` photo-alone guess, same tape). First scored row, live 2026-11-02 output:

| Case (real fixture) | Tape truth | Measured (pipeline) | Model-only guess (photo alone) |
|---|---|---|---|
| `terrace-slab-tape-01` (terrace slab `DSC_0711.JPG`, builder tape 227 mm) | 227 mm | **218.5 mm** (err 8.5 mm, 3.7% - within ±10%) | 315 mm (err 88 mm, 38.8% - outside ±10%) |

  `measured: scored=1 medianAbsErrorMm=8.5 within10pct=100% refused=0 missing=0` · `model-only: scored=1 medianAbsErrorMm=88 within10pct=0% refused=0 missing=0`. Modest on purpose: n=1, and the rest of held-out is UNSCORED until more walls get a tape on them - see `bench/split.json`.
- `bench/split.json` - dev/held-out split, frozen before tuning (`frozenAt` 2026-10-28; a test fails if a frozen case is edited).
- `bench/score.ts` - skeptic DISPUTED scoring with missing-label accounting.
- Full write-up, baselines protocol and open gaps: [`docs/eval-report.md`](./docs/eval-report.md).

**Live demo:** <https://snapclaim.pages.dev> (public app; only `/admin` sits behind Cloudflare Access). The skeptic red-to-green in the demo runs on the real `terrace-slab-tape-01` fixture above - builder-measured slab, tape 227 mm - not a scripted mock.

## Project structure

```
src/engine/     measurement math, severity bands, session + receipts
src/vision/     RLE masks, skeletonize, observe, coin calibration, SAM 3.1 adapter
src/findings/   evidence gate (EvidenceError)
src/receipts/   receipt ledger (deterministic ids, JSONL replay)
src/render/     code-drawn SVG annexure
src/adapters/   deterministic mock vision + findings, live pipeline registry
src/config/     env config, spend guard
backend/        one router (Node server + Cloudflare Worker), providers, Meta API client (metaApi.ts), transcribe proxy
finetune/       open-weights LoRA workflow (dataset prep, training entry, checkpoints)
scripts/        verify-meta.mjs (read-only live API check)
pwa/            capture app: photo, tap-to-mask, hold-to-speak, report, skeptic, annexure
eval/           bench + replay CLI
bench/          held-out split + dispute scorer
fixtures/       masks, expected outputs, scale references (photos gitignored)
meta.config.json  endpoint, model ids, pipeline stages, verification flags
Dockerfile, compose.yaml  containerized backend (mock by default)
tests/          full suite, mock by default, live paths with stubbed fetch
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
- **Staged photos are a known limit.** Receipts make measurement replayable and partly tamper-evident; they do not prove provenance. `npm run replay` re-runs the math and prints MATCH/DRIFT plus a SHA-256 receipt-chain hash - but a MATCH only proves the report was *computed* from those inputs, not that the inputs are original: anyone can edit the receipts and replay them consistently. Tamper-evidence needs the photo hashed at capture (before EXIF stripping), the chain hash pinned with the run, and a signature at capture - see `src/receipts/hash.ts`. Share links already carry an optional HMAC (`react/src/lib/share.ts`); absent `sig` = UNVERIFIED.
- No medical, health, or insurance-advice functionality. No image generation - every visual is drawn in code. SVG only (no PDF).
- No geo-circumvention, no VPN. Credits claimed only with each builder's own registration email; no pooling. Build-time tooling disclosed in `DEV-LOG.md`.

## Provenance and license

Built during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026) by a 3-person student team. Build log: [`DEV-LOG.md`](./DEV-LOG.md) (every live call recorded with its cost).

Apache-2.0. See [LICENSE](./LICENSE).
