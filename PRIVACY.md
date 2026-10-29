# SnapClaim Privacy Policy — v2026-10-29-v3

Effective 29 Oct 2026. Short version: photos stay on your phone unless you explicitly share, export, cross-check, or separately opt in to donate. Accepting the Terms is not image-collection consent.

## 1. Data we hold by default: none on servers
Cases live in IndexedDB on your device (`pwa/store.js`). Photo capture, tap-to-mask (on-device SlimSAM), and case browsing work offline. No accounts, no analytics SDKs, no background uploads, no push.

## 2. What leaves the device, and when (your tap only)
| Action | Sent | Why |
|---|---|---|
| Measure (`/v1/observe`, `/v1/measure`) | COCO RLE mask outlines, not photos | Compute measurements + receipts |
| Cross-check masks | Photo once, to SAM 3.1 via backend | Second-model agreement check |
| Render / Share report | Report + optionally attached photo | Annexure SVG you asked for |
| Donate (separate opt-in, off by default) | Downscaled copy 768px JPEG, EXIF stripped via canvas, label, coin size, transcript, masks/receipts JSON, truncated user-agent | Improve the model only with your permission (`POST /v1/collect` → D1 `donations` / R2 `donations/{id}`) |
| Transcribe (live) | ≤10 s mono WAV | Speech-to-text only |

Only `data:`/`https:` URLs accepted. 1 MB JSON cap, 4 MB audio cap, 10 s voice cap.

## 3. Consent and control
- Donation is unticked by default, per-photo and in Settings. Never bundled with Terms acceptance — the Terms gate and the donation toggle are separate consents (DPDP Act 2023 / GDPR: freely given, specific, informed).
- Terms acceptance (`sc_terms_v1` in localStorage: version + timestamp) gates first use; donation consent (`sc_donate`) is independent and revocable.
- Withdraw anytime: untick in Settings stops future donations; Settings → Legal → Withdraw agreement deletes the local Terms acceptance and locks the app. Deletion: Settings → Delete all cases (device) + contact support in Settings → Legal for server donations (we delete the D1 row + R2 object by donation id shown in the toast).
- Consent receipts (Terms version + timestamp; donation version + timestamp) are stored with each donation.

## 4. Retention
- Device cases: until you delete them.
- Donations: 24 months, then deleted, unless you ask earlier.
- Server logs: request IDs + durations for debugging, no photo bytes in logs. Spend ledger only records USD amounts.

## 5. Minors, regions, rights
Minimum age 16. India DPDP Act 2023 + GDPR/CCPA rights honoured wherever you are: access, correct, delete, withdraw consent, nominate (India). Contact in Settings → Legal. We never sell data.

## 6. Security
Keys in server env / Worker secrets only, never in the PWA. Fail-closed 503 without keys. EXIF/XMP stripped on intake. Model output HTML-escaped. CSP in `pwa/index.html`. Report vulnerabilities privately per `SECURITY.md`.

Full router and limits: `README.md`, `backend/README.md`.
