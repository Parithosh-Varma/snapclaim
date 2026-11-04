---
title: "SnapClaim — Full Project Audit"
subtitle: "Architecture, Code Quality, Security, Testing & Recommendations"
author: "OpenCode Audit"
date: "2026-11-04"
titlepage: true
titlepage-color: "374151"
titlepage-text-color: "ffffff"
book: true
---

# Executive Summary

SnapClaim ("Computed, not generated") is a damage-documentation pipeline: phone photo of damage plus a coin for scale plus one spoken line produces a claim-ready report where every number is measured, cited, and checked before shipping.

The project is a 3-person student build for the Meta Global AI Hackathon (Oct 27 – Nov 4, 2026). It is technically ambitious and unusually rigorous for a hackathon: deterministic measurement core, receipt ledger, evidence gate, skeptic re-check, replay determinism, frozen eval split, and tape-measured ground truth.

Overall verdict: **strong architecture, honest evaluation, production-plausible demo; needs security hardening, test-suite maintenance, and scope cleanup before real user data.**

Key scores (1–5):

| Area | Score | Note |
|---|---|---|
| Architecture | 5 | Clean separation: deterministic core vs. AI periphery |
| Correctness / determinism | 4 | Receipts + gate + replay; provenance gap acknowledged |
| Testing | 4 | 347 claimed passing; stale counts in secondary READMEs |
| Security | 3 | Good guards; gaps detailed below |
| Documentation | 4 | Excellent README + DEV-LOG; some drift |
| Deploy / Ops | 4 | Worker + Pages + Docker coherent |
| Marketing / demo assets | 3 | Large surface; nested repo + big binaries |

# Inventory

## Repository layout

Top-level directories and their roles:

| Path | Purpose | Verdict |
|---|---|---|
| `backend/` | Node + Cloudflare Worker API, single `handleRequest` router | Keep; core server |
| `src/` | Deterministic core: engine, vision, receipts, gate, render | Keep; the moat |
| `react/` | React 19 + Vite 6 app (primary UI) | Keep; primary frontend |
| `pwa/` | Vanilla-JS PWA, on-device workers, zero npm deps | Keep or merge; overlaps React |
| `migrations/` | Single D1 migration `0001_sessions.sql` | Keep |
| `tests/` | 54 test files, `node --test` | Keep; prune stale |
| `eval/`, `bench/`, `fixtures/` | Deterministic eval, held-out bench, masks + photos | Keep; strongest asset |
| `finetune/` | LoRA distill workflow for muse-glimmer / spark-open | Keep; training-only |
| `snapclaim-marketing/` | Nested git repo: landing site + HyperFrames promo/demo video factory | Isolate or submodule |
| `mg/` | Deterministic motion-graphics scene renderer (Playwright + ffmpeg) | Keep; demo tooling |
| `demo/` | `landlord-status.html`, explicitly DEMO ONLY | Keep; clearly labeled |
| `CASE STUDY/` | Terrace-slab tape ground truth (227 mm) + photos | Keep; evidence |
| `defensive-redirect/`, `redirector-worker/` | Typosquat trap + edge 301 canonicalizer | Keep one; redundant |
| `pwa/`, `react/` | Two frontends doing the same flow | Consolidate long-term |
| `frames/`, `snapclaim_demo/` | Empty scaffolds | Delete or gitignore |

## Entry points

| Entry | File |
|---|---|
| Node dev server | `backend/server.ts` (`:8787`) |
| Cloudflare Worker | `backend/worker.ts` |
| Request router | `backend/app.ts` (`handleRequest`, `VERSION=0.3.0`) |
| Core barrel | `src/index.ts` |
| React app | `react/src/main.tsx` → `react/src/App.tsx` |
| PWA app | `pwa/index.html` + `pwa/app.js` |
| Meta connectivity probe | `scripts/verify-meta.mjs` |

## Technology stack

