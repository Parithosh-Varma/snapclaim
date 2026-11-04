# Migrations — proof (Ref SC-D8ECE64B)

Scope note: `migrations/` is SQL-only (one applied migration,
`0001_sessions.sql`). Applied migrations are never altered; this file is
docs-only.

## Applied migrations

- `0001_sessions.sql` — creates `sessions` table (`id`, `at`, `findings`,
  `mode`) plus `idx_sessions_at` index. All statements are
  `IF NOT EXISTS`, so replay is safe.

## Live proof numbers (Ref SC-D8ECE64B, terrace slab, 4 Nov 2026)

- Crack length **232 mm [R005]** (Confirmed)
- Width **3.2 mm [R006]** (Unverified — no width ground truth)
- Surface **0.73% [R002]** (Confirmed)
- Area **7.48 cm² [R004]** (Confirmed)
- Severity **significant [R007]** (Confirmed)
- Verification: evidence gate passed / skeptic verified / mask cross-check verified.
- Manual refs: straight tape 227 mm (225–230); thread 238.8 mm (different
  horizontal crack, NOT comparable); pin-to-pin 274 mm.

## URLs

- Report: https://snapclaim.pages.dev/reports/snapclaim-SC-D8ECE64B.pdf
- Case study: https://snapclaim.pages.dev/reports/Case%20Study%20Comparative%20Measurement%20of%20a%20Terrace-Slab%20Crack.pdf
- Backend health: https://snapclaim-backend.parithosh.workers.dev/v1/health
- App: https://snapclaim.pages.dev
- Repo: https://github.com/Parithosh-Varma/snapclaim
