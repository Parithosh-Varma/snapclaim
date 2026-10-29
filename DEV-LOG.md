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

## 2026-10-28 — Benchmark hardening (9s push)

**Shipped**

- Evidence gate hardened: every finding must cite a measured number (qualitative-only sentences fail); dates/times stripped before number extraction (`2026-10-28` no longer reads as -10/-28); per-unit backing (% ↔ percent receipt, mm ↔ calibrated-length receipt); one-mask-per-finding rule; severity words must match the cited severity receipt (contradictions fail). 4 new gate tests.
- Measurement grown up: calibrated area (cm², `areaPx × mmPerPx² / 100`) and mean crack width (mm, `areaPx / skeletonPx × mmPerPx`) with `calibrated_area` / `calibrated_width` receipts; wall-crack now reports 5.17% / 85.9 mm / 2.6 mm wide / 2.19 cm² (11 receipts, was 8).
- SAM 3.1 live path real: `src/vision/sam.ts` — point/box prompt builder, full output-text parser (frames, sparse ids, confidence, both encodings), mask decode via official `@meta-sam/parser`, frame pasting + COCO RLE encode. Payloads in tests are real official-encoder outputs. `POST /v1/segment` live takes `{imageUrl, width, height, points}` and returns `{records: [{objectId, box, confidence, rle}]}`; empty output throws, never fakes. The one deliberate dependency; everything else stays zero-dep.
- Voice intake real: `POST /v1/transcribe` proxies to `{META_API_BASE}/asr/transcribe` (multipart, PUSH_TO_TALK, Hindi/Telugu/English bias + claim keywords), $0.18/hr ledgered; mock needs `fixtureTranscript`. PWA hold-to-speak records, resamples to mono 16 kHz WAV on-device (OfflineAudioContext), posts base64, fills the transcript box. Mock shows a fixture hint; 503 shows a key hint.
- PWA trust fixes: `escapeHtml` on all finding/gate rendering (XSS closed); CSP meta; Indian coins (₹10/5/2/1 first); **Use sample** one-tap measurement (wall-crack fixture, no photo needed); service worker (shell offline, `/v1` never cached); installable manifest.
- Proof artifacts: `npm run replay` reproduces findings + receipts + mode (MATCH/DRIFT, exit codes); `docs/eval-report.md` filled with bench table, frozen split, baselines protocol and stated gaps; `bench/split.json` frozen 2026-10-28.
- README now carries a works/mocked/blocked truth table, corrected pipeline (no PDF, no `snapclaim` binary, skeptic text-only until Baseten access), live eval table and an honest photo-privacy note.
- 105 tests green, `tsc` clean, eval 2 pass, replay MATCH + DRIFT verified.

**Spend:** $0.00 (all live paths stubbed in CI; no keys in repo).

**Next:** set Worker secrets + demo token and flip the badge to live; capture 12–20 ruler-measured photos; one live SAM photo; one live Hindi/Telugu clip; record the video.

## 2026-10-28 — Self-improvement batch 2 (prod push)

**Shipped**

- `POST /v1/crosscheck` — IoU + Dice agreement between two same-frame RLE masks with AGREED/DISPUTED verdict at a caller threshold (default 0.5). Keyless, deterministic. The planned SlimSAM-vs-SAM 3.1 skeptic check now has a live route, not just a utility.
- Eval 2 → 5 pass: `door-peel` (no-scale) and `wall-crack-noscale` fixtures pin the percent-only refusal in CI.
- Worker body-size guard (1 MB, same as Node) + Worker routing tests.
- PWA photo quality notes (dark/blown-out/blurry/low-res, calibrated Laplacian threshold 150) sharing one tested module with the suite; no-scale percent-only toggle.
- Node responses gain `x-content-type-options: nosniff`.
- 115 tests green, `tsc` clean, eval 5 pass.

**Spend:** $0.00.

## 2026-10-28 — Self-improvement batch 3 (prod hardening)

**Shipped**

- CORS allowlist: `ALLOWED_ORIGINS` (comma-separated) echoed per origin; unset keeps `*` for dev. Both Node and Worker apply it to every response including errors and preflight, so a foreign site can't burn the spend cap from a browser. Spend guard + metering remain the backstop for non-browser clients.
- CI: `.github/workflows/ci.yml` runs `npm ci`, tests, typecheck, eval and the mock smoke on every push/PR (Node 22).
- Input hardening tests: garbage RLE and out-of-range thresholds on `/v1/crosscheck`; Worker preflight/oversize/404 paths.
- 119 tests green, `tsc` clean, eval 5 pass.

**Spend:** $0.00.

## 2026-10-28 — On-device CV: masks to outlines, coin scale, tilt

**Shipped** (PRs #8, #10–12, #14, #21–25, #29, combined in #30)

- SAM masks become engine stats, and a coin becomes the scale reference. Each mask is traced into an SVG outline drawn over the photo in the annexure, outlining exactly the pixels that were measured.
- Shape checks: coins that aren't round are refused, and blocky crack pieces are flagged. Crack pieces with a ruler-straight edge (ledges, window frames) are flagged too, so they aren't measured as damage.
- Tilt correction: a coin seen at an angle is an ellipse, and its axes give the wall's tilt. Crack lengths are corrected for it (tilted-wall bench case).
- SlimSAM runs in a Web Worker, on WebGPU when the device has it and CPU otherwise. The page never freezes during the image embedding.
- Voice line transcribed on the device with Whisper (`whisper-tiny.en`). The audio never leaves the phone, and it works without a backend key.
- Live tilt level in the camera view, installable PWA with offline shell, first real-photo bench case (facade crack, percent only).

**Spend:** $0.00.

## 2026-10-29 — Two PWAs merged into one, then driven in a browser

**Shipped**

- Parithosh's PWA (`hardening/benchmark-84`) and the CV stack had diverged into two apps (14 conflicting files). His app is the base, and the CV features were ported in: the SAM worker, on-device voice, the tilt level, and the photo under the outlines. Measuring now sends SAM's traced coin outline instead of the camera gate's perfect circle, so tilt correction can kick in. A traced outline that isn't coin-shaped falls back to the circle.
- First full run in a real browser (Chrome, fake camera with a synthetic crack and coin): coin gate → capture → SlimSAM on WebGPU (photo embedding 1.2–1.9 s) → tap outline → measure (108.8 mm, w 1.2 mm, 7 receipts) → on-device Whisper → skeptic AGREED (mock) → annexure with photo, crack and coin outlines.
- That run found four bugs the tests didn't: the coin gate could never lock (the Sobel finder returns `{cx, cy, rr}`, the gate read `.x/.y/.r`); nothing opened the camera on first load; the CSP blocked the tilt meter's inline script; Whisper's `[Music]` tag landed in the transcript as words. All fixed.
- 166 tests green, `tsc` clean.

**Known gaps:** `/v1/segment` (server SAM cross-check) is unavailable in mock mode, so the cross-check shows an error on the deployed Worker. The paste-to-upload from `main` is gone from the merged app, so the camera is the only photo path. Not yet tested on a real phone.

**Spend:** $0.00.

**Next:** real phone test; 3–5 real crack photos with a coin (one at an angle) for the eval; record the video.
