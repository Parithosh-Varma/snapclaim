# Landing redesign plan — SnapClaim marketing site (`landing` branch)

Source: `react/index.html` + `how/faq/progress.html`, `react/public/styles.css`,
`app.js`, `theme.js`. Build: `npm run build` in `react/` → `dist/`.
Deploy: manual `wrangler pages deploy dist --project-name snapclaim --branch landing`.
Baseline: `qa/before_<width>_<theme>.png` (1440/1024/768/390, light+dark),
Lighthouse mobile home: Perf 100 / A11y 97 / BP 100 / SEO 100.

## Section order (home)
1. Header (fixed per header mission: nowrap links, one 40px-high center line,
   menu <900px, duplicate "Case study" link removed, CTA kept).
2. Hero — eyebrow "Early preview, in development" (kept, truth rule).
   H1: "Turn a damage photo into measured proof."
   Sub: "One photo with a coin for scale, one spoken line — SnapClaim returns
   a report where every number is measured from the pixels, cited to a
   receipt, and checked before it ships."
   Primary CTA: "See a real measurement" → #case-study. Quiet secondary:
   "How it works →" → how page. Phone mockup stays (real terrace numbers).
3. Proof band (moved directly under hero): interactive 227 / 218.5 / 315
   tape-measure strip + tape photo thumb + plain sentence:
   "Tape says 227 mm. SnapClaim measured 218.5 mm — 8.5 mm under (3.7%),
   inside the ±10% band. The photo-alone guess said 315 mm. One
   documented case, not a general accuracy claim."
4. How it works — 4 steps, one line each, real assets only:
   photo + coin / tap to mark / math measures (deterministic, no LLM in
   the loop) / report you can recheck (receipts + replay MATCH/DRIFT).
5. Case study, shortened (≤1.5 mobile screens before expander): figures
   tape + guess + string-vs-tape + bar chart; tenant quote; condensed
   measurements table with evidence column; method (1 line); verification
   line as-is; outcome; expander "See the full report" → PDF preview +
   download button. Disclaimer "Documentation, not legal or insurance
   advice" repeated beside the preview.
6. What SnapClaim can't do (new; all from README scope, no invention):
   needs a scale reference (else percent-only, never mm); best on flat
   surfaces, tilt-corrected via the coin ellipse; early preview; one
   documented real case so far; documentation, not advice; staged photos
   are a known limit (receipts make replay tamper-evident, not provenance).
7. Who it's for (trimmed): renters, bike/car owners, small shops.
8. FAQ teaser → link to faq page (no invented answers on home).
9. Closer: primary "Try the live app" (verified live, no login) +
   quiet text link "How it works". GitHub moves to footer text link.
10. Footer (attribution wording TBD by owner — see open question).

## Copy decisions (truth rules)
- Keep every number exactly: 227 / 218.5 / 315 / 0.73% / 3 mm / 6.51 cm² /
  25 mm coin / SC-25D35C5E. "n=1" phrased as "one documented case".
- Keep: location-data stripping (verified `src/vision/exif.ts`), "Free to
  try, no account, no install" (verified: no auth in app), live-app link
  (verified HTTP 200), "Early preview" label.
- Glossary (one plain line each, first use): receipt = "the stored
  calculation behind a number"; evidence gate = "the check that blocks any
  number without a receipt"; skeptic = "a second, independent AI recheck
  (currently: not run on this case)"; cross-check = "an independent
  re-outline of the same photo (currently: not run on this case)".
- "Check it twice" CTA in mockup → retarget to the verification line so
  the page doesn't promise checks the case study says didn't run.
- Removed/duplicated: second "See a real measurement" buttons (one
  primary per viewport), mock sample numbers (all numbers now terrace),
  "Disagreement is printed" point (kept only where true: the gate +
  "flagged, never hidden" applies to findings pipeline, worded as such).

## Open questions for owner (one at a time)
1. Footer "Built with Meta AI" heading + model list (verified: SAM 3.1,
   Muse Spark 1.3, Spark Open, Muse Voice Transcribe — matches README):
   keep, reword, or drop? Do not decide without owner.
