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
