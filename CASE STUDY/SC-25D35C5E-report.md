# SnapClaim — Ref SC-25D35C5E - Measured damage report

Generated 2 Nov 2026 - 1 finding: "crack above the slab"

## Measurements

| | | |
|---|---|---|
| Crack length | 218.5 mm [R005] | Confirmed |
| Crack width | 3 mm [R006] | Confirmed |
| Surface affected | 0.73 % [R002] | Confirmed |
| Area | 6.51 cm2 [R004] | Confirmed |
| Severity | significant [R007] | Confirmed |

## Method

Outlines measured from photo pixels, scaled by the coin diameter (tilt-corrected from
its ellipse). Every number cites its evidence receipt.

## Verification

Evidence gate: passed - Independent skeptic: not run on this archived run (skeptic checks prose from receipts, not segmentation - wrong masks fool it) - Mask cross-check: not archived here; auto-runs in the app Check screen (SlimSAM-vs-SAM, required before Report) as the real segmentation check

## Figures

- Figure 1 - captured photo, full frame: `DSC_0710.JPG` (same crack as `DSC_0711.JPG`, coin only)
- Figure 2 - measured outlines (red damage, green coin scale, from the evidence):
  annexure v0.3.0, mode ABSOLUTE (calibrated), generated 2026-11-02T12:24:12.229Z,
  transcript "crack above the slab"

### Receipts (7)

- R001 scale_calibration 0.712074 mm_per_px — knownMm / referenceLengthPx
- R002 area_ratio 0.73 percent — damageAreaPx / componentAreaPx * 100
- R003 region_count 1 count — count of disconnected mask components
- R004 calibrated_area 6.51 cm2 — damageAreaPx * mmPerPx^2 / 100
- R005 calibrated_length 218.5 mm — skeletonPx * mmPerPx
- R006 calibrated_width 3 mm — damageAreaPx / skeletonPx * mmPerPx
- R007 severity_classification significant band — area ratio + calibrated length + region count vs printed thresholds

Computed, not generated. Replay from request + receipts.
Every number must cite a receipt id or the gate fails.

## Ground-truth check (added 2026-11-02, corrected 2026-11-04)

Tape chord 227 mm (`DSC_0711.JPG`) vs measured 218.5 mm → 8.5 mm low (-3.7%, inside on the chord).
Pin-to-pin path 274 mm (6 spans, closest path truth) vs measured 218.5 mm → 55.5 mm low (-20.3%, outside - pipeline reads low). Second run SC-D8ECE64B 232 mm → 42 mm low vs pin path (-15.3%, also low), labeled separately. Thread 238.8 mm was a different crack with no coin - excluded.
Spark photo-alone guess 315 mm → 88 mm high vs chord (+38.8%, outside), 41 mm high vs pin path (+15.0%, outside). Bench case `terrace-slab-tape-01`. No "+X% vs span" figure is claimed as path accuracy: a path must exceed its chord.
