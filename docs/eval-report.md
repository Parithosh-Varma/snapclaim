# Eval report

Updated 2026-10-30. Weak rows stay in; nothing is buried.

## Setup

Two scripts, both deterministic and free to run. `npm run eval` measures the dev mask fixtures against hand-checked expected values. `npm run bench` reads one archived live run per held-out case from `bench/runs/` and checks it (see `eval/README.md`). A case with no archived run prints UNRUN and fails the strict command, so a missing run cannot pass as a clean one. Every archived run carries the git SHA, model, prompt version and timestamp it came from. `npm run replay -- request.json measurement.json` reproduces findings + receipts + mode byte-for-byte (see `tests/replay.test.ts`).

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
held-out separately. The demo table goes in the README when the photos land.

Held-out side is scored by `npm run bench:gap` (`bench/gap.ts`): for every scaled held-out case with a `groundTruth` it compares the archived pipeline run and a model-only guess from `bench/model-only/` against the same tape measurement, and prints both arms side by side. Refusals and missing files are counted per arm, not dropped. As of 2026-10-30 no held-out case has a scale reference and a ground truth, so the command prints UNSCORED; the coin photos need a tape measurement before a row can go here. The dev side still comes from `npm run eval` and is not wired into the same table yet.

### Skeptic DISPUTED calls

The skeptic returns free text, so a finding's verdict is read from it by `bench/archive.ts`: a draft citing the finding's receipts and saying DISPUTED disputes it, a draft that only restates it confirms it, and a finding never cited gets no verdict and counts as missing.

Scored by `scoreDisputes` in `bench/score.ts`, with DISPUTED as the positive class.

## Results

| Date | Bench | Disputes | Notes |
|---|---|---|---|
| 2026-10-28 | 2 pass, 0 skip, 0 fail | scorer unit-tested, no live runs yet | wall-crack: 5.17% / 85.9 mm / 2.6 mm wide / 2.19 cm² (significant); stain: 1.29% percent-only (moderate) |

## Failures and misses

- Held-out photos have masks/expected files but no photo bytes in the repo
  (`fixtures/photos/` gitignored) — they document the protocol, not results.
- Live SAM 3.1 segment verified on one photo 2026-10-29 (`200`, full-frame RLE, $0.0025).
- Live skeptic verified 2026-10-29 on the hackathon model `meta-models/muse-spark-open-1026`.

## Datasets and licenses

The four held-out photos above are the only external data so far. Photo files stay local; source URLs are in `bench/split.json`.

Every public dataset used here gets its name, license and exact split listed.
