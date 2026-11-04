# Terrace-slab crack — first tape ground truth (2026-11-02)

| | |
|---|---|
| Straight-tape chord | **227 mm** (range 225-230) — crack spans ~127 cm to ~149.5–150 cm on the tape. A path must exceed its chord: context only, not path accuracy |
| Pin-to-pin path | **274 mm** polyline (6 spans 5.2 + 4.8 + 4.5 + 4.2 + 2.9 + 5.8 cm) — closest path-length truth. Pins cover the full parapet including edge zones outside the tape segment, so part of the gap may be extent |
| Pipeline measured | **237.5 mm** [R005], Ref SC-25D35C5E at the confirmed 25 mm coin — 10.5 mm over the chord (+4.6%, chord is context, never scored) and 36.5 mm under the pin path (-13.3%, reads low) |
| Second run | **232 mm** [R005], Ref SC-D8ECE64B (2026-11-04, different photo/date) — 42 mm low vs pin path (-15.3%, also low). Labeled separately, never conflated |
| Coin correction (4 Nov) | The Rs 2 coin is 25 mm (user-supplied, confirmed). The 218.5 mm figure in `SC-25D35C5E-report.md` came from a wrong 23 mm coin and is void; the report is kept as generated, not rewritten. Same as `docs/eval-report.md` (2026-11-04 row) and `tests/terrace-25mm.test.ts` |
| Thread 238.8 mm | Different horizontal crack, no coin — **not comparable, excluded** |
| Spark photo-alone guess | **315 mm** — 88 mm high vs chord (+38.8%, outside), 41 mm high vs pin path (+15.0%, outside - reads high) |
| Bench case | `terrace-slab-tape-01` (`bench/split.json`, run in `bench/runs/`, guess in `bench/model-only/`) |

Files: `DSC_0711.JPG` (coin + tape in frame), `DSC_0710.JPG` (same crack, coin only — the guess photo), `web-*` (1600px versions for pages), `SC-25D35C5E-report.md` (full report text: measurements, receipts R001–R007, ground-truth check).
