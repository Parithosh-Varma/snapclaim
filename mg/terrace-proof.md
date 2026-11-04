# SnapClaim — Terrace Proof (Launch Copy)

> Photo + one line in, measured damage report out. Computed, not generated.

## Live proof — Terrace slab, Ref `SC-D8ECE64B`

Crack on the pavement slab of the terrace. Photo-pixel outlines scaled by coin diameter, tilt-corrected from ellipse.

- Crack length **232 mm [R005] filed report** (Confirmed; second photo 237.5 mm, ~2% apart, 25 mm coin both shots)
- Surface coverage **0.73% [R002]** (Confirmed)
- Damage area **7.48 cm² [R004]** (Confirmed)
- Severity **significant [R007]** (Confirmed)
- Mean crack width **3.2 mm [R006]** (Unverified — no width ground truth)

Every number above cites its receipt. No LLM touches the numbers.

## Live PDFs

- Report: https://snapclaim.pages.dev/reports/snapclaim-SC-D8ECE64B.pdf
- Case study: https://snapclaim.pages.dev/reports/Case%20Study%20Comparative%20Measurement%20of%20a%20Terrace-Slab%20Crack.pdf

## Receipt sources

- `src/receipts/ledger.ts:4` — R002 0.73%, R004 7.48cm2, R005 232mm, R006 3.2mm Unverified, R007 significant
- `README.md:15` — launch proof block with Confirmed / Unverified labels
- `react/public/proof.html:21-27` — public proof table + live PDF links
- `react/src/screens/Tabs.tsx:153-154` — in-app tip copy with same receipts