- Runtime: Node `>=22.18`, ESM, TypeScript executed directly via `node --experimental-strip-types`.
- Strict TS: `strict + noUncheckedIndexedAccess + allowImportingTsExtensions`.
- Dual-target backend: same `handleRequest()` served by Node `http.createServer` (local) and Cloudflare Worker (prod, optional D1 binding, `MemoryStore` fallback).
- Persistence: D1 `sessions(id, at, findings, mode)` or in-memory (cap 1000, list 50 newest-first). Optional Supabase Storage for `data:` segment inputs (best-effort, EXIF-stripped, magic-byte checked).
- AI models (via `backend/metaApi.ts`, `src/config/config.ts`): `muse-spark-1.3` (findings writer + describe), `sam-3.1` (segmentation), `muse-voice-transcribe-1.0` (ASR), `muse-glimmer`, `meta-models/muse-spark-open-1026` on Baseten (skeptic).
- Frontends: React 19.1 + Vite 6.3 PWA (`react/`); vanilla JS + Web Workers + IndexedDB PWA (`pwa/`, zero npm deps, CDN onnxruntime/transformers.js).
- Single extra runtime dep: `@meta-sam/parser` (Meta SAM License; only non-Apache dep).

# Architecture

## Pipeline

```text
MASKS (SlimSAM on-device preview, or live SAM 3.1 via /v1/segment, COCO RLE)
  -> MATH (src/engine: % damaged, crack length mm, mean width mm, area cm2;
     no scale -> percent-only, never upgraded)
  -> RECEIPTS (R001... formula + inputs + confidence, JSONL, src/receipts/)
  -> FINDINGS (Muse Spark 1.3 drafts; evidence-gate ships only if every
     number cites a receipt, else 422 EvidenceError)
  -> SKEPTIC (Spark Open on Baseten re-derives; server re-measures via
     crossCheckMeasurement; /v1/crosscheck IoU SlimSAM-vs-SAM)
  -> ANNEXURE (code-drawn SVG in src/render/, no image generation, no PDF)
```

Principles enforced in code: no LLM touches numbers; fail closed (503 no key, 422 no evidence, never invent mask/transcript/number); everything replays via `npm run replay` producing MATCH or DRIFT.

## Data flow (happy path)

Capture (photo + coin) -> Mark (taps -> RLE via SAM / on-device) -> `/v1/observe` (pixels -> component, masks, scale, overlay, tilt correction) -> `/v1/measure` or `/v1/report` (numbers + receipts) -> Say (transcript via `/v1/transcribe` or on-device) -> Numbers (findings) -> Check (`/v1/skeptic` + `/v1/crosscheck` IoU) -> Report (`/v1/render` SVG annexure + share link `#/s/...` + `/v1/sessions` + Supabase archive).

Trust rules: numbers only from receipts; `evidence-gate` rejects uncited or qualitative numbers; `REQUIRE_PIXEL_PROVENANCE=1` forces `provenance=pixel-verified`; live custom drafts rejected.

## API surface

All responses enveloped as `{ok, requestId, durationMs, result}`. POST body cap 1 MB. Tiered per-IP rate limit (billable 20/min for report/segment/transcribe/describe/findings/skeptic/render; 120/min others).

| Route | Type | Notes |
|---|---|---|
| `GET /v1/health` | public | `{version, time, mode: mock\|live\|config-error}` |
| `GET /v1/spend` | ledger | spend-guard state |
| `GET /v1/admin/status` | public | mode readout |
| `POST /v1/admin/mode` | Bearer `ADMIN_TOKEN` | mock toggle, in-memory override |
| `POST /v1/measure` | deterministic, keyless | component + masks -> `measureSession` |
| `POST /v1/observe` | deterministic | COCO-RLE masks -> overlay + tilt correction (cap 1.7x, refuse beyond 60 deg) |
| `POST /v1/crosscheck` | deterministic | IoU of two RLEs -> `{agreement, verdict, threshold}` |
| `POST /v1/report` | billable | measure + findings draft + repair-retry + validate |
| `POST /v1/segment` | billable | mock fixture; live SAM 3.1 (`imageUrl`, points 1–16, optional box) |
| `POST /v1/transcribe` | billable | mock fixture; live Muse ASR (`audioBase64`, max 4 MB) |
| `POST /v1/describe` | billable | mock fixture; live Spark caption (max 400 chars) |
| `POST /v1/findings`, `POST /v1/skeptic` | billable | require component + masks for server recompute; anti-smuggle |
| `POST /v1/render` | billable | `reportBody` -> `{svg, gate, findings}` |
| `POST /v1/sessions`, `GET /v1/sessions` | store | server-minted id/at; counts only, never photo bytes |
| `GET /` | static | health / frontend shell |

# Code Quality

## Strengths

