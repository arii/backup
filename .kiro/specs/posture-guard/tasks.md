# Implementation Plan: Posture Guard

- [x] 1. Strict configuration
  - `ConfigError` for unknown keys (full key path) and wrong types; `validate()` for
    ranges and `camera.source`. New sections: `needle`, `calibration`,
    `feedback.recovery_chime`, `audio.bad_sound/good_sound`, `camera.source/device/
    demo_cycle_s`, `scoring.shoulder_width_min/max`. Tests: `tests/test_config.py`.
  - _Requirements: 7_
- [x] 2. Webcam input (default) with RealSense and synthetic modes
  - `webcam.py` (`WebcamFrameSource`), color-only `ColorDepth`, `--camera` / `--device`
    CLI, synthetic fallback with reason, scripted synthetic demo with real-time pacing,
    `[webcam]` / `[realsense]` extras, preflight webcam check, smoke check for cv2.
    Tests: `tests/test_webcam.py`, `tests/test_serve.py`.
  - _Requirements: 1_
- [x] 3. Frame hardening in `scoring.py`
  - `NON_FINITE`, `FRAMING_OUT_OF_BAND`, `depth_sensor=False` framing gate, optional
    depth on `ScoredPosture`. Tests: `tests/test_scoring.py`.
  - _Requirements: 1.5, 2_
- [x] 4. State machine fixes in `state.py`
  - Glitch hold, smoothing-window boundary sample (low fps / jitter), `recovered` flag,
    `Nudge.RECOVERY`, baseline anchor; exponential baseline decay in `scoring.py`.
    Tests: `tests/test_state.py`.
  - _Requirements: 2.2, 3_
- [x] 5. Posture needle
  - `posture_needle.py`, pipeline publication, gauge uses the server value.
    Tests: `tests/test_posture_needle.py`, `tests/test_pipeline.py`.
  - _Requirements: 4_
- [x] 6. Relative calibration
  - `calibration.py`, `/calibrate` endpoints, baseline anchoring, dashboard buttons.
    Tests: `tests/test_calibration.py`, `tests/test_pipeline.py`, `tests/test_dashboard.py`.
  - _Requirements: 5_
- [x] 7. Good / bad sounds and player fallback
  - Custom WAVs, recovery cue, `/sound/test/{good,bad}`, `aplay` fallback.
    Tests: `tests/test_audio.py`, `tests/test_dashboard.py`.
  - _Requirements: 6_
- [x] 8. Property-based tests
  - `tests/test_properties.py`: P1-P6 from design.md, plus mutation checks.
- [x] 9. Kiro hook, CI and docs
  - `.kiro/hooks/pytest-on-change.json`; CI runs on branches with `/`; README.
- [x] 10. Browser version on GitHub Pages (`docs/app/`)
  - `posture-core.js` port, `app.js` shell (webcam, MediaPipe tasks-vision, Web Audio,
    speech, hidden-tab worker ticks, localStorage), landing-page link.
  - Golden parity: `tests/browser_golden.py` -> `tests/fixtures/browser_golden.json`,
    `tests/js/posture-core.test.mjs`, `tests/test_browser_golden.py`; CI `browser-core` job.
  - _Requirements: 8_
