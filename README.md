# Posture Guard

Linux desktop posture corrector: watches you through an Intel RealSense D400-series
camera, scores posture from head/shoulder geometry (gated by depth), and nudges you
audibly — chime first, then voice — while a local web dashboard shows the live
skeleton so you can verify tracking and tune camera placement.

Single person at a desk, front-facing camera, real-time feedback. All thresholds,
durations, and the audio sink live in [`config.yaml`](config.yaml).

## Quick start

```bash
./setup.sh    # system packages + venv + pip install + hardware preflight report
make run      # serves the dashboard at http://127.0.0.1:8000
```

`setup.sh` is idempotent — re-run it any time. It ends with a **hardware preflight
report** (camera detected? USB connection type? depth stream readable? audio sinks
found? TTS renderable?). Every line should read PASS before your first run; a WARN
on USB type means the camera is on a USB 2 port and depth may drop frames (RS-4:
recurring dropped-frame/stream-start failures on USB 2 — plug into USB 3).

Without a RealSense attached, the pipeline falls back to a synthetic frame source,
so the dashboard is fully verifiable before the camera is ever plugged in.

## Layout

```
src/posture_guard/
    config.py    # config.yaml -> typed dataclasses (single source of truth)
    camera.py    # FrameSource interface + synthetic + RealSense sources
    scoring.py   # pure posture metrics, depth gate, visibility floor
    needle.py    # posture needle: -1 upright .. +1 bad, time-aware EMA
    calibration.py  # few-shot good/bad centroids for the needle
    state.py     # nudge state machine (injected timestamps, no sleeps)
    audio.py     # chime + TTS prompts on a serialized paplay queue
    pipeline.py  # capture -> pose -> score -> state -> dashboard/audio wiring
    dashboard/   # FastAPI app: MJPEG video, WS metrics, test-nudge endpoint
tests/           # pytest: pose fixtures, timeline tests, hypothesis properties
config.yaml      # thresholds, durations, distance band, camera settings
setup.sh         # system packages, venv, install, hardware preflight report
```

## Hardware runbook

Run this on the Linux box after `./setup.sh` — the camera and speakers cannot be
exercised from a cloud sandbox.

### 1. Preflight

```bash
./setup.sh
```

Confirm the report shows:

- **camera detected — PASS** with the D415/D435 listed
- **USB connection type — PASS (3.x)** — if WARN, move the camera to a USB 3 port
- **depth stream readable — PASS**
- **audio sinks — PASS** with your USB sound card sink listed
- **TTS renderable — PASS** (pico2wave preferred, espeak-ng fallback)

If audio sinks lists more than one sink, set the one you want in `config.yaml`
(`audio.sink: <name>`); by default the first USB audio sink is used.

### 2. First run — dashboard up

```bash
make run
```

Open <http://127.0.0.1:8000>. You should see the live camera view with the skeleton
overlay locked onto you, the state banner, the depth readout (should read a sane
distance — roughly the range 0.6–2.5 m), and the metric tiles.

**Skeleton check:** sit down facing the camera and confirm the skeleton overlay
tracks you — head, shoulders and torso lines on your body, not drifting or snapping
to furniture. The placement guide under the video is a live checklist: person fully
in frame, torso inside the depth band, camera at head height. Fix the camera
position until no placement warning shows.

### 3. Test nudge

Press **▶ Test nudge** on the dashboard. The chime plays from the box, followed by
the spoken prompt. This verifies the audio path end to end before you rely on the
state machine. (From the CLI: `curl -X POST http://127.0.0.1:8000/nudge/test`.)

### 4. Slouch → chime → voice → recovery

1. Sit with good posture for a few seconds — the state banner reads **GOOD** and
   stays quiet.
2. Slouch (head forward or trunk back) and hold it. After ~2 s of confirmed bad
   posture the **chime fires once** and the banner flips to **BAD**.
3. Keep slouching. ~10 s after the chime the **spoken prompt** fires, and repeats
   at most every 30 s while the posture stays bad.
4. Sit up straight. After ~3 s of good posture the state returns to **GOOD** and
   everything goes quiet — no pending escalations fire.

