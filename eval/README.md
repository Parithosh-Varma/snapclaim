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

Reads one archived run per case from `bench/runs/<case>.json` (shape and provenance: `CaseRun` in `bench/run.ts`, checked by `validateRun`). `bench/runs/` is not committed yet; the archive writer is still to do.

Exit codes: 0 clean, 1 failed or incomplete (invented millimetres, a run with no findings, an unrun case, an unknown or duplicate caseId), 2 the split has no `frozenAt` or a run file is unreadable. Scaled cases print `SKIP` until accuracy scoring exists.

`frozenAt` is set once the split is final; a test hashes every held-out case, so editing one after the freeze fails `npm test`.
