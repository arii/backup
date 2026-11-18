# Requirements Document: Posture Guard

## Introduction
Posture Guard is a Linux desktop posture corrector. It reads color and depth from an Intel RealSense D400 camera (or a synthetic frame source), scores head and trunk geometry from MediaPipe Pose landmarks, runs a timed state machine, and nudges the user with a chime and then a spoken prompt through `paplay`. A FastAPI dashboard shows the live skeleton and metrics.

Each requirement is marked **[existing]** (behavior in the repo to be verified and hardened) or **[new]** (not built yet).

## Requirements

### Requirement 1: Resilient camera and pose ingestion [existing]
**User Story:** As a user or hackathon judge, I want Posture Guard to run on a RealSense camera or a synthetic stream, so it works with or without hardware.

#### Acceptance Criteria
1. WHEN a RealSense D400 is attached, THE System SHALL read aligned color and depth frames and run `mp.solutions.pose` on the color frame.
2. WHEN no RealSense is available, THE System SHALL fall back to the synthetic frame source and the pipeline and dashboard SHALL run end to end.
3. WHEN no pose is found, visibility of a tracked landmark is below `scoring.visibility_floor`, or depth is unreadable or outside `[depth_min_m, depth_max_m]`, THE System SHALL return an `Unreliable` result with the matching reason and SHALL NOT raise.
4. WHEN landmark coordinates are `NaN` or infinite, THE System SHALL treat the frame as unreliable instead of producing a score. [new: not covered today]

### Requirement 2: Timed state machine and nudges [existing]
**User Story:** As a user, I want nudges only after sustained bad posture, so normal movement does not trigger alerts.

#### Acceptance Criteria
1. THE state machine SHALL take `(result, now)` with injected timestamps and read all timings from `StateConfig` (`bad_sustain_s`, `good_confirm_s`, `recovery_good_s`, `voice_delay_s`, `voice_repeat_cooldown_s`, `no_person_timeout_s`, `smoothing_window_s`).
2. WHEN bad posture is confirmed for `bad_sustain_s`, THE System SHALL emit one `CHIME` nudge and enter `BAD_CHIME`.
3. WHEN the user has not corrected posture `voice_delay_s` after the chime, THE System SHALL emit one `VOICE` nudge, and SHALL NOT emit another sooner than `voice_repeat_cooldown_s`.
4. WHEN a metric is in the hysteresis band (between `threshold - hysteresis_margin_deg` and `threshold`), THE System SHALL classify it as neutral and SHALL NOT start or reset a good or bad streak because of it.
5. WHEN good posture holds for `recovery_good_s` after a nudge, THE System SHALL return to `GOOD`.

### Requirement 3: Posture needle score [new]
**User Story:** As a user, I want one smooth number for how far I am from good posture, so the dashboard shows a needle instead of four raw angles.

#### Acceptance Criteria
1. THE System SHALL compute a needle value in `[-1.0, 1.0]` from the scored metrics. `0.0` is on-threshold-free upright, `1.0` is at or beyond the bad thresholds. Smoothing factor and scaling come from a new `config.yaml` section.
2. FOR ANY finite or non-finite input, THE needle value SHALL be a finite float in `[-1.0, 1.0]`.
3. THE dashboard `/ws` payload SHALL include the needle value and the dashboard SHALL render it.

### Requirement 4: Few-shot calibration [new]
**User Story:** As a user, I want to record a few seconds of good and slouched posture, so thresholds fit my desk setup.

#### Acceptance Criteria
1. WHEN the user starts "Calibrate good" from the dashboard, THE System SHALL average metric samples over a configured window and store them as the upright baseline.
2. WHEN the user starts "Calibrate bad", THE System SHALL store the slouch centroid and derive the needle projection axis between the two centroids.
3. WHEN either calibration is missing, THE System SHALL use the `config.yaml` thresholds.
4. Calibration SHALL stay in local memory or a local file. No frames or landmarks leave the machine.

### Requirement 5: Custom good and bad sounds [new]
**User Story:** As a user, I want to choose my own good and bad sounds.

#### Acceptance Criteria
1. THE `audio` section of `config.yaml` SHALL accept optional file paths for a bad sound and a good sound.
2. WHEN a configured path does not exist, THE System SHALL log a warning and use the built-in chime, and SHALL NOT crash.
3. WHEN the state machine recovers to `GOOD` after a nudge, THE System SHALL play the good sound once if one is configured.
4. THE dashboard SHALL offer "Test good sound" and "Test bad sound" actions next to the existing `/nudge/test`.
