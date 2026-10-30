# Eval bench (for Constantine)

Deterministic, $0, no models. Measures the guessed-vs-measured gap.

## Run

```bash
npm run eval
```

## Add a dataset

1. Drop masks JSON in `fixtures/masks/<name>.json` (same shape as `wall-crack.json`).
2. Drop expected values in `fixtures/expected/<name>.json`:
   ```json
   {
     "cases": [{ "maskId": "crack-1", "percent": 5.17, "crackLengthMm": 85.9, "severity": "significant" }],
     "tolerance": { "percent": 0.005, "crackLengthMm": 0.051 }
   }
   ```
3. Run `npm run eval`. Missing expected file = SKIP, never fail.

## Held-out bench

```bash
npm run bench                 # strict
npm run bench -- --allow-unrun   # local only: unrun cases don't fail the command
```

Reads one archived run per case from `bench/runs/<case>.json` (shape and provenance: `CaseRun` in `bench/run.ts`, checked by `validateRun`). `bench/runs/` is empty until a live run is archived. `npm run bench:archive -- <caseId> <input.json>` turns a pipeline result (`provenance`, `measurement`, optional `skeptic` drafts from /v1/skeptic) into that file; it refuses to overwrite an existing run. Skeptic verdicts come from the drafts: a draft citing a finding's receipts and saying DISPUTED disputes it, one that only restates it confirms it, a finding never cited gets no verdict.

Exit codes: 0 clean, 1 failed or incomplete (invented millimetres, a run with no findings, an unrun case, an unknown or duplicate caseId), 2 the split has no `frozenAt` or a run file is unreadable. Scaled cases print `SKIP` until accuracy scoring exists.

`frozenAt` is set once the split is final; a test hashes every held-out case, so editing one after the freeze fails `npm test`.

## Gap bench (model-only vs measured)

```bash
npm run bench:gap
```

Scores the two arms of the accuracy claim against the same tape measurement. The pipeline arm is the archived run in `bench/runs/<case>.json`, taking the finding whose `maskId` matches the case's `groundTruth.maskId`. The model-only arm is one file per case in `bench/model-only/<case>.json`: `{ caseId, provenance, crackLengthMm }`, where `crackLengthMm` is the single number Muse Spark gives when shown the photo with no measurement tools, or `null` when it declines to guess. A refusal is listed, not scored, so an arm cannot improve its numbers by answering only the easy photos.

Only held-out cases with `hasScaleReference: true` and a `groundTruth` are scored; until one exists the command prints `UNSCORED` and exits 0. Per arm it prints the number of scored cases, the median absolute error in mm and the share within ±10%. Exit codes: 0 scored (or nothing to score), 1 a scored case has no run or no guess, 2 a run or guess file is unreadable.

Ground truth is added to a case in `bench/split.json` as `groundTruth: { maskId, crackLengthMm }`. Adding it to a frozen case changes its hash, so it goes in together with the case or the freeze test is updated on purpose in the same PR.
