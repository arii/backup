#!/usr/bin/env bash
# BackUp setup for a clean Ubuntu/Debian-family Linux desktop.
#
# 1. Installs system packages (PulseAudio/PipeWire client tools, TTS, ffmpeg).
# 2. Creates a Python venv and installs posture-guard with the webcam extra.
# 3. Prints a preflight report: webcam, audio sinks, TTS renderability.
#
# Re-run at any time; every step is idempotent.

set -euo pipefail

cd "$(dirname "$0")"

# --- 1. System packages ------------------------------------------------------
# pulseaudio-utils provides pactl/paplay (works under PulseAudio and the
# PipeWire compatibility layer). libttspico-utils provides the pico2wave
# binary (the preferred TTS engine); it lives in Ubuntu's multiverse and
# Debian's non-free component. espeak-ng is the fallback the audio worker
# uses when pico2wave is absent.
if command -v sudo >/dev/null 2>&1; then
    SUDO=sudo
else
    SUDO=""
fi

echo "==> Installing system packages"
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    libpulse0 pulseaudio-utils ffmpeg libttspico-utils espeak-ng \
    || $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    libpulse0 pulseaudio-utils ffmpeg espeak-ng

# --- 2. Python environment ---------------------------------------------------
echo "==> Creating venv and installing Python dependencies"
python3 -m venv .venv
# shellcheck disable=SC1091  # venv activate only exists after setup runs
. .venv/bin/activate
pip install --quiet --upgrade pip
# webcam extra pulls opencv-python + mediapipe; dev adds pytest/ruff/hypothesis so
# `make test` works on the same box.
pip install --quiet -e '.[webcam,dev]'

# --- 3. Hardware preflight report -------------------------------------------
echo
echo "==> Preflight report"
.venv/bin/python - <<'PY'
"""Preflight checks: webcam, audio sinks, TTS."""

import shutil
import subprocess
import tempfile
from pathlib import Path


def mark(ok: bool) -> str:
    return "PASS" if ok else "FAIL"


print("-" * 62)

# Webcam (the default input): open device 0 and read one frame.
webcam_ok, webcam_note = False, "not checked"
try:
    import cv2

    cap = cv2.VideoCapture(0)
    try:
        if cap.isOpened():
            ok, frame = cap.read()
            webcam_ok = bool(ok) and frame is not None
            webcam_note = (
                f"device 0, {frame.shape[1]}x{frame.shape[0]}" if webcam_ok else "opened, no frame"
            )
        else:
            webcam_note = "device 0 did not open"
    finally:
        cap.release()
except Exception as exc:  # noqa: BLE001 — report, never crash, the preflight
    webcam_note = str(exc).strip().splitlines()[0] if str(exc).strip() else "unknown error"
print(f"webcam ....................... {mark(webcam_ok)}   ({webcam_note})")

# Audio sinks via pactl (PulseAudio or PipeWire's pipewire-pulse).
sinks: list[str] = []
if shutil.which("pactl") is None:
    print("audio sinks .................. FAIL   (pactl not found — is pulseaudio-utils installed?)")
else:
    try:
        out = subprocess.run(
            ["pactl", "list", "short", "sinks"], capture_output=True, text=True, timeout=10
        )
        sinks = [line.split("\t")[1] for line in out.stdout.splitlines() if line.strip()]
        if sinks:
            print(f"audio sinks .................. PASS   ({', '.join(sinks)})")
        else:
            print("audio sinks .................. FAIL   (no sinks — is the audio server running?)")
    except (subprocess.SubprocessError, OSError) as exc:
        print(f"audio sinks .................. FAIL   ({exc})")

# TTS: pico2wave preferred, espeak-ng fallback — actually render a WAV.
tts_engine = shutil.which("pico2wave") or shutil.which("espeak-ng")
tts_ok = False
if tts_engine is None:
    print("TTS renderable ............... FAIL   (neither pico2wave nor espeak-ng found)")
else:
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav:
            wav_path = wav.name
        subprocess.run(
            [tts_engine, "-w", wav_path, "test"], capture_output=True, timeout=30, check=True
        )
        tts_ok = Path(wav_path).stat().st_size > 0
    finally:
        Path(wav_path).unlink(missing_ok=True)
    print(f"TTS renderable ............... {mark(tts_ok)}   ({Path(tts_engine).name})")

print("-" * 62)
print("Next: open the README 'Desktop runbook' section and follow it step by step.")
PY

echo
echo "Setup complete. Activate the venv with:  . .venv/bin/activate"
echo "Serve the dashboard with:                make run"
