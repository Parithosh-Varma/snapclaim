# Eval report

Updated 2026-10-30. Weak rows stay in; nothing is buried.

## Setup

Two scripts, both deterministic and free to run. `npm run eval` measures the mask fixtures (`10/10` pass across 9 fixtures) against expected values in `fixtures/expected/*.json` and, for every calibrated fixture carrying `rulerGtMm`, scores ground-truth accuracy (`scored=5 medianAbsErrorMm=1.0 (SAM-calibrated n=3: 2.4mm) within10pct=5/5 (100%)`). `npm run bench` reads one archived live run per held-out case from `bench/runs/` and checks it (`4/4` PASS, exit code `0`; see `eval/README.md`). A case with no archived run prints UNRUN and fails the strict command, so a missing run cannot pass as a clean one. Every archived run carries the git SHA, model, prompt version and timestamp it came from. `npm run replay -- request.json measurement.json` reproduces findings + receipts + mode byte-for-byte (see `tests/replay.test.ts`).

## Data and split

Cases and their split live in `bench/split.json`. The held-out split is frozen before any tuning (`frozenAt` 2026-10-28 18:05 +03:00), and a test hashes every held-out case so editing one after the freeze fails `npm test`.

Dev & calibrated accuracy bench (`npm run eval`, 10 cases across 9 fixtures):
- Five calibrated coin + crack cases (`wall-crack`, `tilted-wall`, `calibrated-plaster-hairline-01`, `calibrated-masonry-step-02`, `calibrated-stone-oblique-03`) with known ground-truth crack length (`rulerGtMm` in `fixtures/expected/*.json` and `groundTruth` in `bench/split.json` `dev`) and a coin (`India ₹10 Ø27.0 mm`, `US Quarter Ø24.26 mm`, `Euro €1 Ø23.25 mm`) in the damage plane.
  - **Provenance of `calibrated-plaster-hairline-01`, `calibrated-masonry-step-02`, `calibrated-stone-oblique-03`:** These three scenes are `800×600` canvas composites rendered over the Wikimedia Commons wall photos (`held-4-wall.jpg`, `held-1-wall.jpg`, `held-3-wall.jpg`) with known vector crack geometry (`90.4 mm`, `92.2 mm`, `88.5 mm` at `4.00 px/mm`) and three coin types (`India ₹10`, `US Quarter`, `Euro €1` at 0.80 aspect / 36.8° tilt) to test multi-currency calibration and SAM segmentation end-to-end. Both the crack and coin in each composite were segmented live via `POST /v1/segment` (SAM 3.1). The raw SAM 3.1 COCO RLE responses are committed in `fixtures/rle/calibrated-*.json`, and `tests/vision-real.test.ts` asserts that `observeBody` on `fixtures/rle/calibrated-*.json` reproduces `fixtures/masks/calibrated-*.json` byte-for-byte (`component.areaPx = 480000` is `observeBody`'s full-frame `800 × 600` default when no separate component RLE is passed). Physical camera + tape-measure held-out photos are not yet added to `bench/split.json`'s `heldOut` array.
- Four scale-less dev/real fixtures (`wall-crack-noscale`, `door-peel`, `facade-crack`, plus the secondary `stain-1` mask on `wall-crack`) verifying percent-only fallback and straight/blocky region filtering.

Held-out (`npm run bench`, 4 public photos): none have a scale reference in the crack's plane, so what they test is whether the live pipeline (`sam-3.1` + `observeBody` + `measureBody` + `meta-models/muse-spark-open-1026`) detects the crack and refuses to invent millimetres (`4/4` PASS).

| Case | Surface | Source license | Live `npm run bench` |
| --- | --- | --- | --- |
| public-ruin-wall-crack-01 | wall | CC BY-SA 4.0 (Wikimedia Commons, A.-K. D.) | `PASS` (crack found, `crackLengthMm: null`) |
| public-stone-wall-crack-02 | wall | CC BY-SA 2.0 (Wikimedia Commons, David Smith) | `PASS` (crack found, `crackLengthMm: null`) |
| public-interior-wall-cracks-03 | wall | CC0 (Wikimedia Commons, Nolan Issac) | `PASS` (crack found, `crackLengthMm: null`) |
| public-cracked-tile-04 | tile | CC BY-SA 4.0 (Wikimedia Commons, Mk2010) | `PASS` (crack found, `crackLengthMm: null`) |

## Baselines

### (a) Model-only / uncalibrated estimate

- **Pipeline without scale reference (`POST /v1/report` with `scaleReference` omitted):** Verified live on Muse Spark 1.3 (`requestId`s `085a0eff065bdc7c`, `e0281f6a43bd2528`, `09f8341a6b13abfa`). Without a coin reference, the engine emits `mode: "percent-only"` (`crackLengthMm: null`) and Muse Spark 1.3 refuses to invent millimetre guesses, reporting only the area percentages (`0.76%`, `0.95%`, `0.74%`).
- **Uncorrected 2D pixel math (no ellipse tilt stretch):** On `tilted-wall` (49.5° camera tilt, coin aspect 0.65), naive pixel scaling without `coinTiltStretch` yields `55.6 mm` (`-11.1 mm` / `-16.6%` error vs `66.7 mm` ground truth), whereas tilt-corrected `measureSession` yields `66.8 mm` (`+0.1 mm`).
- **Raw photo-only Muse Spark guess (`bench/model-only/`):** `UNRUN` — requires calling `https://api.meta.ai/v1/chat/completions` directly with the raw image and archiving the response under `bench/model-only/<case>.json` (see PR #33).

### (b) No-measurement photo report

"Looks moderately damaged" with no numbers. Reference point for the claim that numbers change decisions; scored qualitatively, not hidden.

## Metrics

### Measured vs ground-truth accuracy (`npm run eval`)

Every calibrated fixture stores `rulerGtMm` in `fixtures/expected/<case>.json` alongside the regression target `crackLengthMm`, and `eval/bench.ts` computes the ground-truth error on every run. The 3 `calibrated-*` composite scenes were segmented live via `POST /v1/segment` (SAM 3.1, raw RLEs in `fixtures/rle/calibrated-*.json`), observed via `observeBody`, measured via `measureBody`, and verified through `POST /v1/report` (Muse Spark 1.3, `gate.ok: true`).

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

### Skeptic DISPUTED calls

The skeptic returns free text, so a finding's verdict is read from it by `bench/archive.ts`: a draft citing the finding's receipts and saying DISPUTED disputes it, a draft that only restates it confirms it, and a finding never cited gets no verdict and counts as missing.

Scored by `scoreDisputes` in `bench/score.ts`, with DISPUTED as the positive class.

## Results

| Date | `npm run eval` | `npm run bench` (held-out) | Notes |
|---|---|---|---|
| 2026-10-28 | 2 pass, 0 skip, 0 fail | 4 UNRUN | Initial `wall-crack` fixture: 5.17% / 85.9 mm / 2.6 mm wide / 2.19 cm² (significant); stain: 1.29% percent-only (moderate) |
| 2026-10-29 | 7 pass, 0 skip, 0 fail | 4 UNRUN | Added `tilted-wall` (66.8 mm vs 66.7 mm true at 49° tilt), `facade-crack` (real brick facade + straight/blocky edge rejection), `door-peel`, `wall-crack-noscale` |
| 2026-10-30 | **10 pass, 0 skip, 0 fail** | **4 PASS, 0 FAIL, 0 UNRUN** | Added 3 live SAM 3.1 coin-calibrated composite cases (`fixtures/rle/calibrated-*.json`; `88.0 mm`, `86.6 mm`, `89.5 mm`; SAM median err `2.4 mm`, overall `1.0 mm`, `5/5` within ±10% scored via `rulerGtMm`) + archived all 4 held-out live runs (`bench/runs/*.json`) |

## Failures and misses

- Stepped crack corners (`calibrated-masonry-step-02`) lose ~6% length (`86.6 mm` vs `92.2 mm` ground truth) due to SAM 3.1 mask corner smoothing and skeleton endpoint pruning.
- Physical camera + tape-measure held-out photos are not yet in `bench/split.json` (`heldOut`); the 3 `calibrated-*` cases in `dev` are controlled 800×600 canvas composites segmented live through SAM 3.1 (`fixtures/rle/calibrated-*.json`), and raw photo-only Muse Spark guesses (`bench/model-only/`) remain `UNRUN`.
- On-device `Xenova/whisper-tiny.en` (`pwa/voice-worker.js`) maps Hindi/Hinglish code-switched tokens phonetically (`"par"` → `"P.A.R."`, `"hai"` → `"high"`, `"rupee"` → `"RUPY"`), whereas the `/v1/transcribe` proxy (`muse-voice-transcribe-1.0` with `languageBias: ["hi-IN", "te-IN", "en-IN"]`) preserves the code-switched Hinglish terms.
- Photo bytes in `fixtures/photos/` stay gitignored; reproducible SAM 3.1 RLEs (`fixtures/rle/`), mask statistics (`fixtures/masks/`), ground-truth expectations (`fixtures/expected/`), and archived held-out runs (`bench/runs/`) are committed and verified by `npm test`, `npm run eval`, and `npm run bench`.

## Datasets and licenses

The four held-out photos above are from Wikimedia Commons (licenses and source URLs in `bench/split.json`). Sample wall photo (`pwa/assets/sample-wall.jpg`) is by Brina Blum on Unsplash.

Every public dataset used here gets its name, license and exact split listed.