- Deterministic core (`src/`) is pure, network-free, and well factored: `engine/measure|math|severity|types`, `vision/observe|mask|sam|contour|agreement|exif|coin-detect`, `findings/evidence-gate`, `receipts/types|ledger|hash`, `render/svg`, `adapters/types|mock|pipeline`, `config/config|spend-guard`.
- Single canonical Meta client (`backend/metaApi.ts` -> `https://api.meta.ai/v1` + Baseten), avoiding SDK sprawl.
- SSRF guard (`assertSafeImageUrl`), magic-byte image checks, EXIF stripping, 1 MB / 4 MB caps, per-IP rate limits, CORS allowlist, spend guard with pre-billing hold (429 at zero balance).
- Evidence gate constants are explicit (`MAX_DRAFTS 64`, per-unit backing rules, severity-word checks).
- Tilt handling is honest: correction capped, low-aspect or covered references rejected, sub-confidence scales downgraded to percent-only with `scale_rejected`, coplanar warnings, frame-exit treated as lower bound.

## Issues found

1. **Two frontends, one flow.** `react/` and `pwa/` implement the same Capture -> Mark -> Say -> Numbers -> Check -> Report flow with duplicated allowlists (`isAllowedBackendUrl`), CSP meta, `_headers`, photo-check, tilt, RLE, and store logic. Drift is already policed by tests (`pwa-csp-allowlist`, `csp-headers`) but duplication doubles every future fix.

2. **Backend `app.ts` is a god-router.** All `*Body()` handlers plus routing (lines ~1245–1320) live in one file. Works, but review and test targeting would improve by splitting per-route modules.

3. **`admin.ts` in-memory `mockOverride`.** Fine for demo; must not be mistaken for durable config. Prod already returns 403 when `ADMIN_TOKEN` is unset, which is correct.

4. **Stale test counts in docs.** Root README claims 347 passing; `backend/README.md` still says 105. Cosmetic but undermines the rigor narrative the project sells.

5. **`.env.example` missing.** Subagent glob found no `.env*` template; setup docs reference `cp .env.example .env` but the file is absent from the tree audited. Add it (keys optional, `MOCK_MODE`, `SPEND_GUARD_USD`, `ADMIN_TOKEN`, `ALLOWED_ORIGINS`, `MIN_REFERENCE_CONFIDENCE`).

6. **Empty scaffold dirs.** `frames/`, `snapclaim_demo/frames/`, `snapclaim_demo/raw/` are empty. Either gitignore them or remove them.

7. **Redirect redundancy.** `defensive-redirect/` (static `_redirects`) and `redirector-worker/` (edge Worker 301) solve the same canonicalization. Keep the Worker; keep the static one only as fallback with a comment.

8. **Nested git repo.** `snapclaim-marketing/` has its own `.git/`. It will confuse contributors and CI checkout. Convert to a git submodule with an explicit pointer, or split to a separate repo.

9. **Large binaries in tree.** `fixtures/photos/` (28+ real JPGs), `CASE STUDY` JPGs, `*.mp4` promo files, `mg/out/*.mp4`, `node_modules/` inside `mg/`. Ensure Git LFS or release-asset hosting; verify no photo bytes leak PII (plates, faces, addresses) before public release.

# Security Audit

Scope: static review of guards described in code and tests. No live penetration test performed.

## What is done well

- SSRF guard on image URLs; no raw user-URL fetch without validation.
- Magic-byte image validation; EXIF stripped before archive.
- Multipart WAV path with 4 MB cap; JSON body cap 1 MB (multibyte bypass covered by test).
- Tiered per-IP rate limiting using `cf-connecting-ip` in Worker, fallback in Node.
- Spend guard with reserve/settle semantics; per-process, fail-closed at zero.
- BYOK via `x-meta-key` / `x-baseten-key` headers so user keys never persist server-side.
- `ADMIN_TOKEN` minimum 16 chars; admin writes 403 when unset in prod.
- CSP `connect-src` allowlist mirrored in `pwa/index.html`, `react/index.html`, `_headers` files, and `isAllowedBackendUrl` in both frontends; drift tests exist.
- D1 sessions store counts only, never photo bytes.
- `sig=UNVERIFIED` HMAC stance is honest: replay MATCH is not provenance.

