# Contributing to SnapClaim

Thanks for contributing. SnapClaim is a measured-damage evidence pipeline:
photo + one line in, replayable report out. Every number is computed in code,
cited by receipt, and gated before it ships.

Please read this plus our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Quickstart

Requirements: Node.js ≥ 22.18. No API keys needed — default mode is offline demo ($0).

```bash
npm install
npm test            # full suite, mock mode
npm run typecheck   # tsc --noEmit, must pass
npm run eval        # deterministic measurement bench
npm run backend:start   # http://127.0.0.1:8787, then open pwa/index.html
```

Useful extras:

```bash
npm run replay -- request.json measurement.json  # recompute a report: MATCH or DRIFT
npm run backend:smoke   # end-to-end smoke against a running backend
```

Copy `.env.example` to `.env` for live mode (`MOCK_MODE=0` + keys). Never commit `.env`.

## Project principles (enforced in review)

1. **No LLM touches the numbers.** Models write sentences; arithmetic lives in `src/engine/`, `src/vision/`.
2. **Fail closed.** No key → 503. No evidence → 422. Empty model output → error. Never invent a mask, transcript, or number to make a path pass.
3. **Everything replays.** New measurement logic must stay reproducible via `npm run replay` and `fixtures/` + `eval/`.

## How to contribute

1. Open an issue first for anything beyond a typo fix, so scope can be agreed.
2. Fork and branch from `main`: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`.
3. Keep diffs small and focused. One concern per PR.
4. Add or update tests under `tests/` for behavior changes. Missing `fixtures/expected/` file = SKIP, never a silent pass — add expected outputs for new bench cases.
5. Run before pushing: `npm test`, `npm run typecheck`, `npm run eval`. If you touched measurement/gate/render, also run `npm run backend:smoke` against a local backend.
6. Fill out the PR template completely, including the replay/evidence-gate checklist where relevant.

## Coding guidelines

- TypeScript, `type: module`, no new runtime dependencies without justification in the PR.
- Follow existing style in the touched area; keep functions small and deterministic.
- No secrets, photos, or PII in fixtures, logs, or PRs. Test photos are gitignored — use `fixtures/masks/*.json` RLE masks.
- PWA output rendering must stay HTML-escaped with the existing Content-Security-Policy.
- Respect hard limits: 50 masks/call, 1–16 point prompts, 1 MB JSON body, 4 MB audio, 10 s clips.

## Reporting bugs

Use the bug report template. Include: component + masks input (or fixture name), expected vs actual measurement/gate output, `requestId`/`durationMs` from the envelope, and whether you were in `mock` or `live` mode (`GET /v1/health`).

## Security

Do not open public issues for vulnerabilities. See [SECURITY.md](./SECURITY.md).
