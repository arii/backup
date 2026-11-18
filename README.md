# Posture Guard

**Posture to die for.** Open a browser tab, allow your webcam, and leave the tab
open: Posture Guard scores your posture from head and shoulder geometry with
MediaPipe Pose and reminds you when you slouch, first with a chime and then a
spoken prompt. Everything runs on your computer; no video or landmark leaves it.

**Try it: <https://arii.github.io/posture-guard/app/>** (press *Try the demo* if
you have no camera).

There is also a Linux desktop version (Python, local web dashboard) with the same
behavior, for running offline or on a machine of your own.

## In your browser (no install)

Press *Start with webcam*, leave the tab open, and it chimes when you slouch.

- **Tells you what to fix.** Reminders name the problem and the fix, on screen and
  out loud: "Head forward: tuck your chin and bring your ears back over your
  shoulders", "Right shoulder dropped: lift your right shoulder and take your
  weight off that elbow", "Head tilted toward your left shoulder", "Leaning to your
  right". Sides are your own left and right, whether or not the camera image is
  mirrored. The *What to fix* box under the needle shows the same advice live.

- **Everything in the tab.** MediaPipe Pose Landmarker and a JavaScript port of the
  scoring, reminder state machine, posture needle and calibration
  (`docs/app/posture-core.js`). Only the model and its WASM runtime are downloaded
  (from jsDelivr and Google's model bucket).
- **Works in the background.** Tracking continues at about 5 fps when the tab is
  hidden. Chimes play through Web Audio, the prompt through the browser's speech
  synthesis, and *Notify when tab is hidden* adds desktop notifications.
- **Remembers you.** Calibration, settings, custom sounds (under 1.5 MB) and daily
  good/slouch totals persist in `localStorage`.
- **Same behavior as the Python app.** The port is checked frame by frame against
  the Python pipeline (see *Development*).

GitHub Pages serves `docs/` from `main`, so the live app updates on every merge.

## Linux desktop app

```bash
./setup.sh    # system packages + venv + pip install + preflight report
make run      # webcam -> dashboard at http://127.0.0.1:8000
make demo     # no camera: scripted good/slouch demo
```

`setup.sh` is idempotent; re-run it any time. It ends with a **preflight report**:
webcam readable, audio sinks, TTS.

| Mode | Command | Needs |
|---|---|---|
| **webcam** (default) | `make run` or `--camera webcam [--device N]` | any USB or laptop camera |
| synthetic | `make demo` or `--camera synthetic` | nothing (scripted poses) |

```bash
python -m posture_guard.dashboard.serve [--config config.yaml] [--host 127.0.0.1]
    [--port 8000] [--camera webcam|synthetic] [--device N]
```

`--camera` and `--device` override `camera.source` and `camera.device` in
`config.yaml`. If the webcam does not open, Posture Guard falls back to the
synthetic demo and shows the reason in the log and on the dashboard's camera line.
The synthetic demo alternates `camera.demo_cycle_s` (20 s) of good posture with the
same of slouching, so the full GOOD -> chime -> voice -> recovery cycle plays with
no camera at all.

To install by hand: `pip install -e '.[webcam]'` (OpenCV + MediaPipe), plus
`'.[dev]'` for the tests.

## Layout

```
docs/                  # GitHub Pages: landing page + the browser app (docs/app/)
src/posture_guard/
    config.py          # config.yaml -> typed dataclasses; rejects unknown keys
    webcam.py          # WebcamFrameSource (cv2.VideoCapture), the default input
    camera.py          # FrameSource interface, synthetic source, capture thread
    pose.py            # MediaPipe Pose bridge + scripted synthetic poses
    scoring.py         # pure posture metrics, framing gate, NaN hardening
    state.py           # reminder state machine (injected timestamps, no sleeps)
    posture_needle.py  # posture needle: -1 upright .. +1 bad, time-aware EMA
    calibration.py     # "Record good / slouch posture" centroids
    audio.py           # chimes, custom sounds, TTS on a serialized paplay queue
    feedback.py        # runtime feedback mode / voice timing settings
    pipeline.py        # capture -> pose -> score -> state -> dashboard/audio
    dashboard/         # FastAPI app: MJPEG video, WS metrics, control endpoints
tests/                 # pytest + hypothesis (Python), node --test (browser core)
config.yaml            # thresholds, timings, smoothing, camera, sounds
setup.sh               # system packages, venv, install, preflight report
.kiro/                 # Kiro spec, steering and hooks (see "Built with Kiro")
```

## Desktop runbook

Run this on the Linux box after `./setup.sh`; the camera and speakers cannot be
exercised from a cloud sandbox.

### Webcam placement

Put the laptop or webcam roughly at eye height, 0.6-1.2 m away, facing you, with
your head and both shoulders in frame (hips help but are optional). The framing
gate expects your shoulders to span 12-65% of the frame width
(`scoring.shoulder_width_min` / `shoulder_width_max`); outside that the badge reads
**PERSON TOO FAR** or **PERSON TOO CLOSE**. The same advice applies to the browser
version.

### 1. Preflight

```bash
./setup.sh
```

Confirm the report shows:

- **webcam — PASS** with the frame size
- **audio sinks — PASS** with your sound card sink listed
- **TTS renderable — PASS** (pico2wave preferred, espeak-ng fallback)

If audio sinks lists more than one sink, set the one you want in `config.yaml`
(`audio.sink: <name>`); by default the first USB audio sink is used.

### 2. First run — dashboard up

```bash
make run
```

Open <http://127.0.0.1:8000>. You should see the live camera view with the skeleton
overlay locked onto you, the state banner, the camera line naming the active source
(`webcam` or `synthetic`), and the metric tiles.

**Skeleton check:** sit down facing the camera and confirm the skeleton overlay
tracks you — head, shoulders and torso lines on your body, not drifting or snapping
to furniture. The placement guide under the video is a live checklist. Fix the
camera position until no placement warning shows.

### 3. Test nudge

Press **▶ Test nudge** on the dashboard. The chime plays, followed by the spoken
prompt. This verifies the audio path end to end before you rely on the state
machine. (From the CLI: `curl -X POST http://127.0.0.1:8000/nudge/test`.)

### 4. Slouch → chime → voice → recovery

1. Sit with good posture for a few seconds — the state banner reads **GOOD** and
   stays quiet.
2. Slouch (head forward or shoulders dropped) and hold it. After ~2 s of confirmed
   bad posture the **chime fires once** and the banner flips to **BAD**.
3. Keep slouching. ~10 s after the chime the **spoken prompt** fires, and repeats
   at most every 30 s while the posture stays bad.
4. Sit up straight. After ~3 s of good posture the state returns to **GOOD** and
   everything goes quiet — no pending escalations fire.

With `feedback.recovery_chime.enabled: true` (the shipped config) the good sound
plays once when you recover.

Leave the desk entirely: after ~2 s with no pose the state becomes **NO PERSON**
(silent, distinct dashboard badge). Reminders never fire on bad data: if landmark
confidence drops or you sit out of frame range, the badge reads **UNRELIABLE** and
the system stays silent. A garbled frame (NaN/inf landmarks) is ignored outright:
the state holds and no streak or timer resets.

### 5. Calibrate to your desk

The **Posture needle** reads -1 when upright and +1 at your bad-posture thresholds.
To fit it to your chair and camera, use the **Calibration & sounds** panel:

1. Sit the way you want to sit, press **Record good posture**, hold still for 3 s
   (`calibration.window_s`).
2. Slouch the way you usually do, press **Record slouch posture**, hold for 3 s.

Your good posture now reads -1 and your slouch +1. The good recording also anchors
the slow deviation baseline (`scoring.baseline_deviation`), so it measures drift from
*your* upright posture and keeps that reference when you leave the desk. Reminders
still use the `scoring` thresholds. **Reset calibration** returns to the defaults.
On the desktop, calibration is in memory and resets on restart (the browser version
keeps it).

Without a recording, the baseline learns from the first frames it sees. If you sit
down slouched, it learns the slouch as normal and sitting up straight can read as a
deviation. Record good posture once per session to avoid that.

CLI: `curl -X POST localhost:8000/calibrate/good`, `.../calibrate/bad`,
`curl -X DELETE localhost:8000/calibrate`, `curl localhost:8000/calibrate/status`.

### 6. Good and bad sounds

```yaml
audio:
  bad_sound: ~/sounds/uh-oh.wav    # replaces the reminder chime
  good_sound: ~/sounds/nice.wav    # replaces the positive and recovery chime
```

A missing file logs a warning and keeps the built-in sound. Preview with **▶ Good
sound** / **▶ Bad sound** (`POST /sound/test/good`, `POST /sound/test/bad`).
Playback uses `paplay`; when it cannot be launched (no PulseAudio/PipeWire), ALSA's
`aplay` is used instead, and with neither the dashboard shows the audio error while
everything else keeps running.

## Tuning (`config.yaml`)

| Symptom | Knob |
|---|---|
| Chimes too eagerly / not eagerly enough | `scoring.*_deg` thresholds (bad when |angle| passes them) |
| Flickers between GOOD and BAD | `scoring.hysteresis_margin_deg` (higher = stickier) |
| Nudges before you even settle into the chair | `state.bad_sustain_s` (chime delay), `state.good_confirm_s` |
| Voice prompts too aggressive | `state.voice_delay_s` (after chime), `state.voice_repeat_cooldown_s` |
| Positive chime (rewards sustained good posture) | `feedback.positive_chime.enabled` / `feedback.positive_chime.every_seconds` |
| Person scored too far / too close | `scoring.shoulder_width_min` / `scoring.shoulder_width_max` |
| Wrong webcam | `camera.device` or `--device N` |
| Video resolution or fps | `camera.width` / `camera.height` / `camera.fps` |
| Needle too jumpy / too sluggish | `needle.tau_s` (EMA time constant) |
| Calibration fails ("N scored frames") | sit fully in frame; `calibration.window_s`, `calibration.min_samples` |
| Sound on recovery | `feedback.recovery_chime.enabled` |
| Spoken prompt says what to fix (or not) | `audio.specific_cues` (fallback wording: `audio.voice_text`) |
| Custom sounds | `audio.bad_sound`, `audio.good_sound` |
| Wrong speakers | `audio.sink` (set your sink name from the preflight report) |

All durations are seconds, all angles degrees. Unknown keys or wrong-typed values
stop startup with a `ConfigError` naming the key (for example
`unknown config key(s): state.bad_sustain`), so a typo never silently falls back to
a default. The browser version uses the same defaults (`DEFAULTS` in
`docs/app/posture-core.js`, checked against `config.yaml` by the tests).

## Development

```bash
. .venv/bin/activate
ruff check .
pytest                              # Python: unit, timeline, hypothesis properties
node --test "tests/js/*.test.mjs"   # browser core: golden parity + properties
python tests/browser_golden.py      # regenerate the golden timeline after a Python change
```

The browser port is held to the Python behavior by a golden timeline:
`tests/browser_golden.py` drives the real `PosturePipeline` through a scripted
session (slouch to chime and voice, recovery, tilt, neutral wobble, hidden hips,
NaN glitches, leaving, sitting too far, calibration, mirrored framing) and
records every frame. `tests/js/` replays it through `posture-core.js` and requires
identical states, reminders and reasons, and metrics and needle within 1e-9.
`tests/test_browser_golden.py` fails when the committed fixture no longer matches
the Python code.

The full test suite (scoring, state machine timelines, webcam and synthetic
sources, audio queueing, calibration, dashboard API) runs with no camera or audio
hardware, and CI runs lint plus the suite on every push to every branch. After
each GitHub Pages deploy, the `live-site` workflow opens the deployed app in
Chromium and runs demo mode and webcam mode (with a fake camera playing a photo
of a person).

`tests/test_properties.py` uses [hypothesis](https://hypothesis.readthedocs.io/) to
check the correctness properties in `.kiro/specs/posture-guard/design.md`:

| Property | Checked over generated input |
|---|---|
| P1 bounded needle | any landmarks incl. NaN/inf, any visibility, any calibration: finite, in [-1, 1], never raises |
| P2 scale invariance | scaling every landmark by k in [1e-3, 1e3] leaves all angles within 1e-5 |
| P3 anti-chatter | neutral-band noise and bad runs shorter than `bad_sustain_s` never remind, at 2-100 fps |
| P4 idempotent reminders | one chime per bad episode, voice delay and cooldown respected, one recovery sound per recovery (also end to end through the pipeline) |
| P5 glitch transparency | inserting NaN frames anywhere changes nothing on the other frames |
| P6 time safety | `update()` never raises for non-decreasing time |
| P7 cue mirror invariance | mirroring the image never changes the cue (same problem, same side of you); cues only name metrics past their band |

## Built with Kiro

The webcam app, the browser version and the test suite were built with
[Kiro](https://kiro.dev), spec-first; [`KIROWEEN.md`](KIROWEEN.md) has the build
history. The `.kiro/` directory is committed so judges can read it:

- `.kiro/specs/posture-guard/requirements.md`: EARS acceptance criteria for the
  camera modes, frame hardening, smoothing, needle, calibration, sounds, config and
  the browser version.
- `.kiro/specs/posture-guard/design.md`: module design, the smoothing-window fix,
  and the seven correctness properties the hypothesis suite checks.
- `.kiro/specs/posture-guard/tasks.md`: the implementation plan, checked off.
- `.kiro/steering/architecture.md`: standing rules for the agent (config.yaml as the
  single source of truth, injected timestamps, frame-rate-independent EMAs, lazy
  camera imports, keeping the browser port in sync, headers on new files).
- `.kiro/hooks/pytest-on-change.json`: runs `pytest` whenever a file under
  `src/posture_guard/` or `tests/` is saved.
- `.kiro/hooks/browser-parity-on-change.json`: runs the browser parity tests when
  `docs/app/posture-core.js` or the golden fixture changes.

The property tests found two real problems: the original smoothing window never
confirmed at low frame rates or with jittered webcam timestamps (fixed), and a
session that starts slouched teaches the deviation baseline the wrong neutral
(mitigated by the good-posture anchor, documented above).

## Kiroween 2026

Posture Guard is a [Kiroween 2026](https://kiroween.devpost.com/) entry.
[`KIROWEEN.md`](KIROWEEN.md) has the submission write-up, the build history and
what Kiro did. Licensed under the [MIT License](LICENSE).

Fastest path: open <https://arii.github.io/posture-guard/app/> and press
*Try the demo*, or *Start with webcam*.

Local path, no hardware needed:

```bash
pip install -e '.[dev]'
pytest                                   # unit, timeline and property tests
make demo                                # or, without make:
python -m posture_guard.dashboard.serve --camera synthetic
```

With a laptop camera: `pip install -e '.[webcam]'`, then `make run`.
