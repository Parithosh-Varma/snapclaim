# Eval report

Updated 2026-10-28. Weak rows stay in; nothing is buried.

## Setup

- Deterministic bench: `npm run eval` (CI, $0, no keys). Loads every
  `fixtures/masks/*.json`, runs `measureSession`, compares against
  `fixtures/expected/<same>.json` when present (SKIP otherwise, never a pass).
- Dispute scorer: `bench/score.ts` (`scoreDisputes`), DISPUTED as the positive
  class, missing labels counted as misses. Covered by `tests/bench-score.test.ts`.
- Replay: `npm run replay -- request.json measurement.json` reproduces
  findings + receipts + mode byte-for-byte (see `tests/replay.test.ts`).

## Data and split

Cases and their split live in `bench/split.json`, frozen 2026-10-28 (see `frozenAt`).
The dev case (`fixture-wall-crack-01`) is the regression baseline. The four
held-out cases are public CC photos **without** a scale reference: they test that
the pipeline refuses to invent millimetres. Photo files stay local in
`fixtures/photos/` (gitignored); source, author and license are recorded per case.
Calibrated-accuracy cases (coin + ruler in frame) are still to capture — that is
the current gap, stated plainly.

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

### Skeptic DISPUTED calls

Scored by `scoreDisputes` in `bench/score.ts`, with DISPUTED as the positive class.

## Results

| Date | Bench | Disputes | Notes |
|---|---|---|---|
| 2026-10-28 | 2 pass, 0 skip, 0 fail | scorer unit-tested, no live runs yet | wall-crack: 5.17% / 85.9 mm / 2.6 mm wide / 2.19 cm² (significant); stain: 1.29% percent-only (moderate) |

## Failures and misses

- Held-out photos have masks/expected files but no photo bytes in the repo
  (`fixtures/photos/` gitignored) — they document the protocol, not results.
- Live SAM 3.1 decode is tested against real official-encoder payloads and
  stubbed SSE, not yet against a live photo (needs `META_API_KEY`).
- Live skeptic inference is `403`-blocked (Baseten access pending); the text-only
  skeptic path is what ships until then.

## Datasets and licenses

Every public dataset used gets its name, license and exact split listed.
Current held-out sources (all Wikimedia Commons, see `bench/split.json`):
CC BY-SA 4.0, CC BY-SA 2.0, CC0 — authors recorded per case.
