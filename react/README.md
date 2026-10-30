# SnapClaim — React PWA

React + TypeScript port of the vanilla `pwa/` app (full parity: Home/Cases/
Settings tabs, capture with the coin gate, review, tap-to-mark with SlimSAM /
SAM 3.1, voice, measured numbers, skeptic + mask cross-check, SVG report,
local case store, offline shell and update bar).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build into dist/
npm run preview  # serve dist/ locally
```

Deploy: serve `dist/` as a static site (Cloudflare Pages: build command
`npm run build`, output `dist`). The vanilla `pwa/` remains the live app
until this build is pointed at production.

How it maps to the vanilla app:

| Vanilla | React |
|---|---|
| `pwa/app.js` screens + flow state | `src/App.tsx` state machine + `src/screens/` |
| module-level flow variables | `src/lib/session.ts` (mutable session ref; React state only mirrors what renders) |
| `pwa/store.js` | `src/lib/store.ts` — same localStorage keys, so existing cases/settings carry over |
| `pwa/photo-check.js`, `pwa/rle.js`, `pwa/tilt-meter.js` | `src/lib/photo-check.ts`, `src/lib/rle.ts`, `src/lib/tilt.ts` (logic identical) |
| coin gate inside `app.js` | `src/lib/camera.ts` (`CoinGate`, callbacks into React) |
| `coin-model.js`, `sam-worker.js`, `voice-worker.js`, `theme.js` | copied verbatim into `public/` |
| `pwa/sw.js` | `public/sw.js` — same strategy, cache `snapclaim-react-v1` |

Backend calls are unchanged (`/v1/measure`, `/v1/observe`, `/v1/report`,
`/v1/skeptic`, `/v1/crosscheck`, `/v1/render`, `/v1/transcribe`,
`/v1/segment`, `/v1/health`); the base URL is a setting, defaulting to the
production Worker.
