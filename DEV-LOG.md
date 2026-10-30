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

## 2026-10-29 — #30 brought up to date with main

**Shipped**

- Merged `main` into the CV/PWA branch (11 conflicting files). Kept main's live-verified SAM 3.1 wire fix (the decoder gets the payload with its `!`/`~` marker), the bound `fetch` wrapper, the eval archive writer and the frozen-split text. Kept the branch's `/v1/transcribe` proxy (main has none yet), WebGPU worker and CORS allowlist.
- The merged PWA outlines with the SAM 3.1 API first and falls back to on-device SlimSAM, as on main; taps no longer wait for the on-device embedding. The mask cross-check now compares against whichever model did not draw the mask (API mask vs on-device, or the reverse), so it stays an independent check.
- 175 tests green, `tsc` clean, eval 7 pass. `npm run bench` still UNRUN until live runs are archived.

**Spend:** $0.00.

## 2026-10-29 — PWA UI polish (branch ui/pwa-polish, uncommitted)

**Shipped (local)**

- Restyled the PWA on the landing page's Palette B tokens; dark mode follows the system. Every element id kept.
- Mark: Undo / Clear for bad taps, one-row damage type control, coin picker hidden without a coin, Measure stays on the screen with a busy state instead of flashing the numbers screen.
- Numbers: photo shows the traced outline, receipts fold into one list, bar chart only with 2+ findings, gate failures list reasons instead of raw JSON.
- Checks: status chip per card, 'Run again' replaces the big buttons; 'Check it twice' no longer re-runs both billed checks.
- Report: rows say Measured, not Confirmed; a Skeptic row shows disputes in red (rows used to say Confirmed even when the skeptic disputed a number). Share/Copy/Install styled.
- SW cache bumped to v5 so installed phones get the new shell.
- 181 tests green, tsc clean. Every screen screenshot-checked in light and dark with a headless Chrome driver.

**Resume point:** review the diff, commit, open a PR. Not yet tried on a real phone (camera, mic, tilt meter layout).

**Spend:** $0.00.

## 2026-10-29 — Design references + merge plan (next session)

- 16 reference sites screenshotted (phone + desktop) in Hackathons\snapclaim-shots\refs\ (retake with refs.mjs). Best: Hover, Spectora, Polycam, Snapsheet, Stripe, Lemonade, Ramp.
- Merge plan, on top of branch ui/pwa-polish (still uncommitted):
  1. Camera: Hover-style guided capture. 'Step 1 of 3 · Photo' + checklist ticks (coin found, damage in frame, steady).
  2. Mark/numbers: Polycam highlighter marks on key words; numbers count up into place like Stripe's live counter, receipt beside each.
  3. Report: Spectora layout. Photo grid with the outline drawn on, numbered table, disputed row in red; report card as hero (Snapsheet).
  4. Tone: one Lemonade-style line illustration on empty states; Ramp-short copy.
  5. Skip: Tractable dark look and Paddle serif (off Palette B).
- Verify with snapclaim-shots\shoot.mjs (light + dark), then commit with no AI attribution and open a PR.

## 2026-10-29 — Design merge plan built (branch ui/pwa-polish, uncommitted)

**Shipped (local)**

- Camera: 'Step 1 of 3 · Photo' pill and a capture checklist. Every tick is a signal the app reads: Coin found (a ring detected in the last few scans), Held steady (the gate locked), Phone level (only shown when orientation sensors report). 'Damage in frame' from the plan was left out because nothing measures it.
- Screens now count 3 steps (Photo, then Mark/Say/Numbers/Check, then Report). Key words in each heading get a green highlighter that sweeps in.
- Numbers count up into place (skipped under reduced motion), and each one shows the receipt id behind it.
- Report: a hero card with the headline number, a two-photo grid (outlined photo plus a close-up cropped to the outline), numbered rows with receipt ids. A row turns red when the skeptic disputes its receipt. `R001` and `r1` are matched as the same receipt, because the models cite the short form.
- Empty report shows a line illustration. Copy is shorter on every screen.
- 181 tests green (the eyebrow test now checks the step labels), tsc clean. shoot.mjs run in light and dark.

