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

## Inputs
- **The browser version is the primary product** (`docs/app/`, GitHub Pages). The
  Linux desktop app has the same behavior and serves offline use.
- **Webcam is the only camera** (`camera.source: webcam`): `cv2.VideoCapture` +
  MediaPipe Pose (`mp.solutions.pose`, pinned `mediapipe>=0.10.14,<0.10.30`) on the
  desktop, tasks-vision PoseLandmarker in the browser. Depth cameras were removed;
  distance comes from the shoulder-width framing gate.
- **Synthetic is the no-camera mode** (`--camera synthetic`, and the fallback when the
  webcam fails to open): scripted good/slouch poses for demos, CI and tests.
- Heavy imports (`cv2`, `mediapipe`) stay lazy, inside functions.
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

## Browser port
- `docs/app/posture-core.js` mirrors the Python core. Any behavior change in
  `scoring.py`, `state.py`, `posture_needle.py`, `calibration.py` or the pipeline frame
  path must be made in both, then `python tests/browser_golden.py` regenerates the
  golden timeline and `node --test "tests/js/*.test.mjs"` must pass.
- New `config.yaml` defaults must be copied into `DEFAULTS` in `posture-core.js`
  (the JS test compares them).

## Privacy
- Frames and landmarks never leave the machine. The dashboard binds to
  `127.0.0.1` by default. Calibration lives in memory only.
- The browser app is self-hosted: the MediaPipe runtime, WASM and pose model live in
  `docs/app/vendor/` (versions and sha256 in its README, Apache-2.0 LICENSE alongside).
  `docs/app/index.html` carries a meta CSP limiting everything to `'self'`. Do not add a
  third-party origin without updating the CSP, `docs/privacy.html` and the live-site
  e2e check that asserts no cross-origin requests.

## Testing
- `pytest` for unit and timeline tests; `hypothesis` for the correctness properties
  in `.kiro/specs/posture-guard/design.md` (`tests/test_properties.py`). No
  `@pytest.mark.skip` on property tests; no `assume()`-heavy strategies that trip
  health checks.
- New behavior in `scoring.py`, `state.py`, `posture_needle.py` or `calibration.py`
  needs a property or timeline test.
- CI (`.github/workflows/ci.yml`) runs lint + the full suite on every branch.

## Safety and claims
- Posture Guard is a wellness tool. No copy, spec or code comment may claim to
  diagnose, treat, prevent or cure a condition, or that it improves health outcomes.
  Do not call the research "proof" or the app "clinically validated".
- The safety notice text lives in one place (`SAFETY_SHORT` and `SAFETY_POINTS` in
  `docs/app/onboarding.js`). Reuse it; keep README, landing page and `docs.html`
  consistent with it. Changing its meaning means bumping `ACK_VERSION` so users are
  asked again. Bumping `ONBOARDING_VERSION` or `ACK_VERSION` also means updating the
  hard-coded values in `tests/e2e/live-site.mjs` and `video/scripts/capture.mjs`.
- The disclaimer wording is a draft and not legal advice. A lawyer reviews it before a
  wider launch.

## Feedback design
- Follow `docs/research/feedback-and-habit-formation.md` and
  `.kiro/specs/feedback-design/`: cues are specific and task-focused, praise is opt-in
  and earned, no shaming or streak-loss messages, no punishing sounds, no sound during
  pause or the silent test, and an hourly reminder cap.
- Do not edit spoken strings in `docs/app/voice-lines.js` without re-rendering the
  clips with `scripts/render-voice.mjs`. New text without a clip falls back to robotic
  speech synthesis.
- Browser-only helper modules (`relax.js`, `onboarding.js`, `progress.js`,
  `feedback.js`) stay pure: no DOM, injected time, with a matching test in `tests/js/`.
- Label each new feature as implemented or spec only in the docs. Cite a source as
  verified only if its abstract or page text was read.
