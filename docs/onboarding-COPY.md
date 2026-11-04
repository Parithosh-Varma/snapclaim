# SnapClaim onboarding: copy sheet

Source of truth: `react/src/lib/onboarding.ts` (`STRINGS`). This sheet mirrors
it for review. If they disagree, the code wins; update this file to match.

No text is baked into images. Leave room for 30% longer copy in other
languages: layouts wrap, never clip. Banned in UI: AI-powered, segmentation,
skeleton, ground truth. House style: short sentences, sentence case, no stray
hyphens or ellipses as separators.

## Global chrome (every screen)

- Back: `Back` (aria: `Back to home` on step 1, `Back to step N` after).
- Progress: `Step N of 4` (exposed as `Step N of 4` to assistive tech).
- Skip: `Skip` (screens 1 to 3 only; screen 4 has none, it ends in the claim flow).

## Screen 1: Welcome

- Title: `Document damage in minutes.`
- Sub: `Take a photo, describe what happened, and get a clear measured report you can send to your insurer.`
- Art alt: `Phone showing a cracked wall with a red outline tracing the crack and a green circle on a coin beside it.`
- Primary: `Get started`
- Secondary: `I have used SnapClaim before`
- Resumed banner: `Welcome back. You are resuming where you left off.`
- Resumed banner: `Welcome back. You are resuming where you left off.`

## Screen 2: How it works

- Chip: `Takes about 2 minutes`
- Title: `How it works.`
- Sub: `Three steps, about two minutes.`
- Step 1: `Place a coin` / `Put a coin next to the damage. It gives the app a known size to measure from.`
- Step 2: `Photo and a line` / `Take a photo and add a short description. Type it or use the mic.`
- Step 3: `Get your report` / `Measurements, outlines and evidence in one PDF.`
- Honesty line: `Some measurements may be marked Unverified. That is normal, and it is shown openly.`
- Primary: `Next`

## Screen 3: Coin placement guide

- Title: `Place a coin beside the damage.`
- Sub: `This one photo decides how good the measurement is.`
- Do card: `Do this`
  - `Coin flat on the same surface, right next to the damage.`
  - `Full coin visible, nothing covering it.`
  - `Photo straight-on, with even light.`
- Do art alt: `Correct placement: coin flat beside the crack, fully visible.`
- Do not card: `Avoid this`
  - `Coin tilted, propped up, or partly hidden.`
  - `Coin in shadow or far from the damage.`
  - `Photo at a sharp angle.`
- Do not art alt: `Incorrect placement: coin tilted and partly hidden in shadow.`
- Reassurance: `Slight tilt is fine. The app corrects for it, but flat and straight-on gives the best result.`
- Coin note: `Use any coin and select it in the next step. [PLACEHOLDER: state which coins are supported and their known diameters per the product's actual behavior. Do not invent coin specifications.]`
- Primary: `Got it`

## Screen 4: Privacy and trust

- Title: `Your photos stay with you.`
- Sub: `What happens to your pictures, in plain words.`
- Row 1: `Measured on your device` / `Photos are processed here, not sent away to be measured.`
- Row 2: `Your words stay yours` / `We keep your description as you wrote it.`
- Row 3: `Every number has a receipt` / `The report shows how each measurement was worked out.`
- Placeholder (remove before ship unless every row is strictly true): `[PLACEHOLDER: confirm the exact data-handling claims with the product team before shipping; remove any row that is not strictly true.]`
- Link: `How we handle your data`
- Sheet title: `How we handle your data`
- Sheet body: `Cases stay on this device unless you share the report. Measuring runs on this device after a first online load. Optional cross-checks send the tapped photo to the backend you configure. [PLACEHOLDER: confirm before shipping.]`
- Sheet close: `Close`
- Primary: `Next`
