#!/bin/sh
# Render one video (or all) to out/<name>.mp4, then build its audio versions.
#   sh render.sh 01-pov-landlord        sh render.sh all
# Each video folder is its own HyperFrames project, so the shared lib/ and
# assets/ are copied in first (those copies are git-ignored).
set -e
cd "$(dirname "$0")"
mkdir -p out
names="$1"
[ "$names" = "all" ] && names=$(cd videos && ls -d */ | tr -d /)
for n in $names; do
  d="videos/$n"
  rm -rf "$d/lib" "$d/assets"
  cp -r lib "$d/lib"
  cp -r assets "$d/assets"
  npx hyperframes render "$d" -q delivery -o "out/$n.mp4" --quiet
  python sfx/make.py "$n" ${MUSIC:+--music "$MUSIC"} ${MUSIC_START:+--music-start "$MUSIC_START"}
done