### 5. Posture needle and calibration

The **Posture needle** panel shows one smoothed number: **-1** is upright, **+1** is
at (or past) your bad-posture thresholds. Out of the box it is driven by the
`scoring.*_deg` thresholds (caption: *thresholds*).

To fit it to your chair and camera:

1. Sit well and press **Calibrate good**. Hold still for 3 s (`calibration.window_s`).
2. Slouch the way you usually do and press **Calibrate bad**. Hold for 3 s.

The caption switches to *calibrated*: your good posture reads -1 and your slouch
reads +1. **Reset** returns to the thresholds. Calibration only moves the needle;
nudges still follow the `scoring` thresholds and `state` timings. It lives in
memory and is lost on restart. Nothing leaves the machine.

From the CLI: `curl -X POST http://127.0.0.1:8000/calibrate/good`, `.../calibrate/bad`,
`curl -X DELETE .../calibrate`, `curl .../calibrate/status`.

### 6. Custom sounds

Set WAV paths in `config.yaml`:

```yaml
audio:
  bad_sound: ~/sounds/uh-oh.wav     # replaces the built-in chime
  good_sound: ~/sounds/nice.wav     # plays once when you recover after a nudge
```

A missing file logs a warning and falls back to the built-in chime (bad) or
silence (good). Preview with **▶ Good sound** / **▶ Bad sound**
(`POST /sound/test/good`, `POST /sound/test/bad`; 409 when nothing is playable).

Leave the desk entirely: after ~2 s with no person in the depth band the state
becomes **NO PERSON** (silent, distinct dashboard badge). Nudges never fire on bad
data — if landmark confidence or depth drops, the badge reads **UNRELIABLE** and
the system stays silent.

## Tuning (`config.yaml`)

| Symptom | Knob |
|---|---|
| Chimes too eagerly / not eagerly enough | `scoring.*_deg` thresholds (bad when |angle| passes them) |
| Flickers between GOOD and BAD | `scoring.hysteresis_margin_deg` (higher = stickier) |
| Nudges before you even settle into the chair | `state.bad_sustain_s` (chime delay), `state.good_confirm_s` |
| Voice prompts too aggressive | `state.voice_delay_s` (after chime), `state.voice_repeat_cooldown_s` |
| Person scored too far / too close | `scoring.depth_min_m` / `scoring.depth_max_m` |
| Video resolution or fps | `camera.*` |
| Wrong speakers | `audio.sink` (set your sink name from the preflight report) |
| Needle too jumpy / too sluggish | `needle.tau_s` (EMA time constant) |
| Calibration fails ("N scored frames") | sit fully in frame; `calibration.window_s`, `calibration.min_samples` |
| Custom chime / recovery sound | `audio.bad_sound`, `audio.good_sound` |

All durations are seconds, all angles degrees.

## Development

```bash
. .venv/bin/activate
ruff check .
pytest
```

The full test suite (scoring, state machine timelines, audio queueing, camera
abstraction, dashboard API) runs against a synthetic frame source with no hardware
attached, and CI runs the same suite on every push.

`tests/test_properties.py` uses [hypothesis](https://hypothesis.readthedocs.io/)
to check invariants over generated inputs: the needle stays finite in [-1, 1]
for any landmarks (including NaN/inf), angles are unchanged by uniform scaling,
neutral-band noise and short slouches never nudge, and there is exactly one
chime per bad episode with voice spacing honoring the delay and cooldown.

## Building with Kiro

This repo carries its [Kiro](https://kiro.dev) setup in `.kiro/`:

- `.kiro/steering/architecture.md`: standing rules for the agent (config.yaml is
  the single source of truth, injected timestamps in `state.py`, hardware-optional
  execution, file headers on new files).
- `.kiro/specs/posture-guard/`: the feature spec. `requirements.md` (EARS
  acceptance criteria), `design.md` (modules and the correctness properties
  behind the hypothesis tests), and `tasks.md` (the implementation plan, checked
  off as it was built).
- `.kiro/hooks/pytest-on-core-save.json`: runs the scoring, state, needle and
  property tests whenever `scoring.py`, `state.py` or `needle.py` is saved.
