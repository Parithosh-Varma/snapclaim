# SnapClaim backend

Zero-dependency TypeScript. Same router (`app.ts:handleRequest`) runs on Node and Cloudflare Workers.

## Run

```bash
npm install
npm test         # 184 tests, mock mode, $0 spend
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
| `POST /v1/segment` | mock/live | Mock requires `body.fixture {component, masks}` — the backend invents no masks. Live calls SAM 3.1 point prompts (`imageUrl` + `width/height` + `points[1..16]`), parses the Responses output text and decodes masks with `@meta-sam/parser`; returns `{records: [{objectId, box, confidence, rle}]}` with full-frame RLE, `$0.0025`/image metered. Empty output throws, never fakes. |
| `POST /v1/crosscheck` | any | `{a, b}` COCO RLE masks of one frame, `threshold?` — IoU + Dice agreement with AGREED/DISPUTED verdict. Keyless, deterministic. |
| `POST /v1/transcribe` | mock/live | Spoken line to text via Muse Voice Transcribe (`/asr/transcribe`, multipart, `PUSH_TO_TALK`, Hindi/Telugu/English bias + claim keywords). Mock requires `body.fixtureTranscript`. Audio priced at $0.18/hr on the ledger. |
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
- Stateless: replay comes from the request + receipts. `store.ts` defines the `Store` contract with `MemoryStore` (Node default) and `D1Store` (Worker `DB` binding).

## Live status (verified 2026-10-29)

- SAM 3.1 masks: live and verified 2026-10-29 (`200`, 1 record + full-frame RLE on a 1024x1024 photo, `$0.0025` ledgered). PWA tries `/v1/segment` first, on-device SlimSAM on any failure. Wire lesson: the official parser wants the mask payload WITH its `!`/`~` marker.
- Voice transcribe: endpoint verified live 2026-10-29 (`POST /v1/asr/transcribe`, multipart WAV, `200`, ~$0.0001). The `/v1/transcribe` proxy is implemented and stub-tested; the first Hindi/Telugu clip through the proxy is still pending.
- Skeptic inference: live and verified 2026-10-29 on `meta-models/muse-spark-open-1026` (`200`, ~$0.0001 ledgered).

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
