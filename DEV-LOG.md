# DEV-LOG

Honest, dated build log. Mock mode by default; every live API call gets recorded here with its cost.

## 2026-10-27 - Day 1: the deterministic core

**Shipped**

- Deterministic measurement engine: mask areas → area ratio and percent, calibrated crack length from a reference object in the same image plane, severity bands with thresholds printed into the report.
- Receipt ledger: every measured value carries its formula, inputs, confidence and a deterministic ID (`R001`…), serializable to JSONL for replay.
- Evidence gate: every number in a finding must match a cited receipt; millimetres require a calibrated-length receipt; unknown units and uncited numbers throw `EvidenceError` instead of shipping.
- Mock vision and findings adapters, so the full loop runs offline.
- Spend guard with a hard cap and per-call ledger; config defaults to mock mode and requires `MOCK_MODE=0` for live calls.
- 24 tests green, `tsc --noEmit` clean, $0 spent.
- Fixtures: synthetic wall-crack mask statistics plus a scale reference; real-photo checklist in `fixtures/README.md`.

**Not done yet**

- Real model calls (SAM 3.1, Muse Spark, Spark Open, voice transcription) - no keys in the repo, none needed for mock CI.
- PWA capture UI and the SVG/PDF annexure renderer.
- Real damage photos.

**Spend:** $0.00 (mock mode only).

Credits claim ✅ - billing verified, $150 active on 2026-10-27.

**Next:** live adapters behind the spend guard; real-photo intake; then the renderer.

## 2026-10-27 - Day 1 (cont.): backend

**Shipped**

- `backend/` - one router (`handleRequest`) running on Node (`server.ts`, :8787) and Cloudflare Workers (`worker.ts` + `wrangler.toml`), zero dependencies.
- Routes: `GET /v1/health` (version + mode), `POST /v1/measure` (deterministic, keyless), `POST /v1/report` (measure → findings → Evidence Gate; uncited numbers return 422 with failures), `POST /v1/segment` (mock requires a supplied fixture - backend invents no masks; live SAM returns 501 until its request shape is verified), `POST /v1/findings` (live Muse Spark via chat completions, gated after drafting).
- Live routes fail closed: `503` when `MOCK_MODE=0` without `META_API_KEY`. Mock stays the default; 50-mask cap, 1 MB body cap, verbose enveloped errors.
- 31 tests green (7 new backend tests), `tsc --noEmit` clean, smoke script passes against a live local boot. $0 spent.

**Next:** verify SAM 3.1 live request shape with one guarded call; PWA capture; SVG/PDF renderer.

## 2026-10-28 - PWA capture (mock)

**Shipped**

- `pwa/index.html` + `pwa/app.js` - zero-deps static page: backend URL + health check, photo preview (preview only in mock), masks JSON box preloaded with wall-crack fixture, transcript line, `POST /v1/report`, findings + gate badges, schematic SVG bars (proportional, labeled schematic - not a photo overlay), raw JSON.
- Serve: any static server in `pwa/` (e.g. `npx serve pwa`), backend at `:8787`. E2E verified mock: 2 findings, gate pass. $0 spent.

**Next:** real SAM masks replace pasted JSON; SVG photo overlay + PDF annexure.

## 2026-10-28 - SVG annexure renderer

**Shipped**

- `src/render/svg.ts` - deterministic code-drawn annexure: findings with severity colors, receipts table with formulas, mode badge, transcript, replay note. Escapes hostile input. Exported from `src/index.ts`.
- `POST /v1/render` - runs gated report then returns `{svg, gate}`. Gated failures stay `422`.
- PWA render button + inline SVG + download link.
- 34 tests green, `tsc` clean, live render E2E `gate:true`. $0 spent. No PDF - per no-docs constraint, SVG only.

**Next:** one guarded live Spark findings call; real-photo intake; Worker deploy.

## 2026-10-28 - Spend wiring (no key needed)

**Shipped**

- `backend/spend.ts` - process-singleton `SpendGuard` from `SPEND_GUARD_USD`, `GET /v1/spend` ledger. Mock calls charge nothing.
- `backend/providers.ts` - live Spark path pre-checks `remainingUsd` (`429` at $0) and records `in=/out=` token usage at `$0` until pricing is confirmed. No hardcoded prices.
- 37 tests green (3 new spend tests), `tsc` clean, smoke asserts `spend $0`. Live still blocked on `.env` (`NO_ENV` verified) - SAM `501` untouched.

**Next:** real-photo intake (3–5 with coin/ruler); one live Spark smoke once key lands; Worker deploy.

## 2026-10-28 - First live Spark call ($0)

**Shipped**

- Live boot verified: `GET /v1/health` → `mode:live`, `GET /v1/spend` → `$10` cap, `$0` spent.
- One guarded `POST /v1/findings` on the wall-crack fixture: `200`, gate `ok:true`, 8 atomic findings (one per receipt - live model splits finer than the 2-statement mock). Usage recorded: `in=381 out=2658` tokens at `$0` (Meta pricing unconfirmed, no guessed rates).

