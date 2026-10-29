# SnapClaim backend

Zero-dependency TypeScript. Same router (`app.ts:handleRequest`) runs on Node and Cloudflare Workers.

## Run

```bash
npm run backend:start   # Node, http://127.0.0.1:8787
npm run backend:smoke   # in a second terminal
npm test                # 40 tests, mock mode, $0 spend
```

## Routes

| Route | Mode | What it does |
|---|---|---|
| `GET /v1/health` | any | `{ok, version, time, mode}` |
| `POST /v1/measure` | any | Deterministic math only: masks in, findings + receipts out. No model, no keys. |
| `POST /v1/observe` | any | Pixel masks (COCO RLE) → component/masks/scaleReference that `/v1/report` takes. No model, no keys. |
| `POST /v1/report` | mock default | measure → findings draft → Evidence Gate. Uncited numbers return `422` with `details[]`. Client may pass `drafts[]` to test the gate. |
| `POST /v1/segment` | mock/live | Mock requires `body.fixture {component, masks}` — the backend invents no masks. Live takes `{imageUrl, width, height, points[1..16]}` and returns SAM 3.1 records with full-frame RLE, `$0.0025`/image metered. |
| `POST /v1/findings` | mock/live | Drafts findings from measured facts, then gates them. Live path records token usage to the spend ledger. |
| `POST /v1/skeptic` | mock/live | Independent re-check via Spark Open on Baseten, gated. Real per-token pricing charged to the ledger. `503` without `BASETEN_API_KEY`. |
| `POST /v1/render` | mock/live | Gated report → code-drawn SVG annexure `{svg, gate}`. |
| `GET /v1/spend` | any | `{spentUsd, remainingUsd, limitUsd, entries}`. Mock runs stay `$0`. |
| `POST /v1/sessions` / `GET /v1/sessions` | any | Save `{findings, mode, id?, at?}` (counts only, never photo bytes); list the latest 50, newest first. |

Sessions live in memory unless the Worker has a D1 binding named `DB`. To enable it: `wrangler d1 create snapclaim-sessions`, uncomment the `[[d1_databases]]` block in `wrangler.toml` with the returned id, then `wrangler d1 migrations apply snapclaim-sessions --local` (or `--remote`). The schema is `migrations/0001_sessions.sql`.

All replies are enveloped `{ok, requestId, durationMs, result}`; errors are verbose `{ok:false, error, code, requestId, details}`.

## Modes and keys

- `MOCK_MODE` unset or `1`: mock providers, zero spend, no keys needed. This is the default everywhere.
- `MOCK_MODE=0`: live routes fail closed — `503` without `META_API_KEY`. Measure still needs no key.
- Live findings call Muse Spark at `META_API_BASE/chat/completions`. Usage (`prompt_tokens`, `completion_tokens`) is recorded to the spend ledger via `backend/spend.ts`; `usd` stays `0` until Meta pricing is confirmed — no guessed rates. `$0 remaining` fails closed with `429` before any fetch.
- Keys live only in local `.env` / Worker secrets. Never commit them, never send them from the PWA.

## Limits

- 50 masks per measure call (chunk above that), 1 MB JSON body on Node, extra JSON fields ignored.
- Stateless: replay comes from the request + receipts. `store.ts` defines the `Store` contract; `D1StoreStub` throws until a real D1 binding is wired in Day 3+.

## Not yet (verified live, honestly blocked)

- SAM 3.1 masks: live and verified 2026-10-29 (`200`, 1 record + full-frame RLE on a 1024x1024 photo, `$0.0025` ledgered). PWA tries `/v1/segment` first, on-device SlimSAM on any failure. Wire lesson: the official parser wants the mask payload WITH its `!`/`~` marker.
- Voice transcribe: `muse-voice-transcribe-1.0` listed in `/v1/models` but `model_not_found` on `/chat/completions` and `/v1/responses`. Audio endpoint shape unresolved — text path is primary until then.
- Skeptic inference: `403` until the Baseten form/access is granted. Code complete with real pricing.

## Deploy (Worker)

```bash
cd backend && npx wrangler deploy   # requires Cloudflare login; not run in CI
```
