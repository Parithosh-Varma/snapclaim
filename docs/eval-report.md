# Eval report

Updated 2026-10-30. Weak rows stay in; nothing is buried.

## Setup

Two scripts, both deterministic and free to run. `npm run eval` measures the mask fixtures (`10/10` pass across 9 fixtures) against hand-checked expected values. `npm run bench` reads one archived live run per held-out case from `bench/runs/` and checks it (`4/4` PASS, exit code `0`; see `eval/README.md`). A case with no archived run prints UNRUN and fails the strict command, so a missing run cannot pass as a clean one. Every archived run carries the git SHA, model, prompt version and timestamp it came from. `npm run replay -- request.json measurement.json` reproduces findings + receipts + mode byte-for-byte (see `tests/replay.test.ts`).

## Data and split

Cases and their split live in `bench/split.json`. The held-out split is frozen before any tuning (`frozenAt` 2026-10-28 18:05 +03:00), and a test hashes every held-out case so editing one after the freeze fails `npm test`.

Dev & calibrated accuracy bench (`npm run eval`, 10 cases across 9 fixtures):
- Five calibrated coin + crack cases (`wall-crack`, `tilted-wall`, `calibrated-plaster-hairline-01`, `calibrated-masonry-step-02`, `calibrated-stone-oblique-03`) with physical ruler ground truth in mm and a coin (`India ₹10 Ø27.0 mm`, `US Quarter Ø24.26 mm`, `Euro €1 Ø23.25 mm`) in the damage plane.
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

Vision-only / uncalibrated baseline: estimating crack length in mm from the photo alone without coin-scale receipts or ellipse tilt stretch. Tested across all 5 calibrated cases against physical ruler ground truth, reporting absolute error (mm), relative error (%), median absolute error, and % within ±10%.

### (b) No-measurement photo report

"Looks moderately damaged" with no numbers. Reference point for the claim that numbers change decisions; scored qualitatively, not hidden.

## Metrics

### Guessed vs measured gap (Calibrated Coin + Ruler Benchmark)

All 5 calibrated cases have a known physical ruler ground truth (`Ruler GT mm`) and a coin in the damage plane (`India ₹10 Ø27.0 mm`, `US Quarter Ø24.26 mm`, `Euro €1 Ø23.25 mm`). The 3 real-photo calibrated scenes (`calibrated-plaster-hairline-01`, `calibrated-masonry-step-02`, `calibrated-stone-oblique-03`) were segmented live via `POST /v1/segment` (SAM 3.1), measured via `observeBody` + `measureBody`, and verified through `POST /v1/report` (Muse Spark 1.3, `gate.ok: true`).

| Case | Coin & Pose | Ruler GT (mm) | Vision-Only / Uncalibrated Guess (mm) | Guess Error | SnapClaim Measured (mm) | SnapClaim Error | Within ±10%? | Receipts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `wall-crack` (`sample-wall.jpg`) | India ₹10 (Ø27.0 mm, flat) | 85.0 mm | 120.0 mm | +35.0 mm (+41.2%) | **85.9 mm** (w 2.6 mm, 2.19 cm²) | +0.9 mm (**+1.1%**) | Yes | `R001`–`R005` |
| `tilted-wall` (49.5° tilt) | US Quarter (Ø24.26 mm, aspect 0.65) | 66.7 mm | 55.6 mm (uncorrected foreshortening) | -11.1 mm (-16.6%) | **66.8 mm** (stretch 1.201×) | +0.1 mm (**+0.1%**) | Yes | `R001`–`R005` |
| `calibrated-plaster-hairline-01` | India ₹10 (Ø27.0 mm, tilt 3.3°) | 90.4 mm | 130.0 mm | +39.6 mm (+43.8%) | **88.0 mm** (w 2.4 mm, 2.13 cm²) | -2.4 mm (**-2.7%**) | Yes | `R001`–`R007` |
| `calibrated-masonry-step-02` | US Quarter (Ø24.26 mm, tilt 6.0°) | 92.2 mm | 150.0 mm | +57.8 mm (+62.7%) | **86.6 mm** (w 3.1 mm, 2.65 cm²) | -5.6 mm (**-6.1%**) | Yes | `R001`–`R007` |
| `calibrated-stone-oblique-03` | Euro €1 (Ø23.25 mm, tilt 36.8°) | 88.5 mm | 115.0 mm | +26.5 mm (+29.9%) | **89.5 mm** (w 2.3 mm, 2.05 cm²) | +1.0 mm (**+1.1%**) | Yes | `R001`–`R007` |
| **Summary (n = 5)** | **3 coins, 0°–49.5° tilt** | — | **Median abs err: 35.0 mm** | **0 / 5 (0%) within ±10%** | **Median abs err: 1.0 mm** | **Max err: 6.1%** | **5 / 5 (100%)** | **100% receipt-cited** |

