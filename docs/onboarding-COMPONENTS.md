# SnapClaim onboarding: component list

All components live in `react/src/screens/Onboarding.tsx` unless noted.
Styles are scoped under `.ob-` in `react/src/onboarding.css` so the legacy
app theme is untouched. Reuse these elsewhere instead of rebuilding.

| Component | File | Props | Reused in |
|---|---|---|---|
| `ProgressDots` | `screens/Onboarding.tsx` | `{ step: 1..4 }` | Step headers; `aria-label` carries `Step N of 4` |
| `PrimaryButton` | `screens/Onboarding.tsx` | `{ id?, children, onClick, disabled? }` | Sticky bottom action on every onboarding screen |
| `DoDontCard` | `screens/Onboarding.tsx` | `{ kind: "do" \| "dont", title, items, artAlt, children }` | Coin tips sheet in `Capture.tsx` |
| `CoinStatusChip` | `screens/Onboarding.tsx` | `{ detected: boolean }` | `Capture.tsx` live framing chip. Icon plus text, never colour alone. The live coin detector plugs into `detected`. |
| `CaptureCoach` | `screens/Onboarding.tsx` | `{ onGotIt }` | `Capture.tsx` coach-mark over the viewfinder, first capture only |
| `MicTip` | `screens/Onboarding.tsx` | `{ onGotIt }` | `Say.tsx` tooltip pointing at Dictate, first visit only |
| `WelcomeArt`, `CoinDoArt`, `CoinDontArt` | `screens/Onboarding.tsx` | `{ reduceMotion? }` on welcome | Inline SVG only, no network wait. Swap to static under `prefers-reduced-motion`. |
| `STRINGS` | `lib/onboarding.ts` | dictionary | Every user-visible string. Translatable, nothing baked into images. |
| `shouldShowCaptureCoach`, `dismissCaptureCoach`, `shouldShowMicTip`, `dismissMicTip` | `screens/Onboarding.tsx` | localStorage-backed | Once-only JIT state with in-memory fallback |
| `loadOnboarding`, `saveOnboarding`, `startOnboarding`, `setOnboardingStep`, `completeOnboarding`, `clearOnboarding`, `shouldShowOnboarding`, `timeToCompleteMs` | `lib/onboarding.ts` | `StorageLike` injectable | First-run state; `useOnboardingGate` in `Onboarding.tsx` wraps it for React |
| `isInAppBrowser`, `platformKind`, `cameraSupport`, `cameraRecovery`, `micRecovery`, `reducedMotionPreferred` | `lib/onboarding.ts` | pure inputs | Environment branching and OS-specific recovery steps |
| `logEvent`, `readAnalytics` | `lib/onboarding.ts` | `AnalyticsRecord` | Privacy-safe funnel: event names only, 200-event cap |
| `useOnboardingGate` | `screens/Onboarding.tsx` | — | `App.tsx` overlay: `active`, `initialStep`, `resumed` |
| `.ob-*` styles | `src/onboarding.css` | — | Brand tokens: `--ob-navy #0A1E48`, `--ob-green #0E8A4B`, `--ob-amber #B7791F`, `--ob-bg #F4F1EA`, cards `#FFFFFF` with `#E4E1D8` hairlines, 12px radii |