**Resume point:** commit, open a PR, try it on a real phone.

**Spend:** $0.00.

## 2026-10-29 — Same references applied to the landing page (worktree snapclaim-landing, branch site/landing, uncommitted)

- index.html: highlighter on a key word per section, numbers count up when scrolled to (with a timed fallback so they never stick at 0), receipt ids beside each number, 'Step N of 3' labels and progress bars on How it works, capture ticks in the step 1 picture.
- Sample report rebuilt like the app's: headline card, photo + close-up, numbered rows with receipts, the disputed row in red. Rows say Measured, not Confirmed.
- 404: line illustration, shorter copy, fixed the second link running off a phone screen.
- Checked with snapclaim-shots\land.mjs (scrolls like a visitor): phone + desktop, light + dark, no sideways overflow.

## 2026-10-29 — Full PWA UI/UX revamp (branch ui/pwa-polish, uncommitted)

The earlier polish passes kept the old 7-screen layout. Tariq asked for a from-scratch revamp built on the references, so the flow itself changed:

- **Home (new):** headline, a green "Start a claim" pill and a sample link (Hover); a line drawing (Lemonade); How it works as four stacked cards (Wise). The camera is only requested after Start, so the permission prompt comes with a reason.
- **Photo:** full-bleed viewfinder with a light sheet over it (CompanyCam): coaching line, checklist ticks, a Coin / No coin toggle (Hover's segmented pill) and the shutter. The detected coin preselects the matching option in the coin picker.
- **Mark:** a dark photo editor (Polycam / magicplan): the photo fills the screen, Undo and Clear float as round buttons, and the type, coin and Measure controls sit in a bottom sheet.
- **Describe:** a chat (Lemonade). The measured result arrives as a card in the thread, then the question; typed or spoken lines show as the user's reply. The mic no longer starts on its own.
- **Report:** Numbers, Check and Report merged into one live document (Spectora / Snapsheet): a headline number that counts up (Stripe), photo plus close-up, the tenant's words, numbered measurement rows that turn red when disputed, the written summary, both checks inline, and the receipts as a mono strip (Ramp). "Create report file" unlocks once both checks finish; Share / Copy / Download appear after it.
- Billed calls are not repeated: going back and forward with the same measurement and line reuses the summary and checks.
- Fixes found along the way: a second scan loop started on every retake; the sample path never set the measurement.
- Brand tokens match the landing page (Archivo, ink #0b2557, green #0f7a36). Light and dark both checked with snapclaim-shots/shoot.mjs, which now walks the new flow. The SW cache is now v6. The shell test checks the new step tags and ids. 181 tests pass and tsc is clean.

**Resume point:** Tariq reviews the screens, then commit (no AI attribution) and open a PR. Not yet tried on a real phone.

**Spend:** $0.00.

## 2026-10-29 — PWA rebuilt as a full product website (branch ui/pwa-polish, uncommitted)

The earlier "revamp" was still a phone-only page. Tariq wanted a full website built from the references, with a proper footer. Researched full-length pages (header to footer) of Hover, Spectora, Ramp, Mercury, Attio, Granola, Wise, Vercel, CompanyCam and Lemonade (`snapclaim-shots/refs-full.mjs`, output in `refsfull/`). They all share one skeleton, and the home screen now follows it:

- Utility bar, sticky nav (links, Install, See a sample, Start a claim; mobile menu via `<details>`), split hero with the product in a phone and floating proof cards, a coin strip (the 8 coins it supports, instead of borrowed customer logos), Hover-style step cards with pictures of each screen, three feature rows (receipts, skeptic, honest about bad photos), a dark numbers band (bench numbers only), audience tabs (tenants, landlords, insurers, contractors; radios, no script), the sample report shown whole, FAQ, a dark closing CTA, and a 4-column footer with wordmark and legal row.
- New `privacy.html`, `terms.html`, `legal.css`. The privacy text matches what the code does: the photo goes to the server (SAM 3.1), a second outline runs on the device, speech is transcribed on the device first.
- New palette and type: ink #0b0f17, warm paper #f6f5f1, signal lime #c6f35e, Geist + Geist Mono. Dark mode follows the system.
- App on desktop: the stepper shows labelled steps; Review and Mark put the photo on the left and the controls in a side panel with tips; the chat is centred with quick-start chips; the report sits beside a sticky action rail.
- app.js: every `[data-start]` / `[data-sample]` button goes through `openCamera` / `loadSample`; footer audience links open their tab; sections fade up and the numbers count up as they scroll in.
- `assets/sample-wall.jpg` and its mask copied from the landing page (Brina Blum, Unsplash). SW cache v7 and the new files are in the shell list.
- shoot.mjs takes a width (`node shoot.mjs tag light 1440`) and moved to port 8098: a `python -m http.server 8099` serving `pwa/` was shadowing it, so the camera test image 404'd.
- 181 tests pass, tsc clean. Phone and desktop, light and dark, walked through every screen.

**Resume point:** Tariq reviews the site at http://127.0.0.1:8099 (or after a deploy), then commit with no AI attribution and open a PR.

**Spend:** $0.00.

## 2026-10-29 — Gate normalization, sample cross-check fix, and photo upload

**Shipped (local)**

- **Sample cross-check fix (`pwa/app.js`):** `runXcheck` previously returned early when `!dmg.mask || !photo` without updating `checkState.xcheck`, leaving `#renderBtn` permanently locked on "Waiting for the checks…" during sample runs. Sample/fixture runs now resolve `xcheck` as `Fixture` (`ok`), and `loadSample()` attaches `sample-wall.jpg` and the ₹10 scale label so the sample report renders its photo grid and unlocks file creation.
- **Evidence gate receipt ID normalization (`src/findings/evidence-gate.ts`):** Live models (`muse-spark-1.3`, `muse-spark-open-1026`) often cite `r1` instead of `R001`. `validateFindings` now normalizes shorthand/case-insensitive receipt IDs (`r1` → `R001`) and enforces per-unit receipt backing for `cm²` / `cm2` (`calibrated_area`).
- **Live provider hardening (`backend/providers.ts`):** Added `areaCm2` and `crackWidthMm` to the `facts` payload sent to Muse Spark and Baseten Spark Open, and stripped optional markdown code fences in `parseFindingDrafts` before `JSON.parse`.
- **Photo upload & paste fallback (`pwa/index.html`, `pwa/app.js`):** Added an `Upload` picker to the camera bar plus clipboard `paste` support. Uploaded photos are re-encoded on canvas (stripping EXIF) and scanned with the Sobel/CoinModel detector before entering the Review → Mark flow.
- **Multi-finding report & sessions (`pwa/app.js`, `pwa/sw.js`):** `runReport` now renders all returned finding statements with their receipt badges, `fillReportDoc` includes secondary findings in the measurements table, `runSkeptic` sends `component`/`masks`/`scaleReference` for server-side `crossCheckMeasurement`, completed reports record to `POST /v1/sessions`, and `sw.js` (`v8`) caches `rle.js` and `coin-detect.js`.
- 184 tests pass, `tsc --noEmit` clean, `npm run eval` 7 pass.

**Spend:** $0.00.

## 2026-10-30 — Calibrated ground-truth eval (coin + ruler), held-out bench archive, and PWA voice proxy round-trip

**Shipped & Verified**

- **Held-out live benchmark (`npm run bench` → `4/4` PASS):** Downloaded the 4 frozen Wikimedia Commons held-out photos (`public-ruin-wall-crack-01`, `public-stone-wall-crack-02`, `public-interior-wall-cracks-03`, `public-cracked-tile-04`) to `fixtures/photos/` (gitignored), segmented each live with SAM 3.1 (`POST /v1/segment` on the live Worker `mode: "live"`), measured via `observeBody` + `measureBody`, ran live skeptic (`POST /v1/skeptic` on `meta-models/muse-spark-open-1026`), and archived the 4 runs in `bench/runs/*.json` (`gitSha: 665aeb5`). `npm run bench` now exits `0` (`4 PASS, 0 FAIL, 0 UNRUN`): all 4 detect the crack and refuse to invent millimetres (`crackLengthMm: null`).
- **Calibrated coin + ground-truth eval (`npm run eval` → `10/10` PASS, `scored=5 medianAbsErrorMm=1.0 (SAM-calibrated n=3: 2.4mm) within10pct=5/5 (100%)`):** Built 3 controlled 800×600 canvas composite scenes over Wikimedia Commons wall backdrops (`calibrated-plaster-hairline-01` with India ₹10 Ø27.0 mm and 90.4 mm vector crack GT; `calibrated-masonry-step-02` with US Quarter Ø24.26 mm and 92.2 mm stepped crack GT; `calibrated-stone-oblique-03` with Euro €1 Ø23.25 mm at 36.8° tilt and 88.5 mm oblique crack GT) alongside `wall-crack` (85.0 mm GT) and `tilted-wall` (49.5° tilt, 66.7 mm GT). Segmented both crack and coin live via SAM 3.1 (`POST /v1/segment`), committed the raw SAM 3.1 COCO RLEs in `fixtures/rle/calibrated-*.json` (verified by `tests/vision-real.test.ts` to reproduce `fixtures/masks/calibrated-*.json` via `observeBody` byte-for-byte), stored `rulerGtMm` in `fixtures/expected/*.json`, and verified live `POST /v1/report` (`gate.ok: true` on all 3; plus verified that omitting `scaleReference` causes Muse Spark 1.3 to refuse mm guesses and report only `0.76%`, `0.95%`, `0.74%`). Recorded the full table and provenance in `docs/eval-report.md` and `README.md`.
- **End-to-end PWA hold-to-speak & `/v1/transcribe` proxy verification:** Recorded a 16 kHz mono Hinglish claim clip (`"North wall par plaster crack hai, ten rupee coin placed next to crack for scale."`) through the PWA `#micBtn` (`MediaRecorder` → `OfflineAudioContext` 16 kHz resample → `encodeWav` 16-bit mono RIFF WAVE, `115,244` bytes / `3,600 ms`). Verified both paths in headless Chrome:
  1. **On-device Whisper (`pwa/voice-worker.js`, `Xenova/whisper-tiny.en`):** Transcribed in `10.05 s` as `"North Wall P.A.R. plaster crack high. 10 RUPY coin placed next to"` (English-only model phonetically maps Hinglish tokens `par`/`hai`/`rupee`).
  2. **`POST /v1/transcribe` proxy + live `POST /v1/report` (`MOCK_MODE=0`):** Proxy round-trip (`requestId: fa57209a26c6fb0c`, `16000 Hz`, `1 ch`, `16-bit`, `3600 ms`) with `languageBias: ["hi-IN", "te-IN", "en-IN"]` and construction-defect `keywords` landed the full Hinglish transcript into `#heard` / `#transcriptBox`, then `#sendBtn` drove live `POST /v1/report` (`Muse Spark 1.3`) to produce 8 receipt-cited findings (`R001`–`R008`, `Every number cited`).

**Spend:** `$0.0425` ledgered on the live Worker (`$4.9575` remaining of `$5.00` cap: 17 SAM 3.1 `/v1/segment` calls at `$0.0025` each + 3 live Muse Spark `/v1/report` calls at `$0`).


