# Eval report

Updated 2026-10-30. Weak rows stay in; nothing is buried.

## Setup

- Deterministic bench: `npm run eval` (CI, $0, no keys). Loads every
  `fixtures/masks/*.json`, runs `measureSession`, compares against
  `fixtures/expected/<same>.json` when present (SKIP otherwise, never a pass).
- Dispute scorer: `bench/score.ts` (`scoreDisputes`), DISPUTED as the positive
  class, missing labels counted as misses. Covered by `tests/bench-score.test.ts`.
- Replay: `npm run replay -- request.json measurement.json` reproduces
  findings + receipts + mode byte-for-byte (see `tests/replay.test.ts`).
- Live runs below hit the production Worker (`mode:live`, v0.3.0) with one
  SAM point-prompt per photo (~$0.0025 each). Taps are recorded as fractions
  of the frame so any reviewer can reproduce them exactly.

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
Not yet run (needs a vision-capable Spark call or manual equivalent).
Standing in for it: a **human blind-guess baseline** (see Oct-30 held-out run
below) — an eyeball area estimate made *before* measuring, same photos.

### (b) No-measurement photo report

"Looks moderately damaged" with no numbers. Reference point for the claim
that numbers change decisions; scored qualitatively, not hidden.

## Metrics

### Guessed vs measured gap

Absolute error in percentage points on uncalibrated photos (no mm ground
truth exists without a ruler); median absolute error in mm on calibrated
cases once ruler photos land, dev vs held-out separately. The demo table
goes in the README when the photos land.

### Skeptic DISPUTED calls

Scored by `scoreDisputes` in `bench/score.ts`, with DISPUTED as the positive class.

## Results

| Date | Bench | Disputes | Notes |
|---|---|---|---|
| 2026-10-28 | 2 pass, 0 skip, 0 fail | scorer unit-tested, no live runs yet | wall-crack: 5.17% / 85.9 mm / 2.6 mm wide / 2.19 cm² (significant); stain: 1.29% percent-only (moderate) |
| 2026-10-30 | 5 pass, 0 skip, 0 fail | scorer unit-tested | First real-photo run, held-out ×4 via live SAM (see below) |

## Held-out run, 2026-10-30 (first real photos through the live pipeline)

One SAM point-prompt per photo (tap recorded as frame fraction, image
downscaled to ≤768 px, base64 data URL). No scale reference anywhere, so the
only passing grade is **percent-only with no millimetres**.

| Case | Tap | Human blind guess (pre-registered) | Measured | Verdict |
|---|---|---|---|---|
| ruin-wall-crack | (0.50, 0.48) | ~2 %, moderate (low confidence — ambiguous target) | **50.42 %, significant, percent-only** | ⚠️ Mask is the wall face, not the crack. Tap returned the host surface. My guess described the crack; the pipe measured the wall. Not comparable — nails the failure mode, not the math. |
| garden-wall-crack | (0.38, 0.38) | ~0.3 %, moderate | **26.86 %, significant, percent-only** | ⚠️ Same failure: mask is the whole left wall. Percent-only refusal itself held (no mm invented). |
| interior-cracks | (0.60, 0.45) | ~0.1 %, moderate (but 3+ regions → would the rule say significant?) | **20.56 %, significant, percent-only** | ⚠️ Mask is the back wall, not the hairlines. Answered my own question the honest way: with a wall-sized mask the region-count logic never gets exercised. A proper multi-region case is still missing. |
| broken-tile | (0.52, 0.55) | ~7 %, significant (high confidence) | **1.12 %, moderate, percent-only** | ✅ Genuine guessed-vs-measured pair on a correct mask (the hole itself). I overestimated **6×**. Severity flipped my way too (significant → moderate). |

What this actually proves, stated plainly:

1. **The percent-only refusal works on real photos.** Four different scenes, zero millimetres invented anywhere, mode stayed `percent-only` throughout.
2. **Single-tap SAM prompts return host surfaces, not thin damage, 3 times out of 4.** The measurement math is faithful — the receipts let anyone recompute exactly what was measured — but faithful measurement of the wrong mask is still the wrong answer. This is precisely why the PWA does smallest-candidate selection, tap-to-assist narrowing, and the SAM-vs-SlimSAM cross-check: unguarded point prompts are not a measurement pipeline.
3. **Humans are bad at area.** On the one clean mask, my confident eyeball estimate was off 6× with the wrong severity band. That single row is the entire thesis in miniature.
4. **Infrastructure limit found, not hidden:** full-resolution masks (442K px) HTTP-503 the free Worker (`error 1102`, CPU cap) in `/v1/observe`. Halving once fixed held1; held3 needed quartering; held4 needed quartering *and* a non-crack label, because Zhang-Suen thinning a giant solid blob never finishes in budget. Shipping implication already in the app: the PWA caps intake at 512 px, and the backend should downscale oversized masks itself instead of dying — filed as follow-up work, not silently dropped.

## Failures and misses

- Held-out photos have masks/expected files but no photo bytes in the repo
  (`fixtures/photos/` gitignored). Real runs are documented above (2026-10-30)
  with tap coordinates so anyone can reproduce them from the Commons originals.
- Live SAM 3.1 decode was tested against real official-encoder payloads and
  stubbed SSE, and on 2026-10-30 against 5 live photos via the production
  Worker (see held-out run). Single taps return host surfaces for thin damage
  3/4 times — documented above, not hidden.
- Live skeptic inference was `403`-blocked until 2026-10-30; Baseten access is
  now granted and the gated skeptic path is verified live (it drafts, the gate
  vets — uncited numbers still 422).
- Worker CPU cap (`error 1102`) on large masks: reproduced 2026-10-30.
  Mitigation today is client-side downscale (PWA caps at 512 px); server-side
  downscale-before-measure is filed follow-up work.

## Datasets and licenses

Every public dataset used gets its name, license and exact split listed.
Current held-out sources (all Wikimedia Commons, see `bench/split.json`):
CC BY-SA 4.0, CC BY-SA 2.0, CC0 — authors recorded per case.
