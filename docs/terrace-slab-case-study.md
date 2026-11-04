# Terrace-slab case study (Ref SC-D8ECE64B, 4 Nov 2026)

Field report for a terrace-slab crack, with a companion case-study PDF
comparing three manual measurement methods. Source of truth for numbers:
`fixtures/terrace-slab-SC-D8ECE64B.json`; prose below mirrors the README
"Live proof" block and the case-study PDF. No new claims.

## SnapClaim measurement

- Ref `SC-D8ECE64B` — transcript: "crack on the pavement slab of the terrace".
- Method: photo-pixel outlines scaled by coin diameter, tilt-corrected from
  the coin ellipse.
- Crack length **232 mm [R005] filed report** (Confirmed; engine re-run of the same photo 237.5 mm — ~2% run variance at the same 25 mm measured coin)
- Width **3.2 mm [R006]** (Unverified — no width ground truth)
- Surface **0.73% [R002]** (Confirmed)
- Area **7.48 cm² [R004]** (Confirmed)
- Severity **significant [R007]** (Confirmed)
- Verification: evidence gate **passed** / skeptic **verified** /
  mask cross-check **verified**.

## Manual references (from the case-study PDF, §4)

| # | Method | Value | Note |
|---|---|---|---|
| 1 | Straight tape, end-to-end (tape ~127 cm to 149.5–150 cm) | **227 mm** (range 225–230 mm) | Paired ground-truth reference for this case. Report 232 mm vs tape 227 mm (+2.2%); re-run 237.5 mm (+4.6%). |
| 2 | Thread-and-pin path, then measured | **238.8 mm (9.4 in), ±4 mm** | Read twice and confirmed. Taken from a **different, horizontal crack** with no coin in frame — **not directly comparable**. |
| 3 | Pin-to-pin segments (set square + scale) | **274 mm (27.4 cm)** | Six spans: **5.2, 4.8, 4.5, 4.2, 2.9, 5.8 cm** (sum 27.4 cm). |

## What the case-study PDF says (§§5–7)

- The straight-tape reading (227 mm) is shortest because it ignores the
  crack's meander; the pin-to-pin method (274 mm) follows the path most
  closely and is expected to be most accurate for a curved crack.
- The thread value (238.8 mm) falls between the two but is from a different
  crack — indicative only.
- Limitations stated in the PDF: thread measurement not on the same crack;
  n = 1, too small to generalise; tape/thread carry a few-mm reading
  tolerance; pin spacing affects the pin-to-pin result.
- Recommendation: prefer a path-following method (pin-to-pin) over a
  straight tape reading for curved cracks; repeat the thread measurement on
  the terrace-slab crack and report per-method percentage error against the
  SnapClaim value.
- Caveat printed in the PDF itself: straight-tape and pin-to-pin differ by
  roughly 20%, so they cannot both fall within 5% of the same prediction —
  the per-method errors still need calculating.

## Live PDFs

- Report: https://snapclaim.pages.dev/reports/snapclaim-SC-D8ECE64B.pdf
- Case study: https://snapclaim.pages.dev/reports/Case%20Study%20Comparative%20Measurement%20of%20a%20Terrace-Slab%20Crack.pdf

## Sources

- `fixtures/terrace-slab-SC-D8ECE64B.json` (numbers, transcript, verification, links)
- `react/public/reports/snapclaim-SC-D8ECE64B.pdf` (field report)
- `react/public/reports/Case Study Comparative Measurement of a Terrace-Slab Crack.pdf` (the study summarised above)
- `README.md` "Live proof" block; `bench/run.ts` header (232 vs 227 +2.2%)
