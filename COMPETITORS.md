# SnapClaim vs the field — a comparison judges can verify

Thesis: the hackathon produced a small **rigor school** — projects that measure
instead of guess, cite instead of assert, refuse instead of bluff. SnapClaim is
its most complete member. This page proves that with each project's own public
statements, all sourced from the two Discord exports in `fixtures/` (see
`leaderboard.md` for the full catalog).

Legend: ✅ stated publicly · ➖ not stated in anything they posted · ❌ stated
absence (they say they don't do it). "Not stated" is not an accusation — it
means a judge cannot verify it from their materials.

## The rigor school head-to-head

| | **SnapClaim** | SproutVision (Crop Scout) | CourtSense | Quetzal AOI Briefing | Ithaca | QorTime |
|---|---|---|---|---|---|---|
| Builder | SnapClaim team | Farrah (FandomGames), solo Indie | Alperen, solo | Xava | Halo, solo | Contravious, first hackathon |
| Photo/video in, trustworthy number out | ✅ crack % / mm / cm² from masks | ✅ tray coverage = plant mask ÷ tray mask | ✅ player positions → metres | ➖ (seismic polygons, briefing) | ✅ minutes + won counted | ✅ rule checks pass/fail |
| Scale reference stated | ✅ coin (27 mm) + ruler gate; percent-only without one | ➖ (ratio — scale-free by construction) | ✅ 4-click court calibration | ➖ | ➖ (counts from schedules) | ➖ |
| Measured-vs-guess eval published | ✅ human 7% vs measured **1.12%** (off 6×, wrong band) | ✅ guessed 35% (Spark AND Gemini) vs measured **54/51%** vs eye 70% | ✅ ±0.1 m near player, rougher far — **stated, marked** | ➖ | ➖ | ➖ |
| Human baseline included | ✅ blind pre-registered guesses | ✅ author's own eye (70%) | ➖ | ➖ | ➖ | ➖ |
| Refusal behavior stated | ✅ percent-only, no mm invented (verified on 4 real photos) | ✅ SAM-off fallback flagged with "clear note"; cost-cap fallback | ✅ marks rough values instead of pretending | ➖ | ➖ | ➖ |
| Receipts per number | ✅ one-mask rule, per-unit backing, replay MATCH | ✅ verdict trace: models, coverage, timestamp, SHA-256 | ✅ every number checked against data | ✅ measured/computed/inferred labels + receipt | ✅ ground-truth checklist | ✅ signed receipt page, public |
| Deterministic core (model never emits the number) | ✅ measure in code; Spark drafts, gate vets (422s live) | ✅ coverage arithmetic in code | ✅ rule-based movement data | ✅ Rules Adherence Agent gates commits | ✅ "numbers never come from the model" | ✅ "the AI only explains" |
| Live backend + tests | ✅ Worker v0.3.0 live, 121/121 tests, tsc clean | ✅ repo public, 241 tests, in-headset verified | ✅ demo + repo | ✅ repo, day-1 updates | ✅ repo | ✅ demo + repo |
| Failure modes published | ✅ 3/4 single-tap masks = wall; CPU-cap 503s documented | ✅ 15–25% literal = full tray (definitional, closed) | ✅ net hides feet → rougher far values | ➖ | ➖ | ➖ |

## The damage-assessment lane (same starting photo, less rigor stated)

| Project | Builder | What they claim | Missing vs SnapClaim |
|---|---|---|---|
| **Snapdesk** | Ruthwik | Damage photo → SAM finds + measures → refund/replace/repair | No scale reference, no eval, no receipts stated |
| **SnapPart** | Bibek + Bhashwati | Photo + **coin** → sub-mm → STL | Coin stated ✅, but no eval numbers, no refusal behavior |
| **LoadMaster** | Ryan Cotten | Trailer photo → SAM → securement verdict | No scale, no eval |
| **AI Fixit** | David Ch | Broken-thing photo → action plan | No measurement stated at all |
| **VergeCare** | Phil | Property repair film → snag list + tracker | Newest post (10-31); no rigor details yet |
| **ClimateGuard** | Khoa | Damage photos + checklist; demo + repo | Ships, but no measurement numbers |
| **SiteSense** | Barbara Ackles | Drone/phone → severity work order; refuses to claim unseen gas | Refusal culture ✅; no eval |
| **S3baS road auditor** | Mateo | SAM hazards + before/after verify | No eval |
| **Topo agent** | Yuzuki Kondo | Snap + tap → SAM outlines; **14% → 100% recall** | Has a real recall number ✅ and repo; different domain (climbing) |

## Why "most complete" is a fair claim

1. **Only SnapClaim has all four:** a scale gate, a human baseline, a published miss (3/4 wrong masks), and a deterministic refusal — each verified against a live backend, not a slide.
2. **SproutVision is the Kutuzov test we pass:** it has the triad (guess/measure/eye) and 241 tests, but no scale gate and no refusal doctrine — ratios let it dodge the mm question entirely. Ours answers it: percent-only, on the record, across 4 real photos.
3. **CourtSense states error bands; we state error causes.** ±0.1 m is honest reporting; documenting *why* single-tap masks fail and what the pipeline does about it (smallest-candidate, cross-check, narrowing) is the next layer. Both are rare; only one is ours.
4. **The school validates the thesis.** Five independent teams converged on receipts and deterministic numbers. Judges deciding "is this direction real?" can see the answer is yes — five times over — and then ask who executed it most completely.

## Honest gaps (ours, printed plainly)

- No ruler-photo calibrated eval yet (Evidence 8/10, path to 9 is documented in `docs/eval-report.md`).
- No 3-minute demo video yet (Works 8.5/10).
- Total live-API spend to date: ≈$0.04. (Frugality is a feature: the whole benchmark cost less than a coffee.)

## Sources

- `fixtures/intros-discord-20261031-1031.json` (1,733 msgs) and `fixtures/intros-discord-20261031-1021.json` (30 msgs) — #intros
- `fixtures/build-for-your-world-discord-20261031-1559.json` (1,162 msgs) — #build-for-your-world
- `leaderboard.md` — full project catalog with per-entry provenance
- `docs/eval-report.md`, `snapclaim-benchmark.md` (§1g) — our numbers, misses included
