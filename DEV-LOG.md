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

## 2026-10-27 — Day 1 (cont.): backend

**Shipped**

- `backend/` — one router (`handleRequest`) running on Node (`server.ts`, :8787) and Cloudflare Workers (`worker.ts` + `wrangler.toml`), zero dependencies.
- Routes: `GET /v1/health` (version + mode), `POST /v1/measure` (deterministic, keyless), `POST /v1/report` (measure → findings → Evidence Gate; uncited numbers return 422 with failures), `POST /v1/segment` (mock requires a supplied fixture — backend invents no masks; live SAM returns 501 until its request shape is verified), `POST /v1/findings` (live Muse Spark via chat completions, gated after drafting).
- Live routes fail closed: `503` when `MOCK_MODE=0` without `META_API_KEY`. Mock stays the default; 50-mask cap, 1 MB body cap, verbose enveloped errors.
- 31 tests green (7 new backend tests), `tsc --noEmit` clean, smoke script passes against a live local boot. $0 spent.

**Next:** verify SAM 3.1 live request shape with one guarded call; PWA capture; SVG/PDF renderer.

## 2026-10-28 — PWA capture (mock)

**Shipped**

- `pwa/index.html` + `pwa/app.js` — zero-deps static page: backend URL + health check, photo preview (preview only in mock), masks JSON box preloaded with wall-crack fixture, transcript line, `POST /v1/report`, findings + gate badges, schematic SVG bars (proportional, labeled schematic — not a photo overlay), raw JSON.
- Serve: any static server in `pwa/` (e.g. `npx serve pwa`), backend at `:8787`. E2E verified mock: 2 findings, gate pass. $0 spent.

**Next:** real SAM masks replace pasted JSON; SVG photo overlay + PDF annexure.

## 2026-10-28 — SVG annexure renderer

**Shipped**

- `src/render/svg.ts` — deterministic code-drawn annexure: findings with severity colors, receipts table with formulas, mode badge, transcript, replay note. Escapes hostile input. Exported from `src/index.ts`.
- `POST /v1/render` — runs gated report then returns `{svg, gate}`. Gated failures stay `422`.
- PWA render button + inline SVG + download link.
- 34 tests green, `tsc` clean, live render E2E `gate:true`. $0 spent. No PDF — per no-docs constraint, SVG only.

**Next:** one guarded live Spark findings call; real-photo intake; Worker deploy.

## 2026-10-28 — Spend wiring (no key needed)

**Shipped**

- `backend/spend.ts` — process-singleton `SpendGuard` from `SPEND_GUARD_USD`, `GET /v1/spend` ledger. Mock calls charge nothing.
- `backend/providers.ts` — live Spark path pre-checks `remainingUsd` (`429` at $0) and records `in=/out=` token usage at `$0` until pricing is confirmed. No hardcoded prices.
- 37 tests green (3 new spend tests), `tsc` clean, smoke asserts `spend $0`. Live still blocked on `.env` (`NO_ENV` verified) — SAM `501` untouched.

**Next:** real-photo intake (3–5 with coin/ruler); one live Spark smoke once key lands; Worker deploy.

## 2026-10-28 — First live Spark call ($0)

**Shipped**

- Live boot verified: `GET /v1/health` → `mode:live`, `GET /v1/spend` → `$10` cap, `$0` spent.
- One guarded `POST /v1/findings` on the wall-crack fixture: `200`, gate `ok:true`, 8 atomic findings (one per receipt — live model splits finer than the 2-statement mock). Usage recorded: `in=381 out=2658` tokens at `$0` (Meta pricing unconfirmed, no guessed rates).

**Spend:** $0.00. SAM stays `501` — shape still unverified, no call attempted.

**Next:** real-photo intake; Worker deploy; Spark Open skeptic via Baseten.

## 2026-10-28 — Skeptic wired, both live paths probed

**Shipped**

- Corrected open-weights id to `meta-models/muse-spark-open` (verified live in Baseten `/v1/models`; the `-1026` suffix does not exist). Pricing verified from the same listing: prompt $0.00000125 / completion $0.00000425 per token (`SPARK_OPEN_PRICE`), charged for real via `estimateCostUsd`.
- `POST /v1/skeptic` — Baseten chat-completions skeptic with independent system prompt, gated, spend-recorded. Mock-safe; `503` without key; `429` at $0.
- 40 tests green, `tsc` clean. $0 new spend.

**Verified live (no guessing)**

- SAM 3.1: not on `/chat/completions` (explicit 404: "Use /v1/responses"). On `/v1/responses` it returns `200 completed` with `images_processed:1` but empty text — mask output shape unresolved. `/v1/segment` stays `501`; never fakes a mask.
- Skeptic: key valid for `/v1/models` (`200`, 19 models) but inference returns `403 "please check the api-key"`. Access pending — likely the unsubmitted Baseten form / workspace grant. Code complete; live smoke waits on access.

**Next:** submit the Baseten form for `meta-models/muse-spark-open`; real-photo intake; Worker deploy.

## 2026-10-28 — Text-first PWA + skeptic view

**Shipped**

- PWA section 4: "ask skeptic" sends last gated measurement + same transcript text to `/v1/skeptic`, renders AGREED vs DISPUTED badges with citations. Text input is the primary path; voice deferred (no voice UI, no transcribe call).
- Mock skeptic verified `200` with gated drafts. Live skeptic still `403`-blocked on Baseten access — PWA surfaces the `503` hint inline.

**Next:** voice transcribe probe once text demo lands; real photos; Worker deploy.

## 2026-10-28 — Backend finished (honest scope)

**Complete and verified**

