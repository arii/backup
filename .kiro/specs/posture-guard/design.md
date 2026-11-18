# Design Document: Posture Guard

## Architecture (existing modules)
- `camera.py`: `FrameSource` interface, synthetic and RealSense sources.
- `pose.py`: MediaPipe pose worker (`mp.solutions.pose`, `mediapipe>=0.10,<1.0`).
- `scoring.py`: `score_pose(landmarks, depth_m, cfg)` returns `ScoredPosture | Unreliable`. `zone_of` returns `"bad" | "good" | "neutral"` with hysteresis.
- `state.py`: `PostureStateMachine.update(result, now) -> Transition(state, nudge, ...)`. States: `NO_PERSON, GOOD, BAD_CHIME, BAD_VOICE, UNRELIABLE`. Nudges: `NONE, CHIME, VOICE`.
- `audio.py`: `AudioWorker` queue that plays through `paplay`. Chime is rendered, voice is TTS.
- `pipeline.py`: capture, pose, score, state, dashboard and audio wiring.
- `dashboard/`: FastAPI app with `/video.mjpg`, `/ws`, `POST /nudge/test`, and `static/index.html`.
- `config.py`: `config.yaml` to typed dataclasses.

## New components (as built)
- **`needle.py`**: pure mapping functions plus `NeedleSmoother`.
  - Threshold mapping (no calibration): `r = max_i |m_i| / threshold_i`, `n = clamp(2r - 1, -1, 1)`. Upright reads -1, on-threshold reads +1.
  - Calibrated mapping: `d = bad - good`, `s = ((m - good) . d) / (|d|^2 + eps)`, `n = clamp(2s - 1, -1, 1)`. Good centroid reads -1, bad centroid reads +1. Falls back to the threshold mapping when `|d|^2` is ~0.
  - `NeedleSmoother.update(raw, now)`: time-aware EMA, `alpha = 1 - exp(-dt / needle.tau_s)`. `None`/non-finite raw and non-increasing `now` hold the previous value. The pipeline resets the smoother when the mapping switches between threshold and calibrated.
  - The needle is display-only. Nudges still come from `state.py` and the `scoring` thresholds.
- **`calibration.py`**: `CalibrationRecorder`. `start(kind)` (web thread) arms a recording; the window opens on the next frame (frame clock) and lasts `calibration.window_s`. Scored frames are averaged; fewer than `calibration.min_samples` fails with an error message. In-memory only.
- **Endpoints**: `POST /calibrate/{good|bad}`, `DELETE /calibrate`, `GET /calibrate/status`, `POST /sound/test/{good|bad}` (409 when nothing is playable).
- **Config additions**: `needle.tau_s`, `calibration.window_s`, `calibration.min_samples`, `audio.bad_sound`, `audio.good_sound`.
- **Scoring**: new `UnreliableReason.NON_FINITE` for NaN/inf coordinates or overflowing metrics; non-finite depth is `DEPTH_UNREADABLE`. Like low visibility, it sends the state machine to `UNRELIABLE`.
- **Audio**: `Nudge.RECOVERY` and `Transition.recovered`. The state machine still returns `Nudge.NONE` on recovery; the pipeline enqueues `RECOVERY` on `recovered` only when `audio.good_sound` is set. `bad_sound` replaces the chime file. Missing files log a warning and appear in `AudioStatus.warnings`.
- **Dashboard payload**: `needle {value, calibrated}`, `source` (`synthetic` | `realsense`), `calibration` (status payload).

## Correctness Properties (hypothesis)
1. **Bounded needle.** For any landmarks (including `NaN`, `inf`, extreme values) and any calibration, the needle output is a finite float in `[-1.0, 1.0]`, and `score_pose` never raises.
2. **Scale invariance.** Scaling all landmark x and y by `k > 0` leaves the angle metrics unchanged within `1e-5`. (Angles from vertical depend on ratios only. Verify this holds for `measure_*`; if a metric is not scale invariant, fix it or record the exception.)
3. **Anti-chatter.** For any sequence of results whose zone stays `neutral` or `good`, or whose `bad` runs are each shorter than `bad_sustain_s` and separated by good runs longer than the smoothing window (timestamps strictly increasing), the machine emits no `CHIME` or `VOICE` nudge. (Neutral samples deliberately do not reset a bad streak, so bad runs separated only by neutral samples can accumulate.)
4. **Idempotent nudges.** For any increasing timestamp sequence at any frame rate, there is at most one `CHIME` per bad episode, and consecutive `VOICE` nudges are at least `voice_repeat_cooldown_s` apart.
5. **Monotone time safety.** `update` never raises for non-decreasing `now`, for any mix of `ScoredPosture` and `Unreliable` inputs.
