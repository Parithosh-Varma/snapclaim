# Eval report

Updated 2026-10-30. Weak rows stay in; nothing is buried.

## Setup

Two scripts, both deterministic and free to run. `npm run eval` measures the dev mask fixtures against hand-checked expected values. `npm run bench` reads one archived live run per held-out case from `bench/runs/` and checks it (see `eval/README.md`). A case with no archived run prints UNRUN and fails the strict command, so a missing run cannot pass as a clean one. Every archived run carries the git SHA, model, prompt version and timestamp it came from. `npm run replay -- request.json measurement.json` reproduces findings + receipts + mode byte-for-byte (see `tests/replay.test.ts`).

Dev fixtures are code-drawn masks measured by code: they validate the arithmetic and the calibration model, not photo capture. Keep them out of any accuracy headline; photo accuracy is the n=1 tape row below, stated with its miss.

## Data and split

Cases and their split live in `bench/split.json`. The held-out split is frozen before any tuning (`frozenAt` 2026-10-28 18:05 +03:00), and a test hashes every held-out case so editing one after the freeze fails `npm test`.

Dev: one synthetic wall-crack fixture with a coin scale reference.

Held-out: four public photos, none with a scale reference in the crack's plane, so what they test is whether the pipeline refuses to invent millimetres. Scaled accuracy cases (coin or ruler in frame) are still missing; scaled cases print SKIP until accuracy scoring exists.

| Case | Surface | Source license |
| --- | --- | --- |
| public-ruin-wall-crack-01 | wall | CC BY-SA 4.0 (Wikimedia Commons, A.-K. D.) |
| public-stone-wall-crack-02 | wall | CC BY-SA 2.0 (Wikimedia Commons, David Smith) |
| public-interior-wall-cracks-03 | wall | CC0 (Wikimedia Commons, Nolan Issac) |
| public-cracked-tile-04 | tile | CC BY-SA 4.0 (Wikimedia Commons, Mk2010) |

## Baselines

### (a) Model-only qualitative estimate

Muse Spark vision-only: the photo alone, one number in mm, no receipts.
Not yet run (needs the real-photo set + key). Protocol fixed: same photos,
same ruler ground truth, median absolute error + % within ±10%.

### (b) No-measurement photo report

"Looks moderately damaged" with no numbers. Reference point for the claim
that numbers change decisions; scored qualitatively, not hidden.

## Metrics

### Guessed vs measured gap

Median absolute error (mm) and % within ±10% on calibrated cases, dev vs
held-out separately. The demo table lives in the README; the source of
truth is `npm run bench:gap`.