## Findings

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| S-01 | Medium | `MemoryStore` fallback keeps sessions in-process (cap 1000). Single-instance data loss on restart; multi-instance divergence. | Document as demo-only; require D1 (or KV) in prod; add startup log line stating store mode. |
| S-02 | Medium | Per-process spend guard does not aggregate across Worker isolates or Node replicas. Concurrent spend can exceed cap. | Move ledger to D1/KV or Durable Object; or set conservative per-isolate caps and document the multiplier. |
| S-03 | Medium | BYOK keys travel in headers per request. Safe if TLS-only, but logs/proxies can capture them. | Enforce HTTPS-only (HSTS), never log headers, add `Cache-Control: no-store` on keyed routes, document key rotation. |
| S-04 | Low | `ADMIN_TOKEN` in `sessionStorage` (frontend Admin panel). XSS would expose it. | Scope token lifetime, add logout/clear, set short expiry, consider httpOnly cookie flow later. |
| S-05 | Low | Supabase archive is best-effort with service credentials server-side. Bucket misconfiguration could make images public. | Verify bucket is private; use signed URLs; log archive failures without leaking URLs. |
| S-06 | Low | Share links (`#/s/...`) embed findings client-side. Tampered links are readable but not verifiable. | Sign share payloads (HMAC) and verify on load; mark unsigned shares as unverified in UI. |
| S-07 | Info | Staged-photo limitation is documented (replay MATCH != provenance). Capture hash + signature is future work (`src/receipts/hash.ts`). | Keep the disclaimer in UI; prioritize capture-time hashing on the roadmap. |
| S-08 | Info | No PII scrub in demo photos/fixtures audit trail. | Add a `fixtures/README` PII checklist gate before adding real photos; blur faces/plates. |

No hardcoded secrets were found by the auditing subagents. Canonical auth is `Authorization: Bearer $META_API_KEY` server-side, never committed.

# Testing and Evaluation

## Unit / integration tests

- Runner: `node --test tests/*.test.ts`; typecheck `tsc --noEmit`; CI (`.github/workflows/ci`) runs install, test, typecheck, eval, mock smoke on Node 22.
- Claimed: 347 passing (root README). DEV-LOG shows growth 24 -> 244 across the build.
- Files: 54 test files covering admin, agreement, backend, bench archive/gap/run/score, bounty fixes, BYOK, coin detect/pick, config, contour, crosscheck, CSP headers, describe, draft, engine, evidence-gate, exif, mask-ops, metaApi, meta-integration constants, overlay, pdf, photo-check, pipeline, provenance, PWA backend-input/compute/CSP-allowlist/multishot/offline-copy/RLE/shell/store, react-cases/shell, receipt-chain/receipts, render, replay, sam, security, share-link, spend, storage, store, sw-version, theme-dark, tilt-meter/tilt, transcribe, vision-real/vision, plus `helpers.ts`.
- Invariants tested: per-unit gate backing, multibyte cap bypass, CSP/allowlist parity, offline copy, skeptic payload shape, coin radius, SAM decoder markers, frozen-split hash, replay MATCH/DRIFT + SHA256 chain.

Gaps: backend README count stale; no load/chaos test for rate limiter under concurrency; no contract test pinning Worker vs. Node parity beyond smoke; PWA/React parity is convention + a few tests rather than shared code.

## Deterministic eval (`eval/`)

`eval/bench.ts`: `fixtures/masks/*.json` -> `measureSession` -> `fixtures/expected/*.json` with tolerance. Missing expected file = SKIP. Current state 7 pass, 0 skip, 0 fail (wall-crack 5.17% / 85.9 mm / 2.6 mm / 2.19 cm2 significant; stain 1.29% percent-only moderate; tilted-wall; facade-crack; door-peel; noscale).

## Held-out bench (`bench/`)

- Split frozen `2026-10-28T18:05+03:00`: 2 dev + 12 held-out (4 public no-scale refusal cases CC BY-SA/CC0, 7 team-coin DSLR, 1 `terrace-slab-tape-01` tape 227 mm).
- `run.ts` strict: exit 0 clean, 1 incomplete/invented/missed, 2 unfrozen/unreadable. `score.ts` skeptic DISPUTED scoring. `gap.ts` pipeline vs. model-only vs. tape (medianAbsErrorMm + within-10%).
- Only `terrace-slab-tape-01` has runs so far; rest UNRUN (strict runner fails honestly rather than passing vacuously).
- First scored row (live 2026-11-02): pipeline 218.5 mm, error 8.5 mm (3.7%, IN) vs. Spark photo-alone 315 mm, error 88 mm (38.8%, OUT). n=1, clearly labeled as such.

## Case study

