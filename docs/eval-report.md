# Eval report

Updated 2026-11-03. Weak rows stay in; nothing is buried.

## Setup

Two scripts, both deterministic and free to run. `npm run eval` measures the dev mask fixtures against stored expected values (these are regression baselines taken from the pipeline's own output, not independent hand measurements; `npm run bench:truth` is the check against known answers). `npm run bench` reads one archived live run per held-out case from `bench/runs/` and checks it (see `eval/README.md`). A case with no archived run prints UNRUN and fails the strict command, so a missing run cannot pass as a clean one. Every archived run carries the git SHA, model, prompt version and timestamp it came from. `npm run replay -- request.json measurement.json` reproduces findings + receipts + mode byte-for-byte (see `tests/replay.test.ts`).

## Data and split

Cases and their split live in `bench/split.json`. The held-out split is frozen before any tuning (`frozenAt` 2026-10-28 18:05 +03:00), and a test hashes every held-out case so editing one after the freeze fails `npm test`.

Dev fixtures (`npm run eval`, 10 cases across 9 fixtures). The 10 passes are regression checks against the pipeline's own stored output, not an accuracy result:
- Five synthetic coin + crack cases (`wall-crack`, `tilted-wall`, `calibrated-plaster-hairline-01`, `calibrated-masonry-step-02`, `calibrated-stone-oblique-03`) whose true crack length is known because the crack was drawn (`rulerGtMm` in `fixtures/expected/*.json` and `groundTruth` in `bench/split.json` `dev`), with a coin (`India ₹10 Ø27.0 mm`, `US Quarter Ø24.26 mm`, `Euro €1 Ø23.25 mm`) in the damage plane. No camera, ruler or tape was involved in any of the five: `rulerGtMm` is a field name, not a ruler reading. `wall-crack` and `tilted-wall` are hand-built mask fixtures that never went through SAM.
  - **Provenance of `calibrated-plaster-hairline-01`, `calibrated-masonry-step-02`, `calibrated-stone-oblique-03`:** These three scenes are `800×600` canvas composites rendered over the Wikimedia Commons wall photos (`held-4-wall.jpg`, `held-1-wall.jpg`, `held-3-wall.jpg`) with known vector crack geometry (`90.4 mm`, `92.2 mm`, `88.5 mm` at `4.00 px/mm`) and three coin types (`India ₹10`, `US Quarter`, `Euro €1` at 0.80 aspect / 36.8° tilt) to test multi-currency calibration and SAM segmentation end-to-end. Both the crack and coin in each composite were segmented live via `POST /v1/segment` (SAM 3.1). The raw SAM 3.1 COCO RLE responses are committed in `fixtures/rle/calibrated-*.json`, and `tests/vision-real.test.ts` asserts that `observeBody` on `fixtures/rle/calibrated-*.json` reproduces `fixtures/masks/calibrated-*.json` byte-for-byte (`component.areaPx = 480000` is `observeBody`'s full-frame `800 × 600` default when no separate component RLE is passed). The composite images themselves are not committed, so the RLEs can be re-measured from the repo but the segmentation cannot be re-run from it. The backdrops are three of the four public held-out photos, so those photos have now been seen by a dev fixture and should be treated as less than fully unseen.
- Four scale-less dev/real fixtures (`wall-crack-noscale`, `door-peel`, `facade-crack`, plus the secondary `stain-1` mask on `wall-crack`) verifying percent-only fallback and straight/blocky region filtering.

Held-out: 12 cases. Four public photos with no scale reference in the crack's plane test whether the pipeline refuses to invent millimetres. Seven team photos with a coin joined on 2026-10-30 (see below); none has a tape measurement yet, so they test detection/refusals. One span-only tape case exists (`terrace-slab-tape-01`: Rs 2 coin in frame, tape span 227 mm [225–230], n = 1, coin 25 mm user-supplied); the 10–20-case set is still missing.

| Case | Surface | Source license |
| --- | --- | --- |
| public-ruin-wall-crack-01 | wall | CC BY-SA 4.0 (Wikimedia Commons, A.-K. D.) |
| public-stone-wall-crack-02 | wall | CC BY-SA 2.0 (Wikimedia Commons, David Smith) |
| public-interior-wall-cracks-03 | wall | CC0 (Wikimedia Commons, Nolan Issac) |
| public-cracked-tile-04 | tile | CC BY-SA 4.0 (Wikimedia Commons, Mk2010) |

## Baselines

### (a) Model-only / uncalibrated estimate

- **Pipeline without scale reference (`POST /v1/report` with `scaleReference` omitted):** Verified live on Muse Spark 1.3 (`requestId`s `085a0eff065bdc7c`, `e0281f6a43bd2528`, `09f8341a6b13abfa`). Without a coin reference, the engine emits `mode: "percent-only"` (`crackLengthMm: null`) and Muse Spark 1.3 refuses to invent millimetre guesses, reporting only the area percentages (`0.76%`, `0.95%`, `0.74%`). The request ids are what was logged at the time; the raw responses are not archived, so this line cannot be reproduced from the repo.
- **Uncorrected 2D pixel math (no ellipse tilt stretch):** On `tilted-wall` (49.5° camera tilt, coin aspect 0.65), naive pixel scaling without `coinTiltStretch` yields `55.6 mm` (`-11.1 mm` / `-16.6%` error vs `66.7 mm` ground truth), whereas tilt-corrected `measureSession` yields `66.8 mm` (`+0.1 mm`).
- **Raw photo-only Muse Spark guess (`bench/model-only/`):** `UNRUN` — requires calling `https://api.meta.ai/v1/chat/completions` directly with the raw image and archiving the response under `bench/model-only/<case>.json` (see PR #33).

### (b) No-measurement photo report

"Looks moderately damaged" with no numbers. Reference point for the claim that numbers change decisions; scored qualitatively, not hidden.

## Metrics

### Measured vs known answer on synthetic cases (`npm run eval`)

**This table is not real-photo accuracy.** All five cases are synthetic, with a crack drawn from known geometry and no physical measurement behind it. It shows the pipeline recovers a drawn crack, and on the three composites that SAM 3.1 can segment one. A cleanly drawn crack is likely easier than a real one, so expect real-photo error to be worse. Real-photo accuracy stays UNSCORED until a real crack is tape-measured (see `npm run bench:gap` below).

Every synthetic fixture stores `rulerGtMm` in `fixtures/expected/<case>.json` alongside the regression target `crackLengthMm`, and `eval/bench.ts` computes the error against it on every run. The 3 `calibrated-*` composite scenes were segmented live via `POST /v1/segment` (SAM 3.1, raw RLEs in `fixtures/rle/calibrated-*.json`), observed via `observeBody`, measured via `measureBody`, and sent through `POST /v1/report` (Muse Spark 1.3, `gate.ok: true`). The measured numbers reproduce from the repo; the `/v1/report` responses and the Receipts column come from those live calls and are not archived.

| Case | Provenance & Raw RLE | Coin & Pose | Ground Truth (`rulerGtMm`) | Uncalibrated / No-Scale Baseline | SnapClaim Measured (mm) | SnapClaim Error | Within ±10%? | Receipts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `wall-crack` | Synthetic fixture (`fixtures/masks/wall-crack.json`) | India ₹10 (Ø27.0 mm, flat) | 85.0 mm | `null` (refused without scale) / model-only `UNRUN` | **85.9 mm** (w 2.6 mm, 2.19 cm²) | +0.9 mm (**+1.1%**) | Yes | `R001`–`R005` |
| `tilted-wall` | Synthetic 49.5° tilt (`fixtures/masks/tilted-wall.json`) | US Quarter (Ø24.26 mm, aspect 0.65) | 66.7 mm | **55.6 mm** (-11.1 mm / -16.6% without tilt stretch) | **66.8 mm** (stretch 1.201×) | +0.1 mm (**+0.1%**) | Yes | `R001`–`R005` |
| `calibrated-plaster-hairline-01` | 800×600 composite + live SAM 3.1 (`fixtures/rle/calibrated-plaster-hairline-01.json`) | India ₹10 (Ø27.0 mm, tilt 3.3°) | 90.4 mm | `null` (0.76% only without scale) / model-only `UNRUN` | **88.0 mm** (w 2.4 mm, 2.13 cm²) | -2.4 mm (**-2.7%**) | Yes | `R001`–`R007` |
| `calibrated-masonry-step-02` | 800×600 composite + live SAM 3.1 (`fixtures/rle/calibrated-masonry-step-02.json`) | US Quarter (Ø24.26 mm, tilt 6.0°) | 92.2 mm | `null` (0.95% only without scale) / model-only `UNRUN` | **86.6 mm** (w 3.1 mm, 2.65 cm²) | -5.6 mm (**-6.1%**) | Yes | `R001`–`R007` |
| `calibrated-stone-oblique-03` | 800×600 composite + live SAM 3.1 (`fixtures/rle/calibrated-stone-oblique-03.json`) | Euro €1 (Ø23.25 mm, tilt 36.8°) | 88.5 mm | `null` (0.74% only without scale) / model-only `UNRUN` | **89.5 mm** (w 2.3 mm, 2.05 cm²) | +1.0 mm (**+1.1%**) | Yes | `R001`–`R007` |
| **Summary (all 5)** | `npm run eval` | **3 coins, 0°–49.5° tilt** | — | Refuses mm without scale; model-only `UNRUN` | **Median abs err: 1.0 mm** | **Max err: 6.1%** | **5 / 5 (100%)** | **100% receipt-cited** |
| **Summary (SAM 3.1 n = 3)** | `fixtures/rle/calibrated-*.json` | **3 coins, 3.3°–36.8° tilt** | — | Refuses mm without scale (`0.76%`, `0.95%`, `0.74%`) | **Median abs err: 2.4 mm** | **Max err: 6.1%** | **3 / 3 (100%)** | **100% receipt-cited** |

**Why `calibrated-masonry-step-02` is `-6.1%` (`86.6 mm` vs `92.2 mm` ground truth):** SAM 3.1's 1-bit mask slightly rounds the inner corner of the stepped masonry turn and trims ~2 px at each crack tip (`skeletonPx: 358.3` vs `368.8` true path px). We keep this row unadjusted (`-5.6 mm`) to show realistic SAM mask-endpoint rounding on stepped cracks.

Held-out side is scored by `npm run bench:gap` (`bench/gap.ts`): for every scaled held-out case with a `groundTruth` it compares the archived pipeline run and a model-only guess from `bench/model-only/` against the thread path (`pathMm`), and prints the straight-span comparison labelled (`span=…(span) spanErr=…`) but never scores it. Refusals and missing files are counted per arm, not dropped. The dev side still comes from `npm run eval` and is not wired into the same table yet. `terrace-slab-tape-01` is archived in `bench/runs/` + `bench/model-only/` — `npm run bench:gap` exit 0.

### Skeptic DISPUTED calls

The skeptic returns free text, so a finding's verdict is read from it by `bench/archive.ts`: a draft citing the finding's receipts and saying DISPUTED disputes it, a draft that only restates it confirms it, and a finding never cited gets no verdict and counts as missing.

Scored by `scoreDisputes` in `bench/score.ts`, with DISPUTED as the positive class.

## Results

| Date | `npm run eval` | `npm run bench` (held-out) | Notes |
|---|---|---|---|
| 2026-10-28 | 2 pass, 0 skip, 0 fail | scorer unit-tested, no live runs yet | wall-crack: 5.17% / 85.9 mm / 2.6 mm wide (unverified — no width ground truth) / 2.19 cm² (significant); stain: 1.29% percent-only (moderate) |
| 2026-10-30 | 7 pass, 0 skip, 0 fail | dev fixtures grown (door-peel, facade-crack, tilted-wall, noscale); held-out still 0 archived runs (UNRUN ×4, strict exit 1) | tilted-wall: 0.27% / 66.8 mm cosmetic; facade-crack: 0.74% percent-only significant |
| 2026-11-02 | held-out: 4 public runs archived, 4/4 refused millimetres; 7 team cases UNRUN (strict exit 1) | skeptic recall 0 on 2 DISPUTED (post-freeze labels in `bench/audit/heldout-masks.json`), see below | first live held-out runs, deployed worker at 4f96974: SAM 3.1 point prompts, muse-spark-1.3 findings, muse-spark-open-1026 skeptic |
| 2026-11-02 | 7 pass, 0 skip, 0 fail; gap INCOMPLETE (no runs yet) | — | `terrace-slab-tape-01`: builder slab DSC_0711.JPG, Ref SC-25D35C5E with wrong 23 mm coin read R005 218.5 mm (superseded — see 2026-11-03) |
| 2026-11-02 | 10 pass, 0 skip, 0 fail (adds 3 synthetic `calibrated-*` cases) | held-out: 0 archived runs on `main` | synthetic known-answer cases only: scored 5, median abs error 1.0 mm (SAM composites n=3: 2.4 mm), 5/5 within ±10%. Real-photo accuracy is the terrace-slab row above |
| 2026-11-03 | 7 pass, 0 skip, 0 fail; gap exit 0, both arms scored | — | `terrace-slab-tape-01`, n = 1: archived run R005 237.5 mm (25 mm nominal, engine recompute R001 0.773994, R004 7.69 cm²) vs thread 238.8 mm ±4 (err 1.3, 0.5%, in) vs Spark photo-alone 315 mm (err 76.2, 31.9%, out); span 227 mm [225–230] printed, span err 10.5 mm / 4.6%, never scored; width 3.2 mm unverified; sensitivity at ruler 24 mm: R005 228.0 mm / R006 3.1 mm / R004 7.09 cm². Run + guess in `bench/runs/` + `bench/model-only/`. No new live calls (run is deterministic recompute; guess reuses 2026-11-02 Spark 315 mm). |
| 2026-11-04 | 10 pass, 0 skip, 0 fail; gap UNSCORED (span-only truth, never scored) | — | `terrace-slab-tape-01`, n = 1, final: coin confirmed 25 mm user-supplied (23 mm was a mistake — the 2026-11-02 218.5 mm run is void, not superseded); thread 238.8 mm removed from the case (unconfirmed string crack, must not validate this crack). Engine re-run in `src/engine/measure.ts` at 25 mm from signed-report scalars: R001 0.773994, R004 7.69 cm², R005 237.5 mm, R006 3.2 mm (unverified, no width ground truth). Vs tape span 227 mm [225–230]: err +10.5 mm (+4.6%, context, never scored); coin ±0.5 mm scales mm values ±2%. Archived run replaced with the full receipted result (self-reported scalars, no RLE in repo — pixel provenance pending masks). No live calls, no push. |

## Failures and misses

- Held-out photos have masks/expected files but no photo bytes in the repo
  (`fixtures/photos/` gitignored) - they document the protocol, not results.
- Live SAM 3.1 segment verified on one photo 2026-10-29 (`200`, full-frame RLE, $0.0025).
- Live skeptic verified 2026-10-29 on the hackathon model `meta-models/muse-spark-open-1026`.
- Stepped crack corners (`calibrated-masonry-step-02`) lose ~6% length (`86.6 mm` vs `92.2 mm` ground truth) due to SAM 3.1 mask corner smoothing and skeleton endpoint pruning.
- `terrace-slab-tape-01` has a tape span only (227 mm, context, never scored), so no real crack has a scored length yet. The seven `team-coin-*` photos in `heldOut` have a coin but no measured length; the 3 `calibrated-*` cases in `dev` are controlled 800×600 canvas composites segmented live through SAM 3.1 (`fixtures/rle/calibrated-*.json`).
- On-device `Xenova/whisper-tiny.en` (`pwa/voice-worker.js`) maps Hindi/Hinglish code-switched tokens phonetically (`"par"` → `"P.A.R."`, `"hai"` → `"high"`, `"rupee"` → `"RUPY"`), whereas the `/v1/transcribe` proxy (`muse-voice-transcribe-1.0` with `languageBias: ["hi-IN", "te-IN", "en-IN"]`) preserves the code-switched Hinglish terms.
- Photo bytes in `fixtures/photos/` stay gitignored; SAM 3.1 RLEs (`fixtures/rle/`), mask statistics (`fixtures/masks/`) and expected values (`fixtures/expected/`) are committed and checked by `npm test` and `npm run eval`.
- 2026-11-02 live held-out runs: refusal held on all four public photos (percent-only, no mm receipt). But the bench's "crack found" only means "a finding exists". Looking at the masks, two of the four are on the crack (ruin wall, ceiling) and two are not: on `public-stone-wall-crack-02` SAM returned the whole curved wall plus the sign (27.01%), and on `public-cracked-tile-04` it returned one broken tile piece (3.81%). The skeptic CONFIRMED all four, so it caught neither wrong mask. Those hand labels live in `bench/audit/heldout-masks.json` (dated, with who labeled each one), not in `split.json`, so the frozen case hashes stay the same. `npm run bench` scores them: `tp=0 fn=2 tn=2`, recall 0. Neither bad mask was caught by the PWA's wall-size filter, which only drops masks over 50% of the frame.

## Datasets and licenses

The four held-out photos above are the public external set. Photo files stay local; source URLs are in `bench/split.json`. Three of them are also the backdrops of the `calibrated-*` dev composites, so treat them as less than fully unseen. The scaled case `terrace-slab-tape-01` (team-internal slab DSC_0711.JPG, coin in frame, tape span 227 mm [225–230], n = 1, coin 25 mm user-supplied) is the first tape ground truth; its photo stays local (gitignored).

Seven team photos (Parithosh, DSLR, 2026-10-29, a 2 INR coin in the crack's plane) joined the held-out set on 2026-10-30 as `team-coin-*`: two with no crack, three full-frame cracks, two cracks that leave the frame. They are team-internal and not redistributed. None has a measured crack length yet, so they test detection and refusal behaviour; accuracy on them stays UNSCORED until the wall is measured.

Every public dataset used here gets its name, license and exact split listed.

## Appendix: Terrace-slab field proof (4 Nov 2026, SC-D8ECE64B)

Ref `SC-D8ECE64B` — "crack on the pavement slab of the terrace", photo-pixel outlines scaled by coin diameter tilt-corrected from ellipse.

- Crack length **232 mm [R005]** (Confirmed) vs straight-tape **227 mm** (225–230).
- Thread **238.8 mm**: different horizontal crack, NOT comparable.
- Pin-to-pin **274 mm** (5.2+4.8+4.5+4.2+2.9+5.8 cm), path-following.
- Surface **0.73% [R002]**, area **7.48 cm² [R004]**, severity **significant [R007]**.
- Width **3.2 mm [R006]** Unverified — no width ground truth.
- Verification: evidence gate passed / skeptic verified / mask cross-check verified.
- Live PDFs: [snapclaim-SC-D8ECE64B.pdf](https://snapclaim.pages.dev/reports/snapclaim-SC-D8ECE64B.pdf) · [Case Study Comparative Measurement of a Terrace-Slab Crack.pdf](https://snapclaim.pages.dev/reports/Case%20Study%20Comparative%20Measurement%20of%20a%20Terrace-Slab%20Crack.pdf)
