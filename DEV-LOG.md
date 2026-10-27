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
