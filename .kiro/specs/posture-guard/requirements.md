# Requirements Document: Posture Guard

## Introduction
Posture Guard is a local posture monitor. It reads a standard webcam by default
(optionally an Intel RealSense D400, or a synthetic demo stream), runs MediaPipe Pose,
scores head and shoulder geometry, and reminds the user with a chime and then a spoken
prompt through `paplay`. A FastAPI dashboard on `127.0.0.1` shows the live skeleton,
metrics, a posture needle, and the calibration and sound controls.

## Requirements

### Requirement 1: Camera input
**User Story:** As a user or hackathon judge, I want Posture Guard to run with the
laptop webcam I already have, with RealSense and a no-camera demo as options.

#### Acceptance Criteria
1. THE System SHALL use `cv2.VideoCapture(camera.device)` + MediaPipe Pose by default (`camera.source: webcam`).
2. WHEN `--camera realsense` or `camera.source: realsense` is set, THE System SHALL read aligned color and depth from a RealSense D400.
3. WHEN `--camera synthetic` is set, OR the selected camera fails to open, THE System SHALL run the synthetic source with scripted good/slouch poses alternating every `camera.demo_cycle_s`, and SHALL show the fallback reason on the dashboard and in the log.
4. WHEN a webcam stops delivering frames, THE System SHALL reopen it and report the state on the dashboard, without raising.
5. WHEN the camera has no depth sensor, THE System SHALL replace the depth band with a framing gate: shoulder width outside `[scoring.shoulder_width_min, scoring.shoulder_width_max]` of the frame width is reported as too far / too close.

### Requirement 2: Frame hardening
**User Story:** As a user, I want tracking glitches to be ignored, so a bad frame never
triggers or cancels a reminder.

#### Acceptance Criteria
1. WHEN any ear or shoulder coordinate is NaN or infinite, or a metric overflows, THE System SHALL return `Unreliable(NON_FINITE)` instead of a score.
2. WHEN a frame is `NON_FINITE`, THE state machine SHALL hold its previous state and SHALL NOT change any streak, timer, baseline or calibration.
3. WHEN hip coordinates are non-finite and degraded feedback is on, THE System SHALL score the remaining metrics and mark trunk lean unavailable.
4. WHEN depth is NaN or infinite (RealSense), THE System SHALL treat it as unreadable.
5. WHEN ears or shoulders fall below `scoring.visibility_floor`, THE System SHALL report `LOW_VISIBILITY` (state `UNRELIABLE`), drop the bad streak, and keep the baseline and calibration.

### Requirement 3: Smoothing and reminders
**User Story:** As a user, I want reminders only after sustained bad posture, at any
frame rate, so small movements never cause chatter.

#### Acceptance Criteria
1. THE state machine SHALL take `(result, now)` with injected timestamps and read every timing from `config.yaml` (`state.*`).
2. THE smoothing window SHALL keep its boundary sample, so GOOD and reminders confirm at frame rates down to 2 fps and with jittered timestamps.
3. WHEN bad posture is sustained for `state.bad_sustain_s`, THE System SHALL emit exactly one `CHIME` for that bad episode.
4. WHEN posture is not corrected `voice_delay_s` after the chime, THE System SHALL emit `VOICE`, repeating no sooner than `voice_repeat_cooldown_s`.
5. WHEN posture recovers to GOOD after a reminder, THE transition SHALL carry `recovered=True` exactly once, AND IF `feedback.recovery_chime.enabled` THE System SHALL play the good sound once.
6. Every EMA (needle, deviation baseline) SHALL use `alpha = 1 - exp(-dt / tau)` so convergence depends on elapsed time, not frame count.

### Requirement 4: Posture needle
**User Story:** As a user, I want one smooth number for how close I am to bad posture.

#### Acceptance Criteria
1. THE System SHALL publish `needle.value` in `[-1.0, 1.0]` on the `/ws` payload: -1 upright, +1 at the thresholds (or at the recorded slouch once calibrated).
2. FOR ANY input, including NaN/inf landmarks, THE needle SHALL be `None` (before the first scored frame) or a finite float in `[-1, 1]`.
3. THE needle SHALL be smoothed with time constant `needle.tau_s` and SHALL hold its value through unscoreable frames.

### Requirement 5: Relative calibration
**User Story:** As a user, I want to record my good and slouched posture so the needle
and the deviation check fit my desk.

#### Acceptance Criteria
1. WHEN the user presses "Record good posture" (`POST /calibrate/good`), THE System SHALL average the scored frames over `calibration.window_s` (frame clock) into a good centroid, AND SHALL anchor the deviation baseline to it.
2. WHEN the user presses "Record slouch posture" (`POST /calibrate/bad`), THE System SHALL store a slouch centroid; with both recorded THE needle SHALL project onto the good-to-slouch axis.
3. WHEN fewer than `calibration.min_samples` frames are scored in the window, OR the two centroids are identical, THE System SHALL report an error and keep the threshold mapping.
4. THE baseline anchor SHALL survive NO_PERSON resets. `DELETE /calibrate` SHALL clear everything.
5. Calibration SHALL stay in memory; no frame or landmark leaves the machine.

### Requirement 6: Good and bad sounds
**User Story:** As a user, I want to use my own sounds and preview them.

#### Acceptance Criteria
1. `audio.bad_sound` SHALL replace the reminder chime; `audio.good_sound` SHALL replace the positive and recovery chime.
2. WHEN a configured file does not exist, THE System SHALL log a warning, list it in the audio status, and use the built-in sound.
3. `POST /sound/test/{good,bad}` SHALL play the sound, returning 409 when nothing is playable.
4. WHEN `paplay` cannot be launched, THE System SHALL fall back to `aplay`; with no player it SHALL report the error and keep running.

### Requirement 7: Configuration
1. Unknown keys and wrong-typed values in `config.yaml` SHALL raise `ConfigError` naming the full key path.
2. `camera.source` SHALL be one of `webcam`, `realsense`, `synthetic`; invalid ranges (`shoulder_width_min >= shoulder_width_max`, `calibration.window_s <= 0`, ...) SHALL be rejected.
3. CLI flags `--camera` and `--device` SHALL override `config.yaml`.

### Requirement 8: Browser version (GitHub Pages)
**User Story:** As a user, I want to open a web page, leave the tab open, and be
coached to better posture with nothing to install.

#### Acceptance Criteria
1. `docs/app/` SHALL run on GitHub Pages: webcam via `getUserMedia`, MediaPipe Pose Landmarker (tasks-vision, VIDEO mode), and a demo mode with no camera.
2. Scoring, the state machine, the needle and calibration SHALL be a port of the Python modules (`docs/app/posture-core.js`) and SHALL match the Python pipeline frame-for-frame on the golden timeline (states, reminders, reasons exactly; numbers within 1e-9).
3. WHEN the tab is hidden, THE page SHALL keep tracking (worker-driven ticks, about 5 fps) and keep reminding.
4. Audio SHALL start only inside a user gesture; chimes use Web Audio, the prompt uses speech synthesis; custom good/bad sounds can be picked from files.
5. Video and landmarks SHALL never leave the browser; calibration, settings and daily totals persist in `localStorage`.
