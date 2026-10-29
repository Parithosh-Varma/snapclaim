# Eval report

Nothing measured yet. Sections fill in as runs land; weak rows stay in.

## Setup

Two scripts, both deterministic and free to run. `npm run eval` measures the dev mask fixtures against hand-checked expected values. `npm run bench` reads one archived live run per held-out case from `bench/runs/` and checks it (see `eval/README.md`). A case with no archived run prints UNRUN and fails the strict command, so a missing run cannot pass as a clean one. Every archived run carries the git SHA, model, prompt version and timestamp it came from.

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

### (b) No-measurement photo report

## Metrics

### Guessed vs measured gap

### Skeptic DISPUTED calls

The skeptic returns free text, so a finding's verdict is read from it by `bench/archive.ts`: a draft citing the finding's receipts and saying DISPUTED disputes it, a draft that only restates it confirms it, and a finding never cited gets no verdict and counts as missing.

Scored by `scoreDisputes` in `bench/score.ts`, with DISPUTED as the positive class.

## Results

## Failures and misses

## Datasets and licenses

The four held-out photos above are the only external data so far. Photo files stay local; source URLs are in `bench/split.json`.

Every public dataset used here gets its name, license and exact split listed.
