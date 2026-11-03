# Eval report

Updated 2026-11-03. Weak rows stay in; nothing is buried.

## Setup

Two scripts, both deterministic and free to run. `npm run eval` measures the dev mask fixtures against stored expected values (these are regression baselines taken from the pipeline's own output, not independent hand measurements; `npm run bench:truth` is the check against known answers). `npm run bench` reads one archived live run per held-out case from `bench/runs/` and checks it (see `eval/README.md`). A case with no archived run prints UNRUN and fails the strict command, so a missing run cannot pass as a clean one. Every archived run carries the git SHA, model, prompt version and timestamp it came from. `npm run replay -- request.json measurement.json` reproduces findings + receipts + mode byte-for-byte (see `tests/replay.test.ts`).

## Data and split

Cases and their split live in `bench/split.json`. The held-out split is frozen before any tuning (`frozenAt` 2026-10-28 18:05 +03:00), and a test hashes every held-out case so editing one after the freeze fails `npm test`.

Dev: one synthetic wall-crack fixture with a coin scale reference.

Held-out: 12 cases. Four public photos with no scale reference in the crack's plane test whether the pipeline refuses to invent millimetres. Seven team photos with a coin joined on 2026-10-30 (see below); none has a tape measurement yet, so they test detection/refusals. One scaled accuracy case exists (`terrace-slab-tape-01`: Rs 2 coin in frame, thread path 238.8 mm ±4 + tape span 227 mm [225–230], n = 1, coin 25 mm nominal); the 10–20-case set is still missing.

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
held-out separately. The demo table goes in the README when the photos land.

Held-out side is scored by `npm run bench:gap` (`bench/gap.ts`): for every scaled held-out case with a `groundTruth` it compares the archived pipeline run and a model-only guess from `bench/model-only/` against the thread path (`pathMm`), and prints the straight-span comparison labelled (`span=…(span) spanErr=…`) but never scores it. Refusals and missing files are counted per arm, not dropped. The dev side still comes from `npm run eval` and is not wired into the same table yet. `terrace-slab-tape-01` is archived in `bench/runs/` + `bench/model-only/` — `npm run bench:gap` exit 0.

### Skeptic DISPUTED calls

The skeptic returns free text, so a finding's verdict is read from it by `bench/archive.ts`: a draft citing the finding's receipts and saying DISPUTED disputes it, a draft that only restates it confirms it, and a finding never cited gets no verdict and counts as missing.

Scored by `scoreDisputes` in `bench/score.ts`, with DISPUTED as the positive class.

## Results

| Date | Bench | Disputes | Notes |
|---|---|---|---|
| 2026-10-28 | 2 pass, 0 skip, 0 fail | scorer unit-tested, no live runs yet | wall-crack: 5.17% / 85.9 mm / 2.6 mm wide (unverified — no width ground truth) / 2.19 cm² (significant); stain: 1.29% percent-only (moderate) |
| 2026-10-30 | 7 pass, 0 skip, 0 fail | dev fixtures grown (door-peel, facade-crack, tilted-wall, noscale); held-out still 0 archived runs (UNRUN ×4, strict exit 1) | tilted-wall: 0.27% / 66.8 mm cosmetic; facade-crack: 0.74% percent-only significant |
| 2026-11-02 | held-out: 4 public runs archived, 4/4 refused millimetres; 7 team cases UNRUN (strict exit 1) | skeptic recall 0 on 2 DISPUTED (post-freeze labels in `bench/audit/heldout-masks.json`), see below | first live held-out runs, deployed worker at 4f96974: SAM 3.1 point prompts, muse-spark-1.3 findings, muse-spark-open-1026 skeptic |
| 2026-11-02 | 7 pass, 0 skip, 0 fail; gap INCOMPLETE (no runs yet) | — | `terrace-slab-tape-01`: builder slab DSC_0711.JPG, Ref SC-25D35C5E with wrong 23 mm coin read R005 218.5 mm (superseded — see 2026-11-03) |
| 2026-11-03 | 7 pass, 0 skip, 0 fail; gap exit 0, both arms scored | — | `terrace-slab-tape-01`, n = 1: archived run R005 237.5 mm (25 mm nominal, engine recompute R001 0.773994, R004 7.69 cm²) vs thread 238.8 mm ±4 (err 1.3, 0.5%, in) vs Spark photo-alone 315 mm (err 76.2, 31.9%, out); span 227 mm [225–230] printed, span err 10.5 mm / 4.6%, never scored; width 3.2 mm unverified; sensitivity at ruler 24 mm: R005 228.0 mm / R006 3.1 mm / R004 7.09 cm². Run + guess in `bench/runs/` + `bench/model-only/`. No new live calls (run is deterministic recompute; guess reuses 2026-11-02 Spark 315 mm). |

## Failures and misses

- Held-out photos have masks/expected files but no photo bytes in the repo
  (`fixtures/photos/` gitignored) - they document the protocol, not results.
- Live SAM 3.1 segment verified on one photo 2026-10-29 (`200`, full-frame RLE, $0.0025).
- Live skeptic verified 2026-10-29 on the hackathon model `meta-models/muse-spark-open-1026`.
- 2026-11-02 live held-out runs: refusal held on all four public photos (percent-only, no mm receipt). But the bench's "crack found" only means "a finding exists". Looking at the masks, two of the four are on the crack (ruin wall, ceiling) and two are not: on `public-stone-wall-crack-02` SAM returned the whole curved wall plus the sign (27.01%), and on `public-cracked-tile-04` it returned one broken tile piece (3.81%). The skeptic CONFIRMED all four, so it caught neither wrong mask. Those hand labels live in `bench/audit/heldout-masks.json` (dated, with who labeled each one), not in `split.json`, so the frozen case hashes stay the same. `npm run bench` scores them: `tp=0 fn=2 tn=2`, recall 0. Neither bad mask was caught by the PWA's wall-size filter, which only drops masks over 50% of the frame.

## Datasets and licenses

The four held-out photos above are the public external set. Photo files stay local; source URLs are in `bench/split.json`. The scaled case `terrace-slab-tape-01` (team-internal slab DSC_0711.JPG, coin in frame, thread 238.8 mm ±4 + span 227 mm [225–230], n = 1) is the first tape ground truth; its photo stays local (gitignored).

Seven team photos (Parithosh, DSLR, 2026-10-29, a 2 INR coin in the crack's plane) joined the held-out set on 2026-10-30 as `team-coin-*`: two with no crack, three full-frame cracks, two cracks that leave the frame. They are team-internal and not redistributed. None has a measured crack length yet, so they test detection and refusal behaviour; accuracy on them stays UNSCORED until the wall is measured.

Every public dataset used here gets its name, license and exact split listed.
