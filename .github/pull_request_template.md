## Summary
<!-- What does this change and why? Link the issue: Closes #NNN. -->

## Changes
-
-

## Verification

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run eval` passes (or explain SKIP-only delta)
- [ ] `npm run backend:smoke` passes (required if backend/routes/providers touched)

## Evidence-gate / replay (check all that apply)
- [ ] Not measurement-related (no gate/render/receipt impact)
- [ ] `npm run replay -- request.json measurement.json` → MATCH
- [ ] New/changed bench case includes `fixtures/expected/` output
- [ ] No LLM touches numbers; no invented masks/transcripts; fail-closed preserved

## Risk and rollback
<!-- Spend/limits impact, live vs mock behavior, how to revert. -->