First scored row (live output 2026-11-02, real builder-measured fixture
`terrace-slab-tape-01`: terrace slab `DSC_0711.JPG`, 2 INR coin taped in the
crack's plane, straight-tape chord 227 mm, pin-to-pin path 274 mm, pipeline Ref SC-25D35C5E):

| Case | Chord (tape) | Path truth (pins) | Measured (pipeline) | Model-only (Muse Spark photo-alone, tape not legible in `DSC_0710.JPG`) |
|---|---|---|---|---|
| terrace-slab-tape-01 | 227 mm chord (range 225-230) - context only | 274 mm pin polyline (closest path truth) | 218.5 mm [R005] (-3.7% vs chord, inside; **-20.3% vs pin path, outside - reads low**) | 315 mm (+38.8% vs chord, outside; +15.0% vs pin path, outside - reads high) |

`measured: scored=1 medianAbsErrorMm=8.5 within10pct=100%` scores the chord only.
Path accuracy is stated plainly above: the pipeline reads low against the pin
path, the guess reads high. The chord is not path accuracy - a path must exceed
its chord, so no "+X% vs 227" figure is a path claim. Thread 238.8 mm was a
different crack with no coin and is excluded. Second run SC-D8ECE64B 2026-11-04
232 mm [R005] (-15.3% vs pin path, also low) is a different photo/date, labeled
separately; the 237.5 mm once shown for SC-25D35C5E was a coin-diameter error
(25 mm nominal vs 23 mm bench; ruler 24 mm = 228 mm) fixed to the archived 218.5 mm.

`measured: scored=1 medianAbsErrorMm=8.5 within10pct=100% refused=0 missing=0`;
`model-only: scored=1 medianAbsErrorMm=88 within10pct=0% refused=0 missing=0`.
n=1 - modest, stated as-is. The demo's skeptic red-to-green runs on this
same fixture, not on a scripted mock.

Held-out side is scored by `npm run bench:gap` (`bench/gap.ts`): for every scaled held-out case with a `groundTruth` it compares the archived pipeline run and a model-only guess from `bench/model-only/` against the same tape measurement, and prints both arms side by side. Refusals and missing files are counted per arm, not dropped. The dev side still comes from `npm run eval` and is not wired into the same table yet.

### Scale uncertainty (coin plane + tilt)

A coin is a px→mm factor only in the crack's plane with a roughly
fronto-parallel photo. The pipeline does not print a ± range for that yet;
instead it warns, corrects, and refuses, in that order:

- `/v1/observe` fits the coin ellipse and returns `referenceCheck`
  (`aspect`, `tiltDeg`, `edgeError`, `rejected`) so the app can warn or
  refuse before measuring; the PWA also shows a live hold-flatter level.
- Crack lengths are tilt-corrected from the ellipse, capped at 1.7x; coins
  flatter than 0.5 aspect (60° tilt), covered, or misshapen are refused
  (confidence 0, report drops to percent-only with a `scale_rejected`
  receipt). Reference confidence is discounted by mask fill and stray-pixel
  share, and everything below `MIN_REFERENCE_CONFIDENCE` (default 0.6)
  stays percent-only.
- Every `scale_calibration` receipt carries the coplanar warning in its
  notes; a crack that leaves the frame is a visible-length lower bound.
- Residual perspective error from an off-plane coin is unquantified - that
  is the open gap, not a hidden ±. Re-shoot flatter when `referenceCheck`
  shows tilt.

### Skeptic DISPUTED calls

The skeptic returns free text, so a finding's verdict is read from it by `bench/archive.ts`: a draft citing the finding's receipts and saying DISPUTED disputes it, a draft that only restates it confirms it, and a finding never cited gets no verdict and counts as missing.

Scored by `scoreDisputes` in `bench/score.ts`, with DISPUTED as the positive class.

What the skeptic actually checks: prose from receipts, not segmentation. The
held-out bench makes this explicit - on the 4 no-scale photos only the tile
mask was on the crack; the other three masks covered the host wall, and the
skeptic flagged neither miss, because the sentences matched the (wrong) numbers
faithfully. A wrong SAM mask fools both the writer and the skeptic. Say it
plainly: the skeptic catches invented numbers, not bad outlines.

What "independent" means here, exactly: the skeptic model (Spark Open on
Baseten) is independent of the writer (Muse Spark) - different weights,
different vendor path - but it is NOT independent of the segmenter. Both
read the same masks and the same receipts, so a wrong SAM mask fools both.
What the skeptic re-derives is the *sentences* from the receipts; what
re-measures the *numbers* is server-side code (`crossCheckMeasurement` in
`backend/app.ts`: `/v1/findings` and `/v1/skeptic` recompute
`measureSession` from component + masks and reject smuggled receipts before
any model call). Mask-level independence is the separate `/v1/crosscheck`
IoU check (SlimSAM vs SAM) plus pixel-verified provenance - for a stronger
check, re-segment the same frame with different prompts or thresholds and
re-run crosscheck before trusting millimetres. A DISPUTED verdict alone
says nothing about where; the Check screen shows which finding and which
receipts. Both checks auto-run on the PWA/React Check screen and both must
resolve before the Report unlocks - cross-check is default flow and demo, not
an optional tap. The live `terrace-slab-tape-01` demo shows skeptic + crosscheck
red-to-green on the real fixture.

## Results

| Date | Bench | Disputes | Notes |
|---|---|---|---|
| 2026-10-28 | 2 pass, 0 skip, 0 fail | scorer unit-tested, no live runs yet | wall-crack: 5.17% / 85.9 mm / 2.6 mm wide / 2.19 cm² (significant); stain: 1.29% percent-only (moderate) |
| 2026-10-30 | 7 pass, 0 skip, 0 fail | dev fixtures grown (door-peel, facade-crack, tilted-wall, noscale); held-out still 0 archived runs (UNRUN ×4, strict exit 1) | tilted-wall: 0.27% / 66.8 mm cosmetic; facade-crack: 0.74% percent-only significant |
| 2026-11-02 | 7 pass, 0 skip, 0 fail; gap first row scored, both arms | `terrace-slab-tape-01`: chord 227 mm vs measured 218.5 mm (-3.7%, in on chord) vs pin path 274 mm (-20.3%, out - reads low) vs Spark photo-alone 315 mm (+15.0% vs pin, out) | builder-measured slab DSC_0711.JPG, Ref SC-25D35C5E (second run SC-D8ECE64B 232 mm labeled separately) |

## Failures and misses

- Held-out photos have masks/expected files but no photo bytes in the repo
  (`fixtures/photos/` gitignored) - they document the protocol, not results.
- Live SAM 3.1 segment verified on one photo 2026-10-29 (`200`, full-frame RLE, $0.0025).
- Live skeptic verified 2026-10-29 on the hackathon model `meta-models/muse-spark-open-1026`.
- n=1 on the gap table: the only tape ground truth is `terrace-slab-tape-01`.
  No cherry-picking - it is the only scaled held-out case, and it stays in
  the table whether the numbers flatter us or not. Against the pin path it
  reads low (-20.3%); that row stays red.
- Replay is not tamper-evidence: `npm run replay` re-runs the math and prints
  MATCH/DRIFT plus a SHA-256 receipt-chain hash (`src/receipts/hash.ts`), but
  anyone can edit the receipts and replay them consistently, and the photo
  never reaches the server. Real tamper-evidence would need the photo hashed
  client-side at capture (before EXIF stripping) and pinned in the receipts,
  plus a signature at capture (share links already carry an optional HMAC;
  absent `sig` = UNVERIFIED). Not shipped - claimed as replayable only.

## Datasets and licenses

The four held-out photos above are the only external data so far. Photo files stay local; source URLs are in `bench/split.json`.

Seven team photos (Parithosh, DSLR, 2026-10-29, a 2 INR coin in the crack's plane) joined the held-out set on 2026-10-30 as `team-coin-*`: two with no crack, three full-frame cracks, two cracks that leave the frame. They are team-internal and not redistributed. None has a measured crack length yet, so they test detection and refusal behaviour; accuracy on them stays UNSCORED until someone puts a tape on the wall.

License confirmation (all checked against the source page; photo bytes not
redistributed, attribution kept in `bench/split.json`):

| Case | Source | License | Redistribution |
| --- | --- | --- | --- |
| public-ruin-wall-crack-01 | Wikimedia Commons, A.-K. D. | CC BY-SA 4.0 | No - photo bytes gitignored, URL + author + license recorded |
| public-stone-wall-crack-02 | Wikimedia Commons (geograph), David Smith | CC BY-SA 2.0 | No - same |
| public-interior-wall-cracks-03 | Wikimedia Commons, Nolan Issac | CC0 | No - same |
| public-cracked-tile-04 | Wikimedia Commons, Mk2010 | CC BY-SA 4.0 | No - same |
| team-coin-* / terrace-slab-tape-01 | Team-internal photos | Team-internal, not redistributed | No - local only |

Runtime dependency licenses: the only non-Apache-2.0 runtime dependency is
`@meta-sam/parser` under the Meta SAM License (see `THIRD-PARTY-NOTICES.md`).
No public damage dataset is bundled or redistributed by this repo.
