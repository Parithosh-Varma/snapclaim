# Case study — your real measurement on the landing page

This folder is the source of truth for the **Case study** section on the
landing page (`landing.snapclaim.pages.dev`). The page renders
`case-study.json` automatically — no HTML edits needed, just fill in this
folder and ask to rebuild + redeploy.

## How to add your case study

1. **Drop your photos** into `photos/` (JPG, any size — the page crops
   with `object-fit: cover`).
   - Name them clearly, e.g. `01-crack-wide.jpg`, `02-coin-scale.jpg`.
   - Use photos **you took**. Never add stock or other people's photos here.
2. **Fill in `case-study.json`** (open it — every field is explained).
   - Keep numbers exactly as the app measured them.
   - `evidence`: paste the receipt id from the app report if you have it,
     otherwise leave `"—"`.
3. **Flip `"published"` to `true`.**
4. Tell the agent to **rebuild + redeploy the landing page**, then check
   `https://landing.snapclaim.pages.dev/#case-study`.

## While `published` is `false`

The Case study nav link and section stay hidden, so the live page is
untouched. Nothing half-finished ever ships.

## Checklist before publishing

- [ ] Photos are yours, show the damage + the coin/ruler for scale
- [ ] Numbers match the app report (length, %, severity)
- [ ] No names, addresses, or other people's private details in text or photos
- [ ] `published: true`
