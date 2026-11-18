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

## New components
- **`needle.py`** (new file, with header): pure functions.
  - `needle_value(metrics, cfg, calibration=None) -> float`.
  - Without calibration: for each metric, `r_i = |m_i| / threshold_i`. Take `r = max(r_i)`. Map to `[-1, 1]` with `n = clamp(2*r - 1, -1, 1)`, so on-threshold is `+1` and perfectly upright is `-1`. (Exact mapping can be tuned. Keep it in config.)
  - With calibration: project the metric vector onto `d = bad_centroid - good_centroid`, `s = ((m - good) . d) / (|d|^2 + eps)`, then `n = clamp(2*s - 1, -1, 1)`.
  - Smoothing is an EMA over the output with `alpha` from config, using injected `now` for time-aware alpha: `alpha = 1 - exp(-dt / tau)`.
  - Non-finite input returns the previous value (or `0.0` initially).
- **Calibration** (`calibration.py`, new file): sample accumulator and centroid store. Endpoints `POST /calibrate/good`, `POST /calibrate/bad`, `GET /calibrate/status`.
- **Config additions:** `needle: {tau_s, ...}`, `calibration: {window_s}`, `audio: {good_sound, bad_sound}` (all optional, defaulted).
- **Audio additions:** `Nudge.GOOD` (or a separate recovery event) played when the state returns to `GOOD` after a nudge. Missing files fall back to the built-in chime.
- **Dashboard additions:** needle gauge, calibrate buttons, "Test good/bad sound", and a synthetic or RealSense source indicator.

## Correctness Properties (hypothesis)
1. **Bounded needle.** For any landmarks (including `NaN`, `inf`, extreme values) and any calibration, the needle output is a finite float in `[-1.0, 1.0]`, and `score_pose` never raises.
2. **Scale invariance.** Scaling all landmark x and y by `k > 0` leaves the angle metrics unchanged within `1e-5`. (Angles from vertical depend on ratios only. Verify this holds for `measure_*`; if a metric is not scale invariant, fix it or record the exception.)
3. **Anti-chatter.** For any sequence of results whose zone stays `neutral`, or whose `bad` runs are each shorter than `bad_sustain_s` (timestamps strictly increasing), the machine emits no `CHIME` or `VOICE` nudge.
4. **Idempotent nudges.** For any increasing timestamp sequence at any frame rate, there is at most one `CHIME` per bad episode, and consecutive `VOICE` nudges are at least `voice_repeat_cooldown_s` apart.
5. **Monotone time safety.** `update` never raises for non-decreasing `now`, for any mix of `ScoredPosture` and `Unreliable` inputs.
