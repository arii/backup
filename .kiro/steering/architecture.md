# Posture Guard: Steering and Engineering Standards

## File headers and style
- Every newly created `.py` file starts with:
  ```
  # Author: Ariel Anders
  # Copyright (c) 2026 Ariel Anders. All rights reserved.
  ```
  Do not add or change headers on existing files; keep diffs free of churn.
- Type hints on all new and modified code. `requires-python >= 3.10`: use `X | None`.
- `ruff check .` must pass (line length 100, rules E, F, W, I, UP, B, SIM).

## Inputs and hardware
- **Webcam is the default input** (`camera.source: webcam`): `cv2.VideoCapture` +
  MediaPipe Pose (`mp.solutions.pose`, pinned `mediapipe>=0.10.14,<0.10.30`).
- **RealSense D400 is optional** (`--camera realsense`), color + aligned depth.
- **Synthetic is the no-camera mode** (`--camera synthetic`, and the fallback when a
  camera fails to open): scripted good/slouch poses for demos, CI and tests.
- Heavy imports (`cv2`, `mediapipe`, `pyrealsense2`) stay lazy, inside functions.
  Tests stub them; nothing in `tests/test_*.py` needs a camera or the SDKs.
- Frame sources never raise from `read()`: failures are `SourceStatus` states.

## Configuration
- **`config.yaml` is the single source of truth** for thresholds, dwell times,
  smoothing constants (EMA `tau_s`, baseline `window_s`), calibration windows and
  audio paths. They are read through the dataclasses in `config.py`. Never hardcode
  them in `scoring.py`, `state.py`, `posture_needle.py`, `calibration.py` or `audio.py`.
- A new parameter gets a `config.yaml` entry with a comment, a dataclass field with a
  default, and validation in `config.validate` when it has a valid range.
- Unknown keys and wrong-typed values raise `ConfigError` at startup. Do not loosen this.

## Time and state
- **Injected time.** `PostureStateMachine.update(result, now)`, the needle smoother,
  the baseline and the calibration recorder take `now: float` from frame timestamps.
  Never call `time.time()` / `time.monotonic()` in scoring, state, needle or
  calibration logic. (Frame sources may stamp frames with the monotonic clock.)
- **Frame-rate independence.** Any EMA uses `alpha = 1 - exp(-dt / tau)`, never a
  per-frame constant. Windows must work at 2 fps and with jittered timestamps.
- **Glitches hold state.** `UnreliableReason.NON_FINITE` (NaN/inf landmarks) leaves
  every streak, timer, the baseline and calibration untouched.

## Audio
- Playback goes through `AudioWorker`'s queue; `enqueue()` never blocks the
  pipeline. `paplay` first, `aplay` fallback, and a missing player is a status.
- Custom sounds (`audio.bad_sound`, `audio.good_sound`) fall back to the built-in
  chimes with a logged warning when the file is missing.

## Privacy
- Frames and landmarks never leave the machine. The dashboard binds to
  `127.0.0.1` by default. Calibration lives in memory only.

## Testing
- `pytest` for unit and timeline tests; `hypothesis` for the correctness properties
  in `.kiro/specs/posture-guard/design.md` (`tests/test_properties.py`). No
  `@pytest.mark.skip` on property tests; no `assume()`-heavy strategies that trip
  health checks.
- New behavior in `scoring.py`, `state.py`, `posture_needle.py` or `calibration.py`
  needs a property or timeline test.
- CI (`.github/workflows/ci.yml`) runs lint + the full suite on every branch.
