# Fixtures

Two different jobs live here:

1. **Engine fixtures** (`masks/`, `scale/`) — synthetic mask statistics used by the unit tests. Deterministic, no API calls. These are what CI runs against.
2. **Photo intake** (`photos/`, gitignored until we decide what is publishable) — real damage photos used to sanity-check the vision path and to record the demo.

## Photo checklist (3–5 photos, ~20 minutes)

For each photo:

- [ ] The damage is the subject and fills a reasonable part of the frame.
- [ ] **A scale reference is in the same plane as the damage** — a coin taped beside the crack works better than a coin held in the air. A ruler is ideal.
- [ ] One straight-on shot and one slightly angled shot, so perspective error is visible rather than hidden.
- [ ] Diffuse light; no hard flash blowing out texture.
- [ ] Record the surface type (wall / ceiling / tile / wood / metal) in the filename or a note.
- [ ] Nothing personal in frame — no documents, faces, or identifying objects.

Do **not** stage or exaggerate damage. The point of the demo is that the pipeline is honest about what it can and cannot measure.

## Public datasets

Used for volume testing only, not for the demo's headline claim:

- crack / concrete defect image sets (e.g. SDNET2018-style crack classification sets)
- building facade defect datasets
- general property-damage photo sets

Any dataset used in evaluation gets cited in `docs/eval-report.md` with its license and the exact split.
