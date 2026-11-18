#!/usr/bin/env bash
# Renders the video's sounds into public/audio: the app's own two chimes
# (synthesized by src/posture_guard/audio.py) and the spoken cue (espeak-ng,
# the desktop app's fallback voice). Run from video/.
set -euo pipefail

mkdir -p public/audio
PYTHONPATH=../src python3 - <<'PY'
from pathlib import Path

from posture_guard.audio import _render_chime, _render_positive_chime

_render_chime(Path("public/audio/chime.wav"))
_render_positive_chime(Path("public/audio/positive.wav"))
PY
espeak-ng -s 150 -w public/audio/cue.wav \
    "Head forward. Tuck your chin and bring your ears back over your shoulders."
ls -la public/audio