- 7 routes: health, measure, report, findings, skeptic, render (`POST /v1/render` returns gated SVG), spend. Enveloped replies, verbose errors, 50-mask / 1MB caps, open CORS.
- Live Spark findings: `200`, gate holds, usage ledgered. Spend guard pre-checks (`429`) and records (`GET /v1/spend`).
- Skeptic wired with real verified Baseten pricing; mock-safe; `503`/`429` fail-closed.
- PWA text path end-to-end: transcript → report → skeptic AGREED/DISPUTED → SVG annexure.
- 40 tests green, `tsc` clean, live smoke green (`mode:live`, gate `422` on tampered, spend `$0`).

**Explicitly out (documented in backend README, not silently missing)**

- SAM masks (`501`), voice transcribe (shape unresolved), skeptic inference (`403` pending form), D1 (stub), PDF (per no-docs constraint — SVG only).

**Spend:** $0.00 recorded (Meta pricing unconfirmed; Baseten pricing verified but unused — no successful inference yet).

## 2026-10-28 — Worker deployed (mock, $0)

- URL: `https://snapclaim-backend.parithosh.workers.dev` — `GET /v1/health` → `mock`, `POST /v1/report` → 2 findings, gate ok, absolute mode.
- Mock by default (no secrets on the Worker). Live keys stay local only.

## 2026-10-28 — PWA defaults to Worker + eval bench live

- PWA backend field now defaults to `https://snapclaim-backend.parithosh.workers.dev` (localhost still typeable). Shareable demo on any phone.
- `npm run eval` — deterministic guessed-vs-measured bench. Wall-crack locked as regression baseline (2 pass). Missing expected file = SKIP. README in `eval/` for Constantine.
- 40 tests green, `tsc` clean, eval 2 pass. $0.

## 2026-10-29 — SAM 3.1 is the primary segmenter (main)

**Shipped**

- Ported the verified live segment path to `main`: `src/vision/sam.ts`, `encodeRle`/`rleRoundTrip` in `src/vision/mask.ts`, `SAM_IMAGE_USD` + live `segmentBody` branch, `@meta-sam/parser` declared in `package.json`, `tests/sam.test.ts`.
- PWA tries `POST /v1/segment` first (one call for all taps, one billed image), falls back to the on-device worker on any failure; the status line says which one outlined (`via SAM 3.1 API` / `via on-device`). Shared `pwa/rle.js` decodes the backend RLE, covered by `tests/pwa-rle.test.ts`.
- Live-verified on `main`: `200`, 1 record conf 0.12, RLE 1024x1024, `$0.0025` ledgered ($9.9975 remaining).
- 121 tests green, `tsc` clean.

**Spend:** $0.0025 (1 live call on main).

## 2026-10-29 — Baseten hackathon key live, skeptic unblocked

**Shipped**

- Swapped `BASETEN_API_KEY` in `.env` (local only, gitignored) for the Meta hackathon key. The previous key was dead — `403 "please check the api-key you provided"` on every model.
- Corrects the 2026-10-28 entry above: `meta-models/muse-spark-open-1026` **does** exist. It is listed in `/v1/models` as `name: "[HACKATHON] Muse Spark Open"`, `description: "Muse spark open intended for Meta hackathon, not publicly available"`. The plain `meta-models/muse-spark-open` is the public id and returns `403` for a hackathon key, so `config.models.sparkOpen` now points at the `-1026` id.
- Capped `max_tokens: 8192` on the skeptic call. Muse Spark Open always reasons and the request set no ceiling on a model whose `max_completion_tokens` is 1,048,576.

**Verified live (no guessing)**

- Key valid end-to-end via the real `BasetenSkepticProvider`, not just curl: `200` in 7.2s → 2 drafts, `r1` cited on the reproducible length, percent correctly `DISPUTED` as underivable.
- Reasoning dominates output: **1,824 reasoning tokens of 1,930 completion tokens** (95%) for a 289-token prompt. Budget-sane (~$0.009/call) but `max_tokens` must stay generous — at `max_tokens: 64` the model returns `content: null` with `finish_reason: "length"`. The no-content error now reports the finish reason instead of hiding it.
- Also confirmed working on the hackathon model: streaming, tool calls, vision (read a generated image correctly), `response_format: json_object`, and prompt caching (128 cached tokens on repeats). Pricing as previously recorded.

**Spend:** ~$0.02 of the $100 hackathon credit on probe calls. Metred guard untouched. 121 tests green, `tsc` clean.

## 2026-10-29 — Worker skeptic live (fetch binding + redeploy)

**Shipped**

- Set `BASETEN_API_KEY` as a Worker secret (encrypted, not a plain variable) and redeployed `main` so the Worker runs the `-1026` model id.
- Fixed a Workers-only crash: bare global `fetch` passed as `fetchFn` throws illegal-invocation. `worker.ts` and `server.ts` now pass a bound wrapper. Verified on the Worker: `POST /v1/skeptic` → `ok:true`, gate pass, cited drafts.
- 121 tests green, `tsc` clean.

## 2026-10-29 — Voice endpoint verified live ($0.0001)

**Shipped**

- The `?` on the README voice row is resolved: Muse Voice Transcribe lives at `POST /v1/asr/transcribe` (multipart file) and `wss://v1/asr/realtime` (live socket) — not chat/completions, not /v1/responses. Model `muse-voice-transcribe-1.0`, WAV mono 16-bit 24kHz, `PUSH_TO_TALK`, `languageBias: [English]`.
- Probe: 1.5s macOS `say` clip ("wall crack after the rain") → `200`, transcript "wall crack after after the rain." (~$0.0001 at $0.18/hr audio). Hindi/Telugu/code-switch biasing is a documented `languageBias` feature, not yet probed with real speech.
- README model table corrected. No backend proxy on `main` yet — PWA voice path still unwired; that is the next step if voice makes the demo.

**Spend:** ~$0.0001.
