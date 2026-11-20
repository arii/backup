#!/usr/bin/env bash
# Renders the video's sounds into public/audio: the app's own two chimes
# (scripts/make-chimes.mjs) and the spoken cue (espeak-ng). Run from video/.
set -euo pipefail

node scripts/make-chimes.mjs
espeak-ng -s 150 -w public/audio/cue.wav \
    "Head forward. Tuck your chin and bring your ears back over your shoulders."
ls -la public/audio
