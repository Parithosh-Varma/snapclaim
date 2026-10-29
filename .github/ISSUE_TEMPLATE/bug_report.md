---
name: Bug report
about: Report a reproducible problem in measurement, gate, render, or API
title: "[bug] "
labels: bug
assignees: ""
---

## Description
<!-- A clear, concise description of what went wrong. -->

## Reproduction steps
1.
2.
3.

## Expected vs actual
<!-- Expected measurement/gate/render output vs what you got. Paste the response envelope fields: ok, code, requestId, details. -->

```
```

## Environment
- Mode (`GET /v1/health` → mode): <!-- mock / live / config-error -->
- Commit / version:
- Node version: <!-- >= 22.18 required -->
- Command or route: <!-- e.g. POST /v1/report, npm run eval, pwa flow -->
- Fixture (if any): <!-- e.g. fixtures/masks/wall-crack.json -->

## Evidence / replay
<!-- If measurement-related: attach request.json + measurement.json or run: npm run replay -- request.json measurement.json → MATCH or DRIFT? -->

## Additional context
<!-- Logs, screenshots of the SVG annexure, thresholds used. No secrets, photos, or PII. -->
