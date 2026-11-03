# Case study — your real measurement on the landing page

This folder is the source of truth for the **Case study** section on the
landing page (`landing.snapclaim.pages.dev`). The page renders
`case-study.json` automatically — edit the JSON / swap the photos, then ask
to rebuild + redeploy. No HTML edits needed.

## Provenance

Content mapped from `snapclaim-marketing/site/case-study/` (owner's bench
case `terrace-slab-tape-01`): numbers, receipts, method, verification,
`terrace-slab.pdf`, and both photos are copied verbatim from there. The
landing page shows a strict subset — nothing is reworded or rounded.

## Files

- `case-study.json` — everything the page shows. `"published": true` means
  the section + nav links are visible. Flip to `false` to hide them again.
- `photos/` — your own photos only. Referenced by relative path
  (`assets/case-study/photos/<file>`).
- `terrace-slab.pdf` — full report, linked from the section.

## `case-study.json` fields

| field | what it is |
|---|---|
| `title`, `sub` | heading + one-line context (place · date · ref · scale) |
| `photos[]` | `src` (path), `alt` (screen-reader description), `caption`, optional `wide: true` to span both columns (charts) |
| `quote` | `{text, cite}` — the tenant's own words |
| `measurements[]` | `{item, value, evidence, status}` — `evidence` is the app receipt id |
| `method`, `verification` | one line each, app wording |
| `compare` | `{heading, rows[{label, value, note}]}` — measured-vs-guessed strip |
| `outcome` | what happened because of the report (facts only) |
| `reportPdf` | path to the downloadable full report, or omit |

## Checklist before publishing

- [ ] Photos are yours, show the damage + the coin/ruler for scale
- [ ] Numbers match the app report (length, %, severity, receipts)
- [ ] No names, addresses, or other people's private details in text or photos
- [ ] `published: true`