**Spend:** $0.00. SAM stays `501` - shape still unverified, no call attempted.

**Next:** real-photo intake; Worker deploy; Spark Open skeptic via Baseten.

## 2026-10-28 - Skeptic wired, both live paths probed

**Shipped**

- Corrected open-weights id to `meta-models/muse-spark-open` (verified live in Baseten `/v1/models`; the `-1026` suffix does not exist). Pricing verified from the same listing: prompt $0.00000125 / completion $0.00000425 per token (`SPARK_OPEN_PRICE`), charged for real via `estimateCostUsd`.
- `POST /v1/skeptic` - Baseten chat-completions skeptic with independent system prompt, gated, spend-recorded. Mock-safe; `503` without key; `429` at $0.
- 40 tests green, `tsc` clean. $0 new spend.

**Verified live (no guessing)**

- SAM 3.1: not on `/chat/completions` (explicit 404: "Use /v1/responses"). On `/v1/responses` it returns `200 completed` with `images_processed:1` but empty text - mask output shape unresolved. `/v1/segment` stays `501`; never fakes a mask.
- Skeptic: key valid for `/v1/models` (`200`, 19 models) but inference returns `403 "please check the api-key"`. Access pending - likely the unsubmitted Baseten form / workspace grant. Code complete; live smoke waits on access.

**Next:** submit the Baseten form for `meta-models/muse-spark-open`; real-photo intake; Worker deploy.

## 2026-10-28 - Text-first PWA + skeptic view

**Shipped**

- PWA section 4: "ask skeptic" sends last gated measurement + same transcript text to `/v1/skeptic`, renders AGREED vs DISPUTED badges with citations. Text input is the primary path; voice deferred (no voice UI, no transcribe call).
- Mock skeptic verified `200` with gated drafts. Live skeptic still `403`-blocked on Baseten access - PWA surfaces the `503` hint inline.

**Next:** voice transcribe probe once text demo lands; real photos; Worker deploy.

## 2026-10-28 - Backend finished (honest scope)

**Complete and verified**

- 7 routes: health, measure, report, findings, skeptic, render (`POST /v1/render` returns gated SVG), spend. Enveloped replies, verbose errors, 50-mask / 1MB caps, open CORS.
- Live Spark findings: `200`, gate holds, usage ledgered. Spend guard pre-checks (`429`) and records (`GET /v1/spend`).
- Skeptic wired with real verified Baseten pricing; mock-safe; `503`/`429` fail-closed.
- PWA text path end-to-end: transcript → report → skeptic AGREED/DISPUTED → SVG annexure.
- 40 tests green, `tsc` clean, live smoke green (`mode:live`, gate `422` on tampered, spend `$0`).

**Explicitly out (documented in backend README, not silently missing)**

- SAM masks (`501`), voice transcribe (shape unresolved), skeptic inference (`403` pending form), D1 (stub), PDF (per no-docs constraint - SVG only).

**Spend:** $0.00 recorded (Meta pricing unconfirmed; Baseten pricing verified but unused - no successful inference yet).

## 2026-10-28 - Worker deployed (mock, $0)

- URL: `https://snapclaim-backend.parithosh.workers.dev` - `GET /v1/health` → `mock`, `POST /v1/report` → 2 findings, gate ok, absolute mode.
- Mock by default (no secrets on the Worker). Live keys stay local only.

## 2026-10-28 - PWA defaults to Worker + eval bench live

- PWA backend field now defaults to `https://snapclaim-backend.parithosh.workers.dev` (localhost still typeable). Shareable demo on any phone.
- `npm run eval` - deterministic guessed-vs-measured bench. Wall-crack locked as regression baseline (2 pass). Missing expected file = SKIP. README in `eval/` for Constantine.
- 40 tests green, `tsc` clean, eval 2 pass. $0.

## 2026-10-28 - Benchmark hardening (9s push)

**Shipped**

