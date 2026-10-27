# SnapClaim promo (30 s, 1080x1920, 30 fps)

Built with HyperFrames (`hyperframes@0.8.209`): one HTML composition (`index.html`), animation driven by a single paused GSAP timeline.

## Render

    npm install
    npm run render      # writes out/snapclaim-promo.mp4

Needs Node 22+ and ffmpeg. Fonts (Archivo, JetBrains Mono) are fetched and embedded by the renderer.

## Beats

- 0-3 s: drafting sheet, wall panel outline, "A wall cracks."
- 3-8 s: crack draws, red SAM 3.1 mask blooms, green 10-rupee coin with the 27 mm dimension line.
- 8-14 s: balloons R001 0.094077 mm/px, R002 5.17 %, R004 85.9 mm, with the calc lines.
- 14-19 s: writer sentence cites [R002] and [R004]; "about 12 cm long" is struck out (EvidenceError: no receipt); R005 severity thresholds.
- 19-24 s: Spark Open re-measures; R004 gets the DISPUTED hazard-stripe stamp (labelled illustrative).
- 24-30 s: logo, "Computed, not generated.", "Every number has a receipt.", footer.

All numbers come from the synthetic fixture engine output, not real claims.