`CASE STUDY/`: terrace-slab ground truth 227 mm tape vs. 218.5 mm pipeline (R005), 3.7% error inside ±10%; Spark guess 315 mm (38.8%) outside. Report `SC-25D35C5E-report.md` lists 7 receipts R001–R007, method, annexure v0.3.0 ABSOLUTE. This is the project's strongest single evidence artifact.

Assessment: the eval design is more honest than typical hackathon claims (frozen split, refusal cases, UNRUN instead of fake passes, n=1 disclosed). Next step is filling the held-out runs, not adding new metrics.

# Documentation

| Doc | Role | Status |
|---|---|---|
| `README.md` | Canonical purpose, quickstart, API, config, deploy, cost, privacy, eval, structure | Excellent; fix test count + `.env.example` ref |
| `DEV-LOG.md` | Dated build log 2026-10-27 -> 11-02, every live call + spend | Excellent; rare transparency |
| `backend/README.md` | Router, routes/modes/limits, D1, deploy | Good; stale test count |
| `eval/README.md` | eval/bench/replay/gap/archive usage, exit codes, frozen split | Good |
| `docs/eval-report.md` | Setup, split/licenses, baselines, gap row, tilt, skeptic, misses | Good; update as n grows |
| `docs/TEAM-SEARCH.md` | Team call, 4-model thesis, rigor moat | Good context |
| `fixtures/README.md` | Engine fixtures vs. photo intake checklist, no staging | Good; add PII gate |
| `finetune/README.md` | muse-glimmer / spark-open LoRA workflow | Good |
| `react/README.md` | React port map | Good |
| `CASE STUDY/README.md` + report | Ground truth + receipts | Excellent |
| `leaderboard.md`, `leaderboard-20261101.md` | Channel rigor analysis | Context; non-shipping |
| `THIRD-PARTY-NOTICES.md` | `@meta-sam/parser` Meta SAM License | Keep current |
| `mg/backlog.md` | Motion-graphics backlog | Fine |

# Deployment and Operations

- Local: `npm install; npm test; npm run typecheck; npm run backend:start` (`:8787`); `npm run backend:live` with `--env-file=.env`, `MOCK_MODE=0`.
- Docker: Node 22-alpine, `npm ci --omit=dev`, copies backend/src/eval/migrations/meta.config.json, `EXPOSE 8787`, `HEALTHCHECK /v1/health`; `docker compose up --build` (API `:8787`, `MOCK_MODE=1` default).
- Worker: `cd backend && npx wrangler deploy`; secrets `META_API_KEY`, `BASETEN_API_KEY`; vars `SPEND_GUARD_USD=5`, `MIN_REFERENCE_CONFIDENCE=0.6`, `ALLOWED_ORIGINS`, `ADMIN_TOKEN`.
- Pages: React `dist/` via `npx wrangler pages deploy react/dist --project-name snapclaim`; PWA served static; SW caches shell, never `/v1`.
- Production URLs: app `https://snapclaim.pages.dev` (only `/admin` behind Cloudflare Access), backend `https://snapclaim-backend.parithosh.workers.dev`.
- Self-hosted backend allowlist must stay in sync across 6 locations (2 HTML CSP metas, 2 `_headers`, 2 `isAllowedBackendUrl`); drift tests help but shared config would be better.
- Observability: `observability.enabled=false` in Worker config; health endpoint exists; no centralized logging/metrics. Fine for hackathon; add minimal request-ID logging + spend alerts before pilot.

# Cost Model

- Mock mode: $0 (default, no keys).
- Live guarded by `MOCK_MODE=0`, keys, `SPEND_GUARD_USD` (default $5), BYOK headers.
- Observed spend (DEV-LOG): ~$0.0025 SAM image, ~$0.02 skeptic probes, ~$0.0001 voice, ~$0.000143 Hinglish clip. `FINDINGS_COST_CEILING $0.05`.
- Model pricing noted: SAM 3.1 $0.0025/image, Muse voice $0.18/hr, Baseten skeptic $1.25/4.25 per MTok.
- Verdict: cost story is credible and demo-safe. Add per-request cost attribution to the spend ledger before any paid pilot.

# Recommendations

## P0 — before any real user data

1. Add `.env.example` and verify setup from clean checkout.

2. Centralize backend allowlist into one shared config imported (or code-generated) by both frontends; keep drift tests.

3. Decide Worker vs. static redirect; document the survivor; remove or clearly subordinate the other.