- Evidence gate hardened: every finding must cite a measured number (qualitative-only sentences fail); dates/times stripped before number extraction (`2026-10-28` no longer reads as -10/-28); per-unit backing (% ↔ percent receipt, mm ↔ calibrated-length receipt); one-mask-per-finding rule; severity words must match the cited severity receipt (contradictions fail). 4 new gate tests.
- Measurement grown up: calibrated area (cm², `areaPx × mmPerPx² / 100`) and mean crack width (mm, `areaPx / skeletonPx × mmPerPx`) with `calibrated_area` / `calibrated_width` receipts; wall-crack now reports 5.17% / 85.9 mm / 2.6 mm wide / 2.19 cm² (11 receipts, was 8).
- SAM 3.1 live path real: `src/vision/sam.ts` - point/box prompt builder, full output-text parser (frames, sparse ids, confidence, both encodings), mask decode via official `@meta-sam/parser`, frame pasting + COCO RLE encode. Payloads in tests are real official-encoder outputs. `POST /v1/segment` live takes `{imageUrl, width, height, points}` and returns `{records: [{objectId, box, confidence, rle}]}`; empty output throws, never fakes. The one deliberate dependency; everything else stays zero-dep.
- Voice intake real: `POST /v1/transcribe` proxies to `{META_API_BASE}/asr/transcribe` (multipart, PUSH_TO_TALK, Hindi/Telugu/English bias + claim keywords), $0.18/hr ledgered; mock needs `fixtureTranscript`. PWA hold-to-speak records, resamples to mono 16 kHz WAV on-device (OfflineAudioContext), posts base64, fills the transcript box. Mock shows a fixture hint; 503 shows a key hint.
- PWA trust fixes: `escapeHtml` on all finding/gate rendering (XSS closed); CSP meta; Indian coins (₹10/5/2/1 first); **Use sample** one-tap measurement (wall-crack fixture, no photo needed); service worker (shell offline, `/v1` never cached); installable manifest.
- Proof artifacts: `npm run replay` reproduces findings + receipts + mode (MATCH/DRIFT, exit codes); `docs/eval-report.md` filled with bench table, frozen split, baselines protocol and stated gaps; `bench/split.json` frozen 2026-10-28.
- README now carries a works/mocked/blocked truth table, corrected pipeline (no PDF, no `snapclaim` binary, skeptic text-only until Baseten access), live eval table and an honest photo-privacy note.
- 105 tests green, `tsc` clean, eval 2 pass, replay MATCH + DRIFT verified.

**Spend:** $0.00 (all live paths stubbed in CI; no keys in repo).

**Next:** set Worker secrets + demo token and flip the badge to live; capture 12–20 ruler-measured photos; one live SAM photo; one live Hindi/Telugu clip; record the video.

## 2026-10-28 - Self-improvement batch 2 (prod push)

**Shipped**

- `POST /v1/crosscheck` - IoU + Dice agreement between two same-frame RLE masks with AGREED/DISPUTED verdict at a caller threshold (default 0.5). Keyless, deterministic. The planned SlimSAM-vs-SAM 3.1 skeptic check now has a live route, not just a utility.
- Eval 2 → 5 pass: `door-peel` (no-scale) and `wall-crack-noscale` fixtures pin the percent-only refusal in CI.
- Worker body-size guard (1 MB, same as Node) + Worker routing tests.
- PWA photo quality notes (dark/blown-out/blurry/low-res, calibrated Laplacian threshold 150) sharing one tested module with the suite; no-scale percent-only toggle.
- Node responses gain `x-content-type-options: nosniff`.
- 115 tests green, `tsc` clean, eval 5 pass.

**Spend:** $0.00.

## 2026-10-28 - Self-improvement batch 3 (prod hardening)

**Shipped**

- CORS allowlist: `ALLOWED_ORIGINS` (comma-separated) echoed per origin; unset keeps `*` for dev. Both Node and Worker apply it to every response including errors and preflight, so a foreign site can't burn the spend cap from a browser. Spend guard + metering remain the backstop for non-browser clients.
- CI: `.github/workflows/ci.yml` runs `npm ci`, tests, typecheck, eval and the mock smoke on every push/PR (Node 22).
- Input hardening tests: garbage RLE and out-of-range thresholds on `/v1/crosscheck`; Worker preflight/oversize/404 paths.
- 119 tests green, `tsc` clean, eval 5 pass.

**Spend:** $0.00.

## 2026-10-28 - On-device CV: masks to outlines, coin scale, tilt

