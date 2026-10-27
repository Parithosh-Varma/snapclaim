# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Landing page: plain static HTML/CSS in `site/`, deployable on Cloudflare Pages beside the Worker backend (`backend/`). Promo: HyperFrames (HTML compositions rendered to MP4) in `promo/`.

## Users

Primary for the landing page: Meta Global AI Developer Hackathon judges (Oct 26 – Nov 4, 2026) deciding in a few minutes whether the project is real, technically deep and uses the Meta stack well. End users of the product: tenants, small shop owners, two-wheeler owners and households documenting small damage (cracks, stains, peeling, dents) for deposit disputes and small claims, often in India.

## Product Purpose

Point a phone at damage, say one line, get a claim-ready report where every number is measured from the pixels, cited to a receipt, and re-checked by an independent model. Success: a judge can replay any number in the report from the photo and its calibration data.

## Positioning

Computed, not generated. SAM 3.1 masks the damage; deterministic code (no LLM) measures area %, calibrated crack length (mask skeleton × px→mm scale from a coin or ruler in the same plane) and severity against printed thresholds. Muse Spark 1.3 writes findings that must cite a receipt or the build fails (Evidence Gate). Spark Open re-measures as a skeptic; anything it can't reproduce prints DISPUTED in red. No image generation anywhere.

## Operating Context

Phone capture (PWA) with a scale reference in frame, a spoken line (Hindi, Telugu, Hinglish via Muse Voice Transcribe), output as a code-drawn SVG annexure with masks over the photo, a receipts table and a replayable receipts file. Without a scale reference, or with an occluded/tilted one, the report stays percent-only and says so.

## Capabilities and Constraints

- Four Meta models with distinct jobs: SAM 3.1 (perception), Muse Spark 1.3 (writer), Spark Open on Baseten (skeptic, open weights), Muse Voice Transcribe (voice).
- Honest boundaries: documentation, not advice; measurement is not causation; staged photos are a known limit.
- Photo metadata (GPS, device) is stripped on intake.
- Undecided: live deployment URL; real demo photos (not yet captured).

## Brand Commitments

- Name: SnapClaim. Logo at `site/assets/snapclaim-logo.png` (camera-frame brackets around a crack, green ruler corner; wordmark "Snap" navy, "Claim" green).
- Voice: plain, exact, a little dry. Thesis line: "A claim is an argument. Arguments need evidence."

## Evidence on Hand

README, DEV-LOG (dated, $0 spend so far), test suite, synthetic fixtures (`fixtures/masks/wall-crack.json`: crack 5.17%, 85.9 mm, significant). No real photos, users, testimonials or benchmark results yet — do not fabricate any.

## Product Principles

1. Every number has a receipt.
2. Refuse rather than guess: low-confidence scale means percent-only, uncited sentences fail the build.
3. Disagreement is shown, never hidden.
4. Replayable by a stranger.
