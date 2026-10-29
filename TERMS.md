# SnapClaim Terms of Use — v2026-10-29-v3

Effective 29 Oct 2026. SnapClaim ("we") is a pre-1.0 hackathon build by a student team.

## 1. What SnapClaim does
Point your phone at damage, speak one line, get a measured evidence package (percent damaged, crack length/width, area) with machine-checkable receipts. **Documentation, not advice.** No coverage decisions, no legal claims, no approval predictions. A human decides; SnapClaim produces the evidence package.

## 2. Accepting these terms
By tapping "I agree" in the app you accept these terms and the Privacy Policy (`PRIVACY.md`). If you disagree, do not use the app. We version terms (`v2026-10-29-v3`); continued use after an update is acceptance of the new version. Minimum age 16 (or guardian consent).

## 3. Your responsibilities
- Photograph only damage you have a right to document. No trespass, no other people's private spaces without permission.
- Staged or edited photos are a known limit: receipts prove measurement, not provenance.
- Dates are your device clock, not verified evidence time.
- You keep rights to your photos and text. Accepting these terms does not transfer any image rights — dataset use requires a separate opt-in (see §4).

## 4. Dataset donation (optional, off by default, separate consent)
Accepting these terms is not consent to image collection. Ticking "Donate this photo" (review screen) or "Donate photos by default" (Settings) separately consents to sending a downscaled copy (768px, EXIF stripped via canvas) plus label, coin size, transcript, masks/receipts JSON and truncated user-agent to our dataset store (`POST /v1/collect` → D1 `donations` / R2 `donations/{id}`) to improve the model. Untick anytime to stop future uploads; deletion requests: see Settings → Legal (we delete the D1 row + R2 object by donation id).

## 5. Acceptable use
No unlawful content, no attempt to break the evidence gate, spend guard, or other users' cases. No reverse-engineering of model keys. Live routes fail closed without server keys.

## 6. IP and license
App code is Apache-2.0 (`LICENSE`). Your case exports are yours. Measurement receipts and SVG annexures you generate are yours to share.

## 7. Disclaimers and liability
Provided "as is", no warranties. To the maximum extent permitted by law, we are not liable for claim outcomes, coverage denials, or reliance on measurements. Cap: amount you paid us (the app is free, so $0) — use at your own risk.

## 8. Changes and contact
We may update these terms with a version bump and in-app notice. Questions or deletion requests: see Settings → Legal in the app or open a GitHub issue without PII/secrets.
