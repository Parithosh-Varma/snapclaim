# SnapClaim API — headless usage

SnapClaim is a measurement pipeline, not a screen. Everything the app does is a
plain JSON POST, and `POST /v1/claim` runs the whole pipeline in one call:
segmentation → pixel statistics → calibrated measurement → gated findings →
SVG annexure.

No UI, no browser, no canvas. Any script that can `fetch` can use it.

```
photo (+ coin for scale) + one spoken line
        ↓
MASKS      SAM 3.1 point prompts (live), or your own COCO RLE masks
        ↓
MATH       deterministic: % damaged, crack length/width (mm), area (cm2)
        ↓
RECEIPTS   every number carries its formula, inputs, confidence and id
        ↓
FINDINGS   the evidence gate refuses uncited numbers (HTTP 422)
        ↓
ANNEXURE   code-drawn SVG: outlines, findings, receipts table
```

Two rules hold in every route, one-call or low-level:

1. **No model touches the numbers.** Models write sentences; arithmetic is code.
2. **Fail closed.** No key → `503`. No evidence → `422`. No masks → the server
   never makes one up.

## Contents

- [Quickstart](#quickstart)
- [One-call: `POST /v1/claim`](#one-call-post-v1claim)
- [Photo path: taps, coin, cost](#photo-path-taps-coin-cost)
- [Mask path: your own polygons](#mask-path-your-own-polygons)
- [Response shape](#response-shape)
- [CLI](#cli)
- [Fine control: the low-level routes](#fine-control-the-low-level-routes)
- [Replay](#replay)
- [Node / TypeScript client](#node--typescript-client)
- [Limits, errors, auth](#limits-errors-auth)
- [Configuration](#configuration)

## Quickstart

```bash
npm install
npm run backend:start        # http://127.0.0.1:8787, mock mode, $0, no keys
```

A complete claim from masks — copy-paste runnable:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/claim \
  -H 'content-type: application/json' \
  -d '{
    "masks": [
      { "id": "damage-1", "label": "crack", "confidence": 0.9,
        "rle": { "size": [10, 10], "counts": [0, 5, 95] } }
    ],
    "transcript": "crack on the wall panel"
  }'
```

```json
{
  "ok": true,
  "requestId": "…",
  "durationMs": 1,
  "result": {
    "claimId": "…",
    "measurement": {
      "findings": [{ "maskId": "damage-1", "label": "crack", "percent": 5, "severity": "moderate", "…": "…" }],
      "receipts": [{ "id": "R001", "output": { "value": 5, "unit": "%" }, "formula": "…" }],
      "mode": "percent-only",
      "provenance": "pixel-verified"
    },
    "findings": [{ "statement": "crack covers 5% of the component; classified moderate.", "citations": ["R001", "R002", "R003"] }],
    "gate": { "ok": true },
    "overlay": { "width": 10, "height": 10, "masks": [{ "id": "damage-1", "label": "crack", "path": "M … Z" }] },
    "svg": "<svg …",
    "replay": { "request": { "…": "…" }, "measurement": { "…": "…" } }
  }
}
```

`rle.size` is `[height, width]`, runs are **column-major and start with zeros**
— standard COCO RLE. `[0, 5, 95]` on a 10×10 frame is the top 5 pixels of the
first column.

## One-call: `POST /v1/claim`

One request in, one evidence package out. Send exactly **one** of the two input
shapes:

| Field | Type | Meaning |
|---|---|---|
| `masks` | `[{id, label, rle, confidence}]` | COCO RLE damage masks (mask path) |
| `component` | `{id?, rle?, confidence?}` | Surface the damage is measured against; default = the whole frame |
| `reference` | `{id?, rle, knownMm, confidence}` | Scale reference outline (coin); omit for percent-only |
| `imageUrl` | `string` | `https://…` or `data:image/png\|jpeg\|webp;base64,…` (photo path) |
| `width`, `height` | `number` | Photo pixel size (must match the image) |
| `damage` | `[{x, y, label, confidence?}]` | Tap prompts, 1–16; `label` is `crack\|stain\|peel\|dent` |
| `coin` | `{x, y, knownMm}` | Coin tap + its real diameter; omit for percent-only |
| `transcript` | `string` | The one spoken line (≤ 2000 chars) |
| `thresholds` | `object` | Severity overrides, same as `/v1/report` |
| `minReferenceConfidence` | `number` | Raises (never lowers) the server floor |
| `photoHref` | `string` | `data:image/png\|jpeg;base64,…` to embed in the annexure |
| `render` | `boolean` | Return `svg`; default `true` |

The mask path is keyless and works in mock mode. The photo path is live-only
(see below).

## Photo path: taps, coin, cost

```bash
curl -s -X POST https://snapclaim-backend.parithosh.workers.dev/v1/claim \
  -H 'content-type: application/json' \
  -H "x-meta-key: $META_API_KEY" \
  -d '{
    "imageUrl": "https://example.com/wall.jpg",
    "width": 1024, "height": 768,
    "damage": [
      { "x": 410, "y": 300, "label": "crack" },
      { "x": 520, "y": 340, "label": "crack" }
    ],
    "coin": { "x": 830, "y": 610, "knownMm": 24.26 },
    "transcript": "crack above the window, coin on the sill"
  }'
```

What the server does:

1. **One SAM 3.1 call for every damage tap.** Records come back decoded by the
   official parser. A record covering more than half the frame ("SAM caught the
   wall") is dropped; a tap with no surviving record is a `422`, never an empty
   finding.
2. **Attribution by pixel, not by order.** Each record is assigned to the first
   tap inside it; records sharing a label are unioned, so tapping one crack
   twice yields one finding.
3. **One more SAM call for the coin**, only when `coin` is present. The most
   disc-like coin-sized candidate containing the tap is used; `/v1/observe`
   then refuses a non-coin outline and degrades to percent-only instead of
   inventing millimetres.

Cost: one billed image per group of taps plus one for the coin ≈ **$0.0025
each** at current pricing. Mock mode refuses this path with `422` — the backend
invents no masks. Use the mask path there, or run the backend live:

```bash
MOCK_MODE=0 META_API_KEY=… npm run backend:start
```

Bodies are capped at 1 MB on Node and on the Worker, so host large photos and
pass a URL, or downscale first (the app uses 512 px for a reason).

## Mask path: your own polygons

Already have masks? Send COCO RLE and skip the model entirely. This is the path
for stored analyses, offline runs, tests, and payouts that need
`REQUIRE_PIXEL_PROVENANCE=1` (claims are pixel-verified because the RLE is
re-bound and re-checked server-side).

Get RLE from where you already have masks, from a previous
`POST /v1/segment` (`result.records[].rle`), or from any COCO exporter.

RLE rules, enforced before allocation:

- `size` is `[height, width]`, both ≤ 4096 and ≤ 16.7 M pixels per mask.
- runs are integers, column-major, first run counts background.
- ≤ 50 masks per request, ≤ 64 M decoded pixels total.

Labels are fixed: `crack`, `stain`, `peel`, `dent`. A reference must carry a
real `knownMm` ≤ 1000. Without a reference the report is honestly
`percent-only`: `%`, `mm` and `cm2` are never guessed.

## Response shape

```jsonc
{
  "ok": true,
  "requestId": "…",          // also the claimId
  "durationMs": 123,
  "result": {
    "claimId": "…",
    "measurement": {          // deterministic, replayable
      "findings": [{ "maskId": "…", "label": "crack", "percent": 5.17,
        "crackLengthMm": 85.9, "areaCm2": 2.19, "crackWidthMm": 2.6,
        "severity": "significant", "receiptIds": { "…": "R001" } }],
      "receipts": [{ "id": "R001", "method": "area_ratio",
        "output": { "value": 5.17, "unit": "percent" },
        "formula": "area / componentArea", "inputs": { "…": "…" }, "confidence": 0.9, "notes": [] }],
      "mode": "absolute | percent-only",
      "provenance": "pixel-verified | self-reported",
      "verdict": "damage | no-damage"
    },
    "findings": [{ "statement": "…", "citations": ["R001"] }],  // gated sentences
    "gate": { "ok": true },
    "overlay": {              // photo panel: source-pixel SVG paths
      "width": 1024, "height": 768,
      "masks": [{ "id": "damage-1", "label": "crack", "path": "M … Z" }]
    },
    "referenceCheck": { "aspect": 1, "fill": 0.98, "tiltDeg": 0, "edgeError": 0.01,
      "majorPx": 80, "minorPx": 80, "cx": 90, "cy": 90, "axisDeg": 0 },
    "segmentation": { "records": 2, "dropped": 1, "taps": 1,
      "frame": { "width": 60, "height": 27 }, "archivedImageUrl": null },
    "svg": "<svg …>",
    "replay": { "request": {…}, "measurement": {…} }
  }
}
```

`svg`, `segmentation` and `referenceCheck` are present only when they apply.
The SVG is a string in JSON; write it to a `.svg` file if you want a document.

A claim that measures to `verdict: "no-damage"` — a clean wall, or a tap that
caught something blocky or ruler-straight rather than a crack — answers
deterministically with cited refutation receipts. No findings model is called,
so it costs `$0` even on a live backend, and the gate still has to accept it.

## CLI

The same API from a shell — no interface, no glue code:

```bash
npm run cli -- health
npm run cli -- claim --image damage.jpg --tap 420,310,crack \
  --coin 900,700,24.26 --say "crack above the window" \
  --out report.json --svg annexure.svg
```

```
claim 4f2… · absolute · pixel-verified · 1 finding · gate ok
  crack: 5.17% · 85.9 mm · 2.19 cm2 · significant
  "crack above the window covers 5.17% of the component; measures 85.9 mm…"
saved report.json and annexure.svg
```

- JSON goes to stdout (or `--out`); the summary goes to stderr, so pipes stay clean.
- `--image` reads PNG/JPEG/WebP, detects the pixel size, and builds the data URL.
- `--request report.json` sends a full body (mask path, replay tests).
- `--say-audio note.wav` transcribes first via `/v1/transcribe` (10 s, ≤ 4 MB, live only).
- `--dry-run` prints the body without sending anything.
- `--meta-key` / `META_API_KEY`, `--baseten-key` / `BASETEN_API_KEY`,
  `--bearer` for `REQUIRE_BILLING_AUTH`.
- `--backend` or `SNAPCLAIM_BACKEND` to point at a deployed Worker.

Run `npm run cli -- help` for the full flag list.

## Fine control: the low-level routes

`/v1/claim` is a composition of these; call them directly when you want an
intermediate result (e.g. show outlines before asking for a report, or cache
the measurement and re-gate later).

| Step | Route | Keyless | What it does |
|---|---|---|---|
| 1 | `POST /v1/segment` | live only | Photo + 1–16 points → `{records: [{objectId, box, confidence, rle}]}`. Mock requires `fixture`; never invents masks. |
| 2 | `POST /v1/observe` | yes | RLE masks → pixel statistics, outlines, coin ellipse fit, `scaleReference` |
| 3 | `POST /v1/measure` | yes | Statistics → findings + receipts (the deterministic engine) |
| 4 | `POST /v1/report` | live for sentences | Inputs + `transcript` → `{measurement, findings, gate}` |
| 5 | `POST /v1/skeptic` | live | Independent re-check by Spark Open; unreproducible findings print `DISPUTED` |
| 6 | `POST /v1/render` | live for sentences | Gated report → `{svg, gate}` (re-runs the gate) |
| 7 | `POST /v1/crosscheck` | yes | Two RLE masks of one frame → IoU/Dice + `AGREED`/`DISPUTED` |
| 8 | `POST /v1/transcribe` | live only | Audio (base64 mono WAV ≤ 4 MB) → transcript |
| 9 | `POST /v1/describe` | live only | Photo → one descriptive line, for filling the transcript box |
| — | `GET /v1/health` | yes | `{version, time, mode: mock\|live\|config-error}` |
| — | `GET /v1/spend` | yes | `{spentUsd, remainingUsd, limitUsd, entries}` |
| — | `POST/GET /v1/sessions` | yes | Save/list session counts (never photo bytes) |
| — | `GET /v1/admin/status` | yes | Mode + its source, spend, model/endpoint names, switching flag (never keys) |
| — | `POST /v1/admin/mode` | admin Bearer | `{mode: "live"}` / `{"mode": "mock"}` flips the running process until restart |

Example: measure without sentences, then gate later.

```bash
# 2+3: pixels → numbers, no model, no key
curl -s -X POST localhost:8787/v1/observe -H 'content-type: application/json' \
  -d '{"masks":[{"id":"damage-1","label":"crack","confidence":0.9,"rle":{"size":[10,10],"counts":[0,5,95]}}]}' > observed.json

curl -s -X POST localhost:8787/v1/measure -H 'content-type: application/json' \
  -d @observed.json
```

Every reply is enveloped `{ok, requestId, durationMs, result}`; errors are
`{ok: false, error, code, requestId, details?}`.

`/v1/findings` and `/v1/skeptic` require `component` + `masks` alongside
`findings` + `receipts`: the server re-measures and rejects smuggled receipts
with `422`. There is no opt-out; use `/v1/report` or `/v1/claim` if you do not
want to carry receipts.

## Replay

The claim reply carries the exact replay pair:

```bash
npm run cli -- claim --request claim.json --out report.json
node -e '
  const j = require("./report.json");
  require("fs").writeFileSync("request.json", JSON.stringify(j.result.replay.request));
  require("fs").writeFileSync("measurement.json", JSON.stringify(j.result.replay.measurement));
'
npm run replay -- request.json measurement.json
# replay: 1 findings, 11 receipts, mode absolute, MATCH
```

`DRIFT` (exit 1) means the stored numbers no longer reproduce from the stored
inputs — the point of receipts.

## Node / TypeScript client

```ts
const BASE = process.env.SNAPCLAIM_BACKEND ?? "http://127.0.0.1:8787";

async function claim(photo: { dataUrl: string; width: number; height: number }, taps: { x: number; y: number; label: string }[]) {
  const res = await fetch(`${BASE}/v1/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.META_API_KEY ? { "x-meta-key": process.env.META_API_KEY } : {}) },
    body: JSON.stringify({ imageUrl: photo.dataUrl, width: photo.width, height: photo.height, damage: taps, transcript: "…" }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(`${json.error} (HTTP ${res.status})`);
  return json.result; // {measurement, findings, gate, overlay, svg, replay, …}
}
```

`x-meta-key` / `x-baseten-key` are bring-your-own-key headers: the operator pays
nothing, the key is used for that request only and never stored or logged.

## Limits, errors, auth

| Code | Meaning |
|---|---|
| `400` | Bad input (shape, range, RLE, tap outside the frame) |
| `401` / `403` | `REQUIRE_BILLING_AUTH=1` and a missing/wrong bearer token |
| `422` | Evidence gate rejected the sentences, pixel provenance required, no mask under a tap, or findings don't match recomputation |
| `429` | Rate limit, or the spend guard is at `$0` |
| `502` | Upstream model unreachable/timeout/empty output |
| `503` | Live mode without the required key |

Hard limits: 1 MB JSON body, 50 masks per call, 16 taps per claim, 4 MB audio,
4096 px per mask side, 64 M decoded mask pixels per request. Rate limits are
per IP per route tier: 20/min for billable routes (`/v1/claim`, `/v1/report`,
`/v1/segment`, `/v1/transcribe`, `/v1/describe`, `/v1/findings`,
`/v1/skeptic`, `/v1/render`), 120/min for deterministic ones.

Billing lockdown:

```bash
REQUIRE_BILLING_AUTH=1 ADMIN_TOKEN=<≥16 chars> npm run backend:start
curl -H "authorization: Bearer $ADMIN_TOKEN" …
```

### BYOK (bring your own key)

Send `x-meta-key` and/or `x-baseten-key` (CLI: `--meta-key` / `--baseten-key`,
or `META_API_KEY` / `BASETEN_API_KEY` in the environment) and that request runs
on your credits:

- the key replaces the worker secret **for that request only** — for
  `/v1/claim` that covers both the SAM image calls and the findings model;
- no operator spend hold, no spend-guard entry, nothing stored or logged;
- works on a backend with **no** `META_API_KEY` secret at all, which is what
  makes a shared demo link safe to hand out.

BYOK changes *who pays*, not the backend's *mode*: a backend started in mock
mode still refuses photo segmentation (`422`) because the backend invents no
masks — run it with `MOCK_MODE=0`, or send `masks[]`, which needs no key at all.
Keys are capped at 512 chars and rejected with `400` before any call.

CORS: mock mode allows `*`; live mode denies browsers unless `ALLOWED_ORIGINS`
matches. Server-to-server calls (curl, scripts) are unaffected.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `MOCK_MODE` | unset (= mock) | `0` enables live model calls; live routes fail closed without keys |
| `META_API_KEY` | — | SAM 3.1 (segment/claim), Muse Spark (findings), Muse Voice (transcribe) |
| `BASETEN_API_KEY` | — | Spark Open skeptic |
| `META_API_BASE` | `https://api.meta.ai/v1` | Upstream override |
| `SPEND_GUARD_USD` | `5` | Hard cap; `429` at `$0` remaining |
| `MIN_REFERENCE_CONFIDENCE` | `0.6` | Below this the report stays percent-only |
| `REQUIRE_PIXEL_PROVENANCE` | off | `1` rejects absolute claims not bound to RLE pixels |
| `ALLOWED_ORIGINS` | — | Comma-separated browser origins |
| `ADMIN_TOKEN` | — | Enables `POST /v1/admin/mode` and billing auth |
| `PORT` | `8787` | Node server port |

Full route table and deploy steps: [`../backend/README.md`](../backend/README.md).
