# SnapClaim

> **Point your phone at damage, speak one line about it — get a claim-ready report where every number is measured, cited, and checked by an independent model before it ships. Computed, not generated.**

Built during the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026) · Indie track · solo build · public by default.

**Status: Day 0 — design committed; code begins Oct 27.** Progress lives in `DEV-LOG.md`.

---

## The problem

A wall cracks after monsoon. A ceiling stains. A bike gets knocked over. A tenant loses a deposit over "pre-existing damage" they can't prove.

- Insurance surveyors cost more than small claims are worth — most damage disputes never get professionally documented at all.
- Photos alone prove nothing: no scale, no measurements, no evidence chain, no reproducibility.
- The asymmetry is brutal: the insurer has adjusters and forms; the claimant has a phone and anger.

## What SnapClaim does

```
📷 damage photo (+ coin / ruler as scale reference)  +  🎙 one spoken line
   ↓
1 · SAM 3.1 — pixel masks for the damage ("crack", "stain", "peel", "dent")
   ↓
2 · DETERMINISTIC MATH — no LLM in the measurement
      damaged area ÷ component area → % damaged
      crack length via mask skeleton, × px→mm scale from the reference object
      no scale reference → report percentages and ratios only, clearly labeled
   ↓
3 · Muse Spark 1.3 — writes the annexure; every sentence must cite a
      measured number or the build FAILS (EvidenceError gate)
   ↓
4 · Spark Open (Baseten) — independent skeptic re-measures; findings it
      cannot reproduce are printed as DISPUTED, never hidden
   ↓
5 · Code-drawn SVG / PDF — red masks over the photo, receipts table,
      timestamped annexure, fully replayable
```

**The thesis:** a claim is an argument. Arguments need evidence — not a confident-sounding model.

## Meta models used

| Role | Model | Where |
|---|---|---|
| Perception — damage masks | **SAM 3.1** | `https://api.meta.ai/v1` |
| Reasoning — evidence-gated findings | **Muse Spark 1.3** | `https://api.meta.ai/v1/chat/completions` |
| Independent skeptic (open weights) | **Spark Open** | `https://inference.baseten.co/v1` · `meta-models/muse-spark-open-1026` |
| Voice intake (Hindi / Telugu / Hinglish code-switch) | **Muse Voice Transcribe** | `https://api.meta.ai/v1` |

No image generation anywhere: every visual is drawn in code from the masks and the math. (Muse Image is unavailable from India under Meta's Geographic Use Policy — the receipts pattern turns that constraint into a design principle.)

## Measurement rules (deterministic, documented)

- **With scale reference** (coin, ruler, known object): absolute values (mm / cm²) + percentages. Calibration constant is versioned in the report.
- **Without scale reference:** percentages and ratios only — labeled as such, never silently upgraded to absolute units.
- Severity bands are configurable and printed with their thresholds in the report. No hidden numbers.
- Every measurement is recomputable offline from the original photo + calibration metadata + the receipts file.

## Honest boundaries

- **Documentation, not advice.** No coverage decisions, no legal claims, no "you will be approved". A human decides; SnapClaim produces the evidence package.
- **Measurement ≠ causation.** The evidence chain proves *what was measured*, not *who broke it*.
- **Staged photos are a known limit.** Receipts make measurement replayable and manipulation detectable to a degree — they do not prove provenance beyond the capture context.
- No medical, health, or insurance-advice functionality of any kind.

## Evaluation plan

- **Fixtures:** real damage photos (with/without scale reference) + public damage-image datasets for CI.
- **Protocol:** the reasoning model receives only measured facts and the named evidence — never the raw photo alone; otherwise the benchmark measures vision reading comprehension, not the measurement pipeline.
- **Baselines:** (a) model-only qualitative estimate ("looks moderately damaged"), (b) no-measurement photo report. **The demo metric is the guessed-vs-measured gap** — the same pattern that made the best projects in this hackathon's server credible.
- **Held-out split** published before tuning; weak results printed, not buried.
- **Mock-mode CI:** all tests run offline against recorded responses — zero API spend; one live run recorded as a JSON artifact. Per-call spend guard in config.

## Demo video (3 minutes)

1. **0:00** A real crack on a real wall, phone in hand. "The surveyor comes next month. The deposit is due Friday."
2. **0:20** Snap → masks bloom → speak one Hinglish line → the annexure writes itself with green receipts. One finding flips **red**: the skeptic disputes the length estimate (scale marker occluded). Human correction → green. Co-signed.
3. **2:20** Receipts page: percentages, evidence table, held-out-dataset numbers vs baselines; `snapclaim replay` reconstructs the whole chain from the receipts file. Close: **"Computed, not generated — because a claim is an argument, and arguments need evidence."**

## Build plan

| Day | Date | Phase |
|---|---|---|
| 1 | Oct 27 | Paperwork (credits / Baseten / Modal), repo init, fixtures, photo intake checklist |
| 2–4 | Oct 28–30 | Deterministic core: masks → math → receipts; EvidenceError gate; mock-mode tests green |
| 4–5 | Oct 30–31 | Spark findings + Spark Open skeptic; real API path behind spend guard |
| 5–6 | Oct 31–Nov 1 | SVG/PDF annexure renderer + PWA capture flow |
| 6–7 | Nov 1–2 | Held-out evaluation runs; metrics page |
| 7–8 | Nov 2–3 | Polish, DEV-LOG review, record video, draft submission fields |
| 9 | Nov 4 | Submit (evening IST), X post |

## Scope cuts (pre-agreed)

No advice engine · no claim filing integrations · no accounts/backend state · no mobile-native app · no image generation · no more than two baselines. Ship the loop, prove the numbers.

## Tech stack

TypeScript everywhere · browser PWA (camera + voice capture) · Cloudflare Worker proxy (keeps keys off-device) · static deploy on Cloudflare Pages · zero-dependency ethos · code-drawn SVG the only renderer.

## Compliance guardrails

- Non-medical, non-advisory, no coverage/legal decisions.
- No geo-circumvention; no Muse Image (India geo-block); no VPN.
- Credits claimed only with the builder's own registration email; no pooling.
- Build-time tooling disclosed in `DEV-LOG.md`.

## License

Apache-2.0.
