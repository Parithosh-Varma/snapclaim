# SnapClaim onboarding: test checklist

Run `node --test tests/onboarding.test.ts` for the logic suite (14 tests).
The rest is manual, one pass per release, on a real phone if possible.

## Automated (`tests/onboarding.test.ts`)

- [ ] Fresh store shows onboarding at step 1.
- [ ] Step persists across refresh; resume lands on the saved step.
- [ ] Completion only happens at step 5 (Skip never jumps past permissions).
- [ ] Clearing re-arms onboarding for How-it-works replay.
- [ ] Throwing storage (private mode) never throws; in-memory fallback holds.
- [ ] `time_to_complete` is non-negative and derives from stored timestamps.
- [ ] In-app browsers detected; desktop-no-camera maps to the upload path.
- [ ] Recovery copy has OS steps plus an upload/type fallback.
- [ ] Reduced-motion helper is injectable and safe without `matchMedia`.
- [ ] Analytics carry event names only (no photo, transcript, or data URL).
- [ ] Analytics cap drops oldest past 200 events.
- [ ] Coach flags persist once dismissed.
- [ ] Copy has no banned words, keeps PLACEHOLDERs and the Unverified line.
- [ ] Storage keys are namespaced and distinct.

## Manual: flows

- [ ] First launch shows screen 1; completing all 5 lands in the capture flow.
- [ ] `I have used SnapClaim before` skips straight to capture.
- [ ] Skip on screens 1-4 jumps to screen 5, never past it. Screen 5 has no Skip.
- [ ] Back on screen 1 exits to home; back elsewhere steps back one screen.
- [ ] Refresh on screen 3 resumes on screen 3 with the `resuming` note.
- [ ] Settings → About → `How it works` replays onboarding from step 1.
- [ ] Camera granted → `Start my report` enables. Mic never gates it.
- [ ] Camera denied → recovery steps show, `Upload a photo instead` enables Start.
- [ ] Mic denied → `No problem, type your description` path, Start unaffected.
- [ ] Camera permission previously blocked → recovery shown immediately, no dead request button.
- [ ] Desktop with no camera → `Upload a photo` is the primary path; picking a valid photo lands on review with the photo attached.
- [ ] In-app browser (Instagram/Facebook) → `Open in your browser` guidance shows.
- [ ] Capture screen first visit → coach-mark `Keep the coin flat next to the crack` with `Got it`; second visit → gone.
- [ ] Say screen first visit → mic tooltip shows; second visit → gone.
- [ ] `How we handle your data` opens the sheet; `Close` returns to screen 4.
- [ ] Slow connection: onboarding renders instantly (inline SVG only, no network fonts required).

## Manual: layout and accessibility

- [ ] 320px width: nothing overlaps or clips; buttons keep text labels.
- [ ] Landscape phone: art shrinks, all actions reachable.
- [ ] 375-430px phones and ~480px centered column on tablet/desktop.
- [ ] All tap targets at least 44px; sticky primary has a text label, never a spinner alone.
- [ ] Visible 2px green focus rings on every control (Tab through all 5 screens).
- [ ] Screen reader: heading order correct, progress announced as `Step N of 5`, icon buttons labelled, status chips read as text.
- [ ] Dynamic Type / large text: no clipped containers, no fixed text heights.
- [ ] `prefers-reduced-motion`: coin art static, no slide/fade transitions.
- [ ] Text contrast at least 4.5:1 on body copy; large/bold actions at least 3:1.
- [ ] Safe-area padding respected top and bottom (notched phones).
- [ ] Transitions feel 150-250ms: slide between screens, fade for tooltips.
- [ ] Offline after first load: onboarding and capture render without network.
