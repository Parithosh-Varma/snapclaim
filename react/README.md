# SnapClaim - React app

The SnapClaim app (React + TypeScript): Home/Cases/Settings tabs, capture
with the coin gate, review, tap-to-mark with SlimSAM / SAM 3.1, voice,
measured numbers, skeptic + mask cross-check, SVG report, local case store,
offline shell and update bar.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build into dist/
npm run preview  # serve dist/ locally
```

Deploy: serve `dist/` as a static site (Cloudflare Pages: build command
`npm run build`, output `dist/`). Production: https://snapclaim.pages.dev.

Layout:

| Area | File |
|---|---|
| state machine + screens | `src/App.tsx`, `src/screens/` |
| flow state (mutable session ref; React state mirrors what renders) | `src/lib/session.ts` |
| local cases/settings store (localStorage keys shared with earlier builds) | `src/lib/store.ts` |
| photo check, RLE codec, tilt meter | `src/lib/photo-check.ts`, `src/lib/rle.ts`, `src/lib/tilt.ts` |
| coin gate | `src/lib/camera.ts` (`CoinGate`, callbacks into React) |
| workers, coin model, theme | `public/` (`sam-worker.js`, `voice-worker.js`, `coin-model.js`, `theme.js`) |
| offline shell | `public/sw.js` |

Backend calls (`/v1/measure`, `/v1/observe`, `/v1/report`,
`/v1/skeptic`, `/v1/crosscheck`, `/v1/render`, `/v1/transcribe`,
`/v1/segment`, `/v1/health`); the base URL is a setting, defaulting to the
production Worker.
