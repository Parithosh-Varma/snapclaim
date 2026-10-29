# SnapClaim backend

Zero-dependency TypeScript. Same router (`app.ts:handleRequest`) runs on Node and Cloudflare Workers.

## Run

```bash
npm install
npm test         # 105 tests, mock mode, $0 spend
npm run typecheck
npm run eval       # deterministic bench
npm run replay -- request.json measurement.json
```

## Routes

| Route | Mode | What it does |
|---|---|---|
| `GET /v1/health` | any | `{ok, version, time, mode}` |
| `POST /v1/measure` | any | Deterministic math only: masks in, findings + receipts out. No model, no keys. |
| `POST /v1/observe` | any | Pixel masks (COCO RLE) → component/masks/scaleReference that `/v1/report` takes. No model, no keys. |
| `POST /v1/report` | mock default | measure → findings draft → Evidence Gate. Uncited numbers return `422` with `details[]`. Client may pass `drafts[]` to test the gate. |
| `POST /v1/segment` | mock/live | Mock requires `body.fixture {component, masks}` — the backend invents no masks. Live calls SAM 3.1 point prompts (`imageUrl` + `width/height` + `points[1..16]`), parses the Responses output text and decodes masks with `@meta-sam/parser`; returns `{records: [{objectId, box, confidence, rle}]}`. Empty output throws, never fakes. |
| `POST /v1/crosscheck` | any | `{a, b}` COCO RLE masks of one frame, `threshold?` — IoU + Dice agreement with AGREED/DISPUTED verdict. Keyless, deterministic. |
| `POST /v1/transcribe` | mock/live | Spoken line to text via Muse Voice Transcribe (`/asr/transcribe`, multipart, `PUSH_TO_TALK`, Hindi/Telugu/English bias + claim keywords). Mock requires `body.fixtureTranscript`. Audio priced at $0.18/hr on the ledger. |
| `POST /v1/findings` | mock/live | Drafts findings from measured facts, then gates them. Live path records token usage to the spend ledger. |
| `POST /v1/skeptic` | mock/live | Independent re-check via Spark Open on Baseten, gated. Real per-token pricing charged to the ledger. `503` without `BASETEN_API_KEY`. |
| `POST /v1/render` | mock/live | Gated report → code-drawn SVG annexure `{svg, gate}`. |
| `GET /v1/spend` | any | `{spentUsd, remainingUsd, limitUsd, entries}`. Mock runs stay `$0`. |
| `POST /v1/collect` | any + D1 | Tester dataset donation (separate opt-in only, never bundled with Terms): `{consent: true, image, label?, coinMm?, transcript?}` → `{id, createdAt}`. Uses the `snapclaim_data` binding, else the `D1_PROXY_*` cross-account fallback. `503` when neither is configured. |
| `GET /v1/collect/count` | any + D1 | `{count}` donations stored. Same binding/fallback rule as collect. |
| `POST /v1/d1/query` | any + key | Generic relay to any D1 in any account: `{key, apiToken, accountId, databaseId, sql, params?}` → `{rows}`. Key must match the `D1_PROXY_KEY` secret (`503` unconfigured, `403` wrong key). |
| `POST /v1/r2/put` | any + key | Operator object store via bound `snapclaim_images` bucket or the cross-account R2 holder (`R2_PROXY_URL` + `R2_PROXY_KEY`): `{auth, key, contentType, dataBase64}` → `{key, size}`. Auth must match `R2_PROXY_KEY` (`503` unconfigured, `403` wrong key). |
| `POST /v1/r2/get` | any + key | Same guard/store as put: `{auth, key}` → `{key, contentType, dataBase64, size}`. `404` when missing. |

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

- SAM 3.1 masks: live and verified 2026-10-29 (`200`, 1 record + full-frame RLE on a 1024x1024 photo, `$0.0025` ledgered). Wire lesson: the official parser wants the mask payload WITH its `!`/`~` marker.
- Voice transcribe: proxy implemented and stub-tested; first live Hindi/Telugu clip pending a key + mic test.
- Skeptic inference: `403` until the Baseten form/access is granted. Code complete with real pricing.

## Deploy (Worker)

```bash
cd backend && npx wrangler deploy   # requires Cloudflare login; not run in CI
npx wrangler secret put META_API_KEY       # Muse Spark + SAM 3.1 + Voice
npx wrangler secret put BASETEN_API_KEY    # Spark Open skeptic (when access granted)
```

Optional guardrails: set `SPEND_GUARD_USD` (default 5) and `MIN_REFERENCE_CONFIDENCE`
(default 0.6) as Worker vars; restrict the PWA origin if you replace the
open-CORS default. Health badge flips `mock` → `live` when `MOCK_MODE=0` plus a key.

## Deploy (PWA)

Any static host serves `pwa/` (no build step). Point the Backend URL box at the
Worker (it defaults to the public mock Worker). Installable via
`manifest.webmanifest`; `sw.js` caches the shell, never `/v1`.
