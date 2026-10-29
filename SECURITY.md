# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

SnapClaim is pre-1.0 (hackathon build, Oct–Nov 2026). Only the current `main`
branch is patched.

## Reporting a vulnerability

**Do not open a public issue.**

Use **GitHub Security Advisories → Report a vulnerability** (private) on this
repo. Include:

- Affected route/file and version/commit
- Steps to reproduce (request body, `requestId` if available)
- Impact assessment (what an attacker can read, write, or spend)

What to expect:

- Acknowledgement within 72 hours
- Fix or mitigation plan on a timeline proportional to severity
- Credit on request once the fix ships

If private advisories are unavailable, open a minimal issue asking for a secure
contact channel — without any exploit details.

## Scope and boundaries

In-scope: `backend/` router and providers, `src/` measurement/gate/render
logic, `pwa/` client handling, auth/key handling, spend guard, SVG rendering.

Out of scope: social-engineering of staged damage photos (known limit —
receipts prove measurement, not provenance), third-party model APIs themselves.

## Good to know

- API keys live in server env / Worker secrets only, never in `pwa/`. Live
  routes fail closed (503) without keys.
- The PWA sends COCO RLE masks, not photos, except for two explicit user taps
  (SAM cross-check, annexure attach). Only `data:`/`https:` URLs are accepted.
- The spend guard (`SPEND_GUARD_USD`, default $5) is per-process/per-isolate.
- EXIF/XMP is stripped from photos on intake; model output is HTML-escaped.
- Never include secrets, real claim photos, or PII in issues, PRs, or fixtures.