**Why `calibrated-masonry-step-02` is `-6.1%` (`86.6 mm` vs `92.2 mm` ruler):** SAM 3.1's 1-bit mask slightly rounds the inner corner of the stepped masonry turn and trims ~2 px at each crack tip (`skeletonPx: 358.3` vs `368.8` true path px). We keep this row unadjusted (`-5.6 mm`) to show realistic SAM mask-endpoint rounding on stepped cracks.

### Skeptic DISPUTED calls

The skeptic returns free text, so a finding's verdict is read from it by `bench/archive.ts`: a draft citing the finding's receipts and saying DISPUTED disputes it, a draft that only restates it confirms it, and a finding never cited gets no verdict and counts as missing.

Scored by `scoreDisputes` in `bench/score.ts`, with DISPUTED as the positive class.

## Results

| Date | `npm run eval` | `npm run bench` (held-out) | Notes |
|---|---|---|---|
| 2026-10-28 | 2 pass, 0 skip, 0 fail | 4 UNRUN | Initial `wall-crack` fixture: 5.17% / 85.9 mm / 2.6 mm wide / 2.19 cm² (significant); stain: 1.29% percent-only (moderate) |
| 2026-10-29 | 7 pass, 0 skip, 0 fail | 4 UNRUN | Added `tilted-wall` (66.8 mm vs 66.7 mm true at 49° tilt), `facade-crack` (real brick facade + straight/blocky edge rejection), `door-peel`, `wall-crack-noscale` |
| 2026-10-30 | **10 pass, 0 skip, 0 fail** | **4 PASS, 0 FAIL, 0 UNRUN** | Added 3 live SAM 3.1 coin-calibrated crack cases (`88.0 mm`, `86.6 mm`, `89.5 mm`; median error `1.0 mm`, `5/5` within ±10%) + archived all 4 held-out live runs (`bench/runs/*.json`) |

## Failures and misses

- Stepped crack corners (`calibrated-masonry-step-02`) lose ~6% length (`86.6 mm` vs `92.2 mm` ground truth) due to SAM 3.1 mask corner smoothing and skeleton endpoint pruning.
- On-device `Xenova/whisper-tiny.en` (`pwa/voice-worker.js`) maps Hindi/Hinglish code-switched tokens phonetically (`"par"` → `"P.A.R."`, `"hai"` → `"high"`, `"rupee"` → `"RUPY"`), whereas the `/v1/transcribe` proxy (`muse-voice-transcribe-1.0` with `languageBias: ["hi-IN", "te-IN", "en-IN"]`) preserves the code-switched Hinglish terms.
- Photo bytes in `fixtures/photos/` stay gitignored; reproducible RLE/mask statistics and archived held-out runs live in `fixtures/masks/`, `fixtures/expected/`, and `bench/runs/`.

## Datasets and licenses

The four held-out photos above are from Wikimedia Commons (licenses and source URLs in `bench/split.json`). Sample wall photo (`pwa/assets/sample-wall.jpg`) is by Brina Blum on Unsplash.

Every public dataset used here gets its name, license and exact split listed.
