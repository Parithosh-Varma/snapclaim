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