4. Verify Supabase bucket privacy + signed URLs; add PII checklist to `fixtures/README.md`.

5. Sign share payloads; mark unsigned shares unverified in UI.

## P1 — before pilot

6. Move spend ledger + sessions to D1 (or KV/Durable Object); log store mode on boot.

7. Split `backend/app.ts` router into per-route modules; add Worker-vs-Node contract test.

8. Consolidate PWA + React shared logic (api, RLE, tilt, photo-check, store) into one shared package; keep both shells thin.

9. Fill held-out bench runs (12 cases); publish updated `docs/eval-report.md` with n, errors, refusal precision.

10. Convert `snapclaim-marketing/` to a submodule (or separate repo); move big MP4s to release assets or LFS.

## P2 — polish

11. Fix stale test counts; add CI check that README count matches actual `node --test` output.

12. Add rate-limit concurrency test; HSTS + `no-store` on keyed routes; Admin token logout.

13. Capture-time hashing + signature to close the provenance gap (replay MATCH != tamper evidence).

14. Minimal ops: request-ID logs, spend alerts, Pages/Worker deploy runbook in `backend/README.md`.

# Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Staged photos accepted as genuine | High | High | Capture hash/signature; UI disclaimer (already present); intake checklist |
| Spend overrun across isolates | Medium | Medium | Central ledger; conservative caps |
| In-memory session loss | Medium | Low | D1 in prod; boot-mode log |
| Frontend drift (PWA vs React) | Medium | Medium | Shared package; drift tests (exist) |
| PII in public fixtures | Low | High | PII gate; blur pass |
| Nested-repo confusion | Low | Low | Submodule split |
| Eval n=1 overclaim | Low | Medium | Already disclosed; fill bench |

# Appendix A — File Map (selected)

- `backend/app.ts` — routing + validation, `VERSION=0.3.0`.
- `backend/providers.ts` — `MetaFindingsProvider`, `BasetenSkepticProvider`, `FINDINGS_COST_CEILING`.
- `backend/metaApi.ts` — `metaChatCompletions`, `verifyMetaConnectivity`.
- `backend/transcribe.ts` — `transcribeWithMuse`, 4 MB cap.
- `backend/storage.ts` — `archiveSegmentImage`.
- `backend/store.ts` — `MemoryStore` / `D1Store`.
- `backend/spend.ts`, `backend/admin.ts`, `backend/smoke.mjs`, `backend/wrangler.toml`.
- `src/engine/measure|math|severity|types` — labels `crack|stain|peel|dent`.
- `src/vision/observe|mask|sam|contour|agreement|exif|coin-detect` — RLE, skeleton, calibration, tilt.
- `src/findings/evidence-gate.ts` — `MAX_DRAFTS 64`.
- `src/receipts/types|ledger|hash` — receipt kinds, chain, HMAC stub.
- `src/render/svg.ts` — `renderAnnexureSvg`.
- `src/adapters/types|mock|pipeline`, `src/config/config|spend-guard`.
- `react/src/lib/api|sam|session|store|draft|mask|rle|share|voice|pdf|photo-check|tilt`.
- `react/src/screens/Capture|Mark|Say|Numbers|Check|Report|Shared|Admin|Tabs|SamplePicker`.
- `pwa/app.js`, `pwa/store.js`, `pwa/sam-worker.js`, `pwa/voice-worker.js`, `pwa/sw.js`, `pwa/agree|compute|mask-ops|rle|photo-check|coin-model|tilt-meter`.
- `migrations/0001_sessions.sql`.
- `meta.config.json` — endpoint, models, pipeline pointers.

# Appendix B — Audit Method

- Three parallel subagent sweeps (backend+core, docs+config+tests, marketing+assets+edge) against the working tree at `/Users/varma/Downloads/CODING/snapclaim`.
- No live pentest; no network calls beyond local reads; production URLs listed but not probed.
- PDF generated from this markdown via Pandoc (HTML standalone + Chromium print-to-PDF, A4) per the PDF Generation skill; xelatex unavailable in this sandbox (no sudo for BasicTeX), so the LaTeX path was replaced with an equivalent styled-HTML path.

# Document Control

- Source: `docs/AUDIT-REPORT.md` (this file).
- Generated: 2026-11-04.
- Classification: internal review; safe to share after PII pass on fixtures.
- Next review: after P0 items close or bench n reaches 13.