**Shipped** (PRs #8, #10–12, #14, #21–25, #29, combined in #30)

- SAM masks become engine stats, and a coin becomes the scale reference. Each mask is traced into an SVG outline drawn over the photo in the annexure, outlining exactly the pixels that were measured.
- Shape checks: coins that aren't round are refused, and blocky crack pieces are flagged. Crack pieces with a ruler-straight edge (ledges, window frames) are flagged too, so they aren't measured as damage.
- Tilt correction: a coin seen at an angle is an ellipse, and its axes give the wall's tilt. Crack lengths are corrected for it (tilted-wall bench case).
- SlimSAM runs in a Web Worker, on WebGPU when the device has it and CPU otherwise. The page never freezes during the image embedding.
- Voice line transcribed on the device with Whisper (`whisper-tiny.en`). The audio never leaves the phone, and it works without a backend key.
- Live tilt level in the camera view, installable PWA with offline shell, first real-photo bench case (facade crack, percent only).

**Spend:** $0.00.

## 2026-10-29 - Two PWAs merged into one, then driven in a browser

**Shipped**

- Parithosh's PWA (`hardening/benchmark-84`) and the CV stack had diverged into two apps (14 conflicting files). His app is the base, and the CV features were ported in: the SAM worker, on-device voice, the tilt level, and the photo under the outlines. Measuring now sends SAM's traced coin outline instead of the camera gate's perfect circle, so tilt correction can kick in. A traced outline that isn't coin-shaped falls back to the circle.
- First full run in a real browser (Chrome, fake camera with a synthetic crack and coin): coin gate → capture → SlimSAM on WebGPU (photo embedding 1.2–1.9 s) → tap outline → measure (108.8 mm, w 1.2 mm, 7 receipts) → on-device Whisper → skeptic AGREED (mock) → annexure with photo, crack and coin outlines.
- That run found four bugs the tests didn't: the coin gate could never lock (the Sobel finder returns `{cx, cy, rr}`, the gate read `.x/.y/.r`); nothing opened the camera on first load; the CSP blocked the tilt meter's inline script; Whisper's `[Music]` tag landed in the transcript as words. All fixed.
- 166 tests green, `tsc` clean.

**Known gaps:** `/v1/segment` (server SAM cross-check) is unavailable in mock mode, so the cross-check shows an error on the deployed Worker. The paste-to-upload from `main` is gone from the merged app, so the camera is the only photo path. Not yet tested on a real phone.

**Spend:** $0.00.

**Next:** real phone test; 3–5 real crack photos with a coin (one at an angle) for the eval; record the video.
## 2026-10-29 - SAM 3.1 is the primary segmenter (main)

**Shipped**

- Ported the verified live segment path to `main`: `src/vision/sam.ts`, `encodeRle`/`rleRoundTrip` in `src/vision/mask.ts`, `SAM_IMAGE_USD` + live `segmentBody` branch, `@meta-sam/parser` declared in `package.json`, `tests/sam.test.ts`.
- PWA tries `POST /v1/segment` first (one call for all taps, one billed image), falls back to the on-device worker on any failure; the status line says which one outlined (`via SAM 3.1 API` / `via on-device`). Shared `pwa/rle.js` decodes the backend RLE, covered by `tests/pwa-rle.test.ts`.
- Live-verified on `main`: `200`, 1 record conf 0.12, RLE 1024x1024, `$0.0025` ledgered ($9.9975 remaining).
- 121 tests green, `tsc` clean.

**Spend:** $0.0025 (1 live call on main).

## 2026-10-29 - Baseten hackathon key live, skeptic unblocked

**Shipped**

- Swapped `BASETEN_API_KEY` in `.env` (local only, gitignored) for the Meta hackathon key. The previous key was dead - `403 "please check the api-key you provided"` on every model.
- Corrects the 2026-10-28 entry above: `meta-models/muse-spark-open-1026` **does** exist. It is listed in `/v1/models` as `name: "[HACKATHON] Muse Spark Open"`, `description: "Muse spark open intended for Meta hackathon, not publicly available"`. The plain `meta-models/muse-spark-open` is the public id and returns `403` for a hackathon key, so `config.models.sparkOpen` now points at the `-1026` id.
- Capped `max_tokens: 8192` on the skeptic call. Muse Spark Open always reasons and the request set no ceiling on a model whose `max_completion_tokens` is 1,048,576.

**Verified live (no guessing)**

- Key valid end-to-end via the real `BasetenSkepticProvider`, not just curl: `200` in 7.2s → 2 drafts, `r1` cited on the reproducible length, percent correctly `DISPUTED` as underivable.
- Reasoning dominates output: **1,824 reasoning tokens of 1,930 completion tokens** (95%) for a 289-token prompt. Budget-sane (~$0.009/call) but `max_tokens` must stay generous - at `max_tokens: 64` the model returns `content: null` with `finish_reason: "length"`. The no-content error now reports the finish reason instead of hiding it.
- Also confirmed working on the hackathon model: streaming, tool calls, vision (read a generated image correctly), `response_format: json_object`, and prompt caching (128 cached tokens on repeats). Pricing as previously recorded.

**Spend:** ~$0.02 of the $100 hackathon credit on probe calls. Metred guard untouched. 121 tests green, `tsc` clean.

## 2026-10-29 - Worker skeptic live (fetch binding + redeploy)

**Shipped**

- Set `BASETEN_API_KEY` as a Worker secret (encrypted, not a plain variable) and redeployed `main` so the Worker runs the `-1026` model id.
- Fixed a Workers-only crash: bare global `fetch` passed as `fetchFn` throws illegal-invocation. `worker.ts` and `server.ts` now pass a bound wrapper. Verified on the Worker: `POST /v1/skeptic` → `ok:true`, gate pass, cited drafts.
- 121 tests green, `tsc` clean.

## 2026-10-29 - Voice endpoint verified live ($0.0001)

**Shipped**

- The `?` on the README voice row is resolved: Muse Voice Transcribe lives at `POST /v1/asr/transcribe` (multipart file) and `wss://v1/asr/realtime` (live socket) - not chat/completions, not /v1/responses. Model `muse-voice-transcribe-1.0`, WAV mono 16-bit 24kHz, `PUSH_TO_TALK`, `languageBias: [English]`.
- Probe: 1.5s macOS `say` clip ("wall crack after the rain") → `200`, transcript "wall crack after after the rain." (~$0.0001 at $0.18/hr audio). Hindi/Telugu/code-switch biasing is a documented `languageBias` feature, not yet probed with real speech.
- README model table corrected. No backend proxy on `main` yet - PWA voice path still unwired; that is the next step if voice makes the demo.

**Spend:** ~$0.0001.

## 2026-10-29 - #30 brought up to date with main

**Shipped**

- Merged `main` into the CV/PWA branch (11 conflicting files). Kept main's live-verified SAM 3.1 wire fix (the decoder gets the payload with its `!`/`~` marker), the bound `fetch` wrapper, the eval archive writer and the frozen-split text. Kept the branch's `/v1/transcribe` proxy (main has none yet), WebGPU worker and CORS allowlist.
- The merged PWA outlines with the SAM 3.1 API first and falls back to on-device SlimSAM, as on main; taps no longer wait for the on-device embedding. The mask cross-check now compares against whichever model did not draw the mask (API mask vs on-device, or the reverse), so it stays an independent check.
- 175 tests green, `tsc` clean, eval 7 pass. `npm run bench` still UNRUN until live runs are archived.

**Spend:** $0.00.

## 2026-10-30 - Trust + error-handling hardening (uncommitted batch)

**Shipped**

- Strict backend allowlist: `https` only for the default Worker host, `http` only loopback. CSP `connect-src` in both HTML shells mirrors the same host; `tests/pwa-csp-allowlist.test.ts` fails if they drift. Self-host procedure in README.
- Single backend URL source of truth (`snapclaim.backendUrl` in localStorage, one Settings input, Report panel shows value only). Covered by `tests/pwa-backend-input.test.ts`.
- Skeptic/cross-check never send empty requests: missing measurement is a UI guard, not a 422. `/v1/skeptic` re-measures server-side from the same measure inputs (no overlay spray), rejects findings that do not match recomputation, one automatic retry on gate failure only. 4xx states named (Skeptic/Cross-check unavailable) with status logged, still continuable.
- Coin correction: manual tap wins over the gate, taped-coin lenient outline, dark/auto theme contrast fixes, offline honesty (saved cases + capture work offline, measuring needs connection, on-device models need one online load). Covered by `tests/pwa-offline-copy.test.ts`.
- `src/vision/coin-detect.js` moved out of the shipped PWA folder (algorithm harness only); SW cache bumps v9/v6 with stale-deploy fingerprint on Worker 404. Covered by `tests/sw-version.test.ts`.
- Removed dead 501 stub in `visionProvider` (live `/v1/segment` runs through `segmentBody` + `segmentWithSam`, verified 2026-10-29); the unreachable branch now says so.
- 214 tests green, `tsc` clean, eval 7 pass, `bench` UNRUN ×4 (strict exit 1, honest). Smoke green on alternate port (local :8787 is macOS msgsrvr).

## 2026-10-30 - Audit round: dead code, byte caps, parity

**Shipped**

- PWA coin radius: removed dead `coinSrc` (squared scale, unused) and dead `r` (`... > 1 ? 1 : 1`, unused). The manual red ring now uses `manualCoinRadius()`, the same gate-derived / 3.5%-fallback radius `measure()` sends, so the ring shows what gets measured. `tests/pwa-shell.test.ts` pins it.
- Worker body cap now counts bytes (`TextEncoder`), not UTF-16 units - parity with the Node streaming cap. `tests/crosscheck.test.ts` covers the multibyte bypass (400k CJK chars under 1M units, over 1M bytes → 400).
- `react/src/screens/Tabs.tsx` uses shared `DEFAULT_BACKEND_HOST` instead of a hardcoded host string.
- `pwa/sw.js` CACHE v9 → v10 (shell changed).
- Full audit: no TODOs, no secrets in tree, `.env` untracked, XSS paths escaped (`esc` + `escSeverity` allowlist), caps (50 masks, 1MB both servers, RLE runs, statement chars), CORS allowlist + rate limit on both servers, allowlist/CSP/offline-copy/skeptic-payload parity PWA↔React (React lacks manual coin correction - PWA-only, noted not ported).

## 2026-10-30 - React coin-correction port + stale-tap fix

**Shipped**

- React `Mark.tsx` now mirrors the PWA: tap-coin-to-correct (red ring, wins in `measure()` at 0.9 confidence), tape-halo checkbox with the lenient trace margins, shared `manualCoinRadius()` so the ring shows what gets measured. `session.ts` carries `coinManualPt` (cleared on a new photo) + `coinTaped`.
- Real bug fixed in both apps: a manual coin tap is pixel coords of its photo. The PWA never cleared it - retaking the photo kept the old tap and measured the wrong reference. `setupMarkPhoto` (PWA) and the Mark photo build (React) now clear it; back-nav from Say keeps it.
- `pwa/sw.js` CACHE v11 (shell changed). 214 tests green, `tsc` clean, eval 7 pass, React build clean.

**Spend:** $0.00.

## 2026-10-30 — Synthetic coin calibration eval and voice proxy round-trip

Corrected 2026-11-02 during review of #45: the first version of this entry called these numbers real-photo results and cited a physical ruler. Neither was true.

- **Synthetic known-answer eval (`npm run eval`: 10 pass, `scored=5 medianAbsErrorMm=1.0 (SAM-calibrated n=3: 2.4mm) within10pct=5/5`):** Three 800×600 canvas composites with a crack drawn from a known vector path and a coin added (`calibrated-plaster-hairline-01`, India ₹10 Ø27.0 mm, 90.4 mm; `calibrated-masonry-step-02`, US Quarter Ø24.26 mm, 92.2 mm stepped; `calibrated-stone-oblique-03`, Euro €1 Ø23.25 mm at 36.8° tilt, 88.5 mm). Scored alongside the hand-built masks `wall-crack` (85.0 mm) and `tilted-wall` (49.5° tilt, 66.7 mm). The known answer is the drawing's geometry: no camera, ruler or tape was involved, and `rulerGtMm` is only a field name. The 10 passes are regression checks against the pipeline's own output. The 5/5 says the pipeline recovers drawn cracks; real-photo accuracy stays UNSCORED.
- **What is reproducible:** Crack and coin in the composites were segmented live with SAM 3.1 (`POST /v1/segment`). The raw COCO RLEs are in `fixtures/rle/calibrated-*.json`, and `tests/vision-real.test.ts` checks that `observeBody` reproduces `fixtures/masks/calibrated-*.json` from them. The composite images are not committed.
- **Backdrops reuse held-out photos:** the composites sit on three of the four public held-out photos, so those are no longer fully unseen. Noted in `docs/eval-report.md`.
- **Live report, with and without a scale:** `POST /v1/report` returned `gate.ok: true` on all three composites, and with `scaleReference` omitted Muse Spark 1.3 gave only `0.76%`, `0.95%`, `0.74%` with no millimetres. Raw responses are not archived.
- **Held-out runs are not on main:** the four public cases were run live that day (`gitSha: 665aeb5`), all found the crack and refused to invent millimetres, but those archives live in open PRs. On main, `npm run bench` still prints UNRUN for all 11 cases.
- **PWA hold-to-speak and `/v1/transcribe`:** Recorded a 16 kHz mono Hinglish claim clip (`"North wall par plaster crack hai, ten rupee coin placed next to crack for scale."`) through `#micBtn` (`115,244` bytes, `3,600 ms`) and tried both paths in headless Chrome:
  1. **On-device Whisper (`pwa/voice-worker.js`, `Xenova/whisper-tiny.en`):** `10.05 s`, heard `"North Wall P.A.R. plaster crack high. 10 RUPY coin placed next to"` (the English-only model maps Hinglish tokens phonetically).
  2. **`POST /v1/transcribe` proxy, then live `POST /v1/report` (`MOCK_MODE=0`):** Proxy round-trip (`requestId: fa57209a26c6fb0c`) with `languageBias: ["hi-IN", "te-IN", "en-IN"]` landed the full Hinglish transcript in `#heard` / `#transcriptBox`, and `#sendBtn` got 8 receipt-cited findings (`R001`–`R008`).

**Spend:** `$0.0425` ledgered on the live Worker (`$4.9575` remaining of `$5.00` cap: 17 SAM 3.1 `/v1/segment` calls at `$0.0025` each, 3 live Muse Spark `/v1/report` calls at `$0`).

## 2026-10-31 — Global defaults (no India-shaped intake)

**Shipped**

- Voice: removed the Hindi/Telugu/English default bias; Muse auto-detects the spoken language and callers can still send `languageBias`. The on-device fallback is now multilingual `whisper-tiny` instead of English-only `whisper-tiny.en`.
- Scale UI: no India-first coin default. The select starts unset, lists presets across regions, and adopts the diameter of the auto-detected coin; measuring waits for a confirmed size when a coin is in frame.
- Coin matcher searches the whole on-device DB instead of an INR/USA/EUR/GBP filter.
- Fixture id `coin-10inr` → `coin-27mm`; README, backend README, PRODUCT.md and the marketing site no longer name Hindi/Telugu/Hinglish or ₹10 as the product shape.
- 244 tests green, both typechecks clean, React build clean.

**Spend:** $0.00.

## 2026-10-31 - Voice order: server first, on-device fallback

**Shipped**

- Both clients (React `Say.tsx`, `pwa/app.js`) now try `/v1/transcribe` (Muse, auto-detects any language) first when online, and fall back to on-device Whisper on error, non-OK status (503 no key, 400 mock without fixture), or empty transcript. Either side returning no words falls through to the other before the "type the line" message.
- Offline still skips the server and goes straight to on-device. `tests/react-shell.test.ts` asserts the new server-first contract.
- 244 tests green, both typechecks clean, React build clean.

**Spend:** $0.00.

## 2026-11-02 - First tape ground truth (terrace slab)

**Shipped**

- Builder tape-measured the terrace-slab crack with a 2 INR coin in frame; pipeline Ref SC-25D35C5E measured 218.5 mm (R005) against tape ~223 mm → err 4.5 mm (2.0%), inside ±10%.
- New held-out case `terrace-slab-tape-01` in `bench/split.json` with `groundTruth {maskId damage-1, 223 mm}` (tape read from the photo; replace if the physical reading differs >2 mm) plus `bench/runs/terrace-slab-tape-01.json`. Adding a case needs no digest change (digests pin the 4 public cases only).
- `npm run bench:gap` now scores its first row: `measured scored=1 medianAbsErrorMm=4.5 within10pct=100%`; model-only still missing (one Spark photo-alone guess needed). 30 bench tests green.
- `/proof.html` carries the real row (measured vs tape); redeployed to the branch preview.

**Spend:** $0.00.

## 2026-11-02 - Gap bench fully scored (model-only arm lands)

**Shipped**

- Builder confirmed physical tape 22.5–23 cm → ground truth recorded 227 mm (midpoint) on `terrace-slab-tape-01` (`fixtures/photos/DSC_0711.JPG`); guess shown `DSC_0710.JPG` (same crack, tape not legible).
- Spark photo-alone guess via `muse-spark-1.3` chat completions (downscaled 1024px, `response_format json_object`): first attempt `max_tokens 2000` returned `content: null` (`finish_reason length`, reasoning ate all 2000); retry at 8192 → `{"crackLengthMm": 315}` in 15.4s, 3,110 tokens. Archived to `bench/model-only/terrace-slab-tape-01.json`.
- `npm run bench:gap` exit 0: measured err 8.5 mm (3.7%, in) vs model-only err 88 mm (38.8%, out). `/proof.html` second column filled; rebuilt + redeployed.

**Spend:** $0.00 recorded (Spark pricing unconfirmed; 3,110 tokens metered at $0).

## 2026-11-03 - Measurement now overlaps the Describe step

**Shipped**

- React: tapping "Measure damage" validates everything up front (mask, coin outline, size, mock-backend refusal) exactly as before, then starts the observe+measure chain as a background job on the session (`s.measureJob = { promise, seq, state }`) and navigates to Describe immediately. Say awaits the job before `/v1/report` with an honest "Finishing the measurement…" status; a finished job behaves exactly as the old sequential flow. Failures return to Mark (not Numbers) with the real "Measuring failed (...)" message, keeping taps and transcript.
- Staleness: the old component-level `measureSeq` moved onto the session with an input snapshot (photo, taps, coin, label); new measures, tap/coin/photo edits, angle switches, and new cases supersede the old job, and late landings are discarded. New `react/src/lib/measure-job.ts` carries the shared body builder (maths unchanged) plus the job lifecycle.
- PWA mirrors the change for the single-shot path (`pwa/app.js` background job, Say awaits, failure back to Mark); multi-shot stays sequential since frame B needs frame A on camera. New-case/retake/sample paths invalidate the job.
- Parity: `tests/measure-overlap.test.ts` proves a stale job landing late is discarded and the observe/report bodies are byte-identical between the sequential and overlapping flows for the same inputs; `tests/react-shell.test.ts` pins the new state machine.
- Housekeeping: React SW `snapclaim-react-v20` → `v21`, PWA `snapclaim-shell-v26` → `v27` (app.js changed); 323 tests green, both typechecks clean, React build clean.
## 2026-11-03 - One-call headless API (no UI)

**Shipped**

- `POST /v1/claim`: one request runs segment → observe → report → render and returns `{measurement, findings, gate, overlay, svg?, replay, segmentation?}`. Two input shapes: COCO RLE `masks[]` (keyless, mock-capable, pixel-verified) or `imageUrl` + `damage[]` taps (+ optional `coin`) for live SAM 3.1 segmentation.
- Segmentation attribution by pixel containment, not record order; wall-sized records (>50% frame) dropped like the app drops them; a tap with no surviving mask is `422`, never an empty finding. Coin picking mirrors the app's compactness heuristic; a non-coin outline still degrades to percent-only via `/v1/observe`.
- Render happens in-process: `/v1/render` would re-run `/v1/report` and bill a second findings call for the same numbers.
- The claim re-binds the input RLE to the observed masks, so claims are `provenance: "pixel-verified"` and pass `REQUIRE_PIXEL_PROVENANCE=1`.
- Extracted `samSegment()` from `/v1/segment` so both routes share the SSRF guard, pixel cap, spend hold and archival; `/v1/segment` behavior unchanged (503-before-400 ordering pinned by tests).
- `/v1/claim` joins the expensive rate tier (20/min) and the `REQUIRE_BILLING_AUTH` lockdown.
- `cli/snapclaim.ts` (`npm run cli`): `health` and `claim` from the shell, PNG/JPEG/WebP dimension detection, data-URL building, `--tap`, `--coin`, `--say`, `--out`, `--svg`, `--dry-run`, BYOK headers.
- `docs/API.md`: full contract, CLI flags, low-level route table, replay, Node client, limits/auth. 15 new tests; 364 total green. BYOK proven on `/v1/claim`: caller key drives SAM + findings, operator ledger stays at $0.
## 2026-11-03 - Release candidate truth pass (25 mm nominal, n = 1, no live calls)

**Corrected (all figures from `src/engine/measure.ts` run 2026-11-03 or the values below, never invented)**

- Coin: nominal 25 mm issue spec, user-confirmed 2026-11-03; same physical coin ruler-read 24 mm (+/-0.5). Presets fixed 23→25 mm (`pwa/coin-model.js`, `react/public/coin-model.js`, `pwa/index.html`, `react/src/lib/session.ts`); sizes vary by issue, type your measured diameter. Sensitivity at 24 mm from the same engine run: R005 228.0 mm / R006 3.1 mm / R004 7.09 cm².
- Terrace slab (`bench/split.json:terrace-slab-tape-01`, `fixtures/photos/DSC_0711.JPG`, n = 1): engine at 25 mm → R001 0.773994 mm/px, R004 7.69 cm², R005 237.5 mm, R006 3.2 mm (unverified — no width ground truth), R007 significant. Old 23 mm-coin run SC-25D35C5E R005 218.5 mm retained for history, superseded.
- Ground truth: thread path 238.8 mm (9.4 in × 25.4, +/-4 mm uncertainty, end readings blank, confirm) + tape span 227 mm (range 225–230, midpoint, +/-2.5). Pipeline measures path, not span.
- Errors (n = 1): vs thread 238.8 ±4 → err 1.3 mm (0.5%, inside ±10%, within thread ±4); vs span 227 → err 10.5 mm (4.6%, printed, never scored); Spark photo-alone 315 mm vs thread err 76.2 mm (31.9%, outside). `bench/gap.ts` now scores `pathMm` primary, prints `spanMm` labelled.
- Width: 3.2 mm (terrace) + 2.6 mm (wall-crack fixture) marked unverified everywhere (annexure `src/render/svg.ts`, `react/src/screens/Report.tsx`, `react/src/screens/Shared.tsx`, `tests/width-unverified.test.ts`, golden hash `cc12e41c…`).
- Stale claims removed: "tape not legible" for DSC_0710 (same crack, no legibility claim); "SVG only (no PDF)" → server SVG + React on-device PDF (`react/src/lib/pdf.ts`).
- Bench status on this branch: `npm run eval` 7 pass; `npm run bench:gap` INCOMPLETE (exit 1, truth 238.8 path, measured/modelOnly missing — `bench/runs/terrace-slab-tape-01.json` + `bench/model-only/terrace-slab-tape-01.json` absent, not fabricated; regenerate via `npm run bench:archive -- <caseId> <input.json>` with `{ provenance, measurement: { findings, receipts } }` from a live pipeline result, plus a Spark photo-alone guess file). `npm test` 319 pass, `tsc` clean. No live API calls, no deploy on this branch.

**Spend:** $0.00.

## 2026-11-04 - Terrace final: 25 mm user-supplied, span-only truth, no thread

**Shipped**

- Coin is 25 mm, final, user-supplied (+/-0.5). The 23 mm read was a mistake: the 2026-11-02 SC-25D35C5E run (R005 218.5 mm) is void, not superseded. No 23, no 24 anywhere in the case.
- Thread 238.8 mm removed from `terrace-slab-tape-01`: the string crack is not confirmed to be the terrace crack, so it must not validate it. Ground truth is the tape span 227 mm [225–230] only, context, never scored.
- Engine re-run (`src/engine/measure.ts`, signed-report scalars, self-reported — no RLE in repo, pixel provenance pending masks): R001 0.773994, R004 7.69 cm², R005 237.5 mm, R006 3.2 mm (unverified, no width ground truth), R007 significant. Archived run replaced with the full receipted result (coin 25).
- Error vs span: +10.5 mm (+4.6%, span context, never scored); coin +/-0.5 mm scales mm values +/-2%; width 3.2 mm unverified.
- `npm run bench:gap` now prints UNSCORED (exit 0): with no path truth the case has no validated accuracy claim. `npm test` green.
- Landing case-study text (other branch) needs the same swap: 237.5 vs span 227, no thread — corrected text supplied, not pushed.

**Spend:** $0.00.
