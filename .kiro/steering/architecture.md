# Posture Guard: Steering and Engineering Standards

## File headers and style
- Every newly created `.py` file starts with:
  `# Author: Ariel Anders`
  `# Copyright (c) 2026 Ariel Anders. All rights reserved.`
  Do not add headers to existing files; keep diffs free of churn.
- Use type hints on all new and modified code (`requires-python >= 3.10`, so use `X | None`, not `Optional`).
- Lint with `ruff check .`; test with `pytest` (`make lint`, `make test`).

## Repository conventions
- **`config.yaml` is the single source of truth.** Thresholds, durations, and smoothing parameters are read through `config.py` dataclasses. Do not hardcode them in `scoring.py`, `state.py`, or `audio.py`. New parameters get a `config.yaml` key, a dataclass field, and a default.
- **Deterministic time.** `state.py` receives timestamps (`now: float`) from the caller. Never call `time.time()` or `time.monotonic()` inside state or scoring logic.
- **Hardware-optional.** The synthetic frame source must keep working so tests, CI, and the dashboard run without a RealSense. Heavy imports (`pyrealsense2`, `mediapipe`, `cv2`) stay lazy.
- **Audio never blocks capture.** Playback goes through the `AudioWorker` queue in `audio.py`.
- **Tests.** `pytest` for unit and timeline tests. `hypothesis` (add to the `dev` extra) for property-based tests of `scoring.py` and `state.py`.
