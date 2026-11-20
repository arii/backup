# Posture Guard

**Posture to die for.** (Please don't. That's the whole point.)

Somewhere between your third coffee and your fourth meeting, your head drifted
forward until your ears were hovering over the keyboard. Posture Guard noticed.
Leave a browser tab open with your webcam on, and it watches how you sit. Slouch,
and it chimes. Keep slouching, and it tells you out loud exactly what is wrong and
how to fix it. Everything runs on your computer; no video or landmark leaves it.

**Try it: <https://arii.github.io/posture-guard/app/>** (press *Try the demo* if
you have no camera). The first visit shows a short walkthrough (camera placement,
what you will see and hear, and a safety notice). The *Help* button replays it, and
*Not working?* diagnoses framing, lighting and speed problems.

> **Safety.** Posture Guard is a wellness tool, not medical advice or a medical
> device. Do not hold a rigid posture. Stop and see a clinician if you have pain,
> numbness or dizziness. Webcam estimates are approximate. Provided as-is under the
> MIT License. See [`.kiro/specs/safety-and-disclaimers`](.kiro/specs/safety-and-disclaimers/design.md).

There is also a Linux desktop version (Python, local web dashboard) with the same
behavior, for running offline or on a machine of your own. The desktop app does not
have the onboarding walkthrough, the progress panel or the coaching level; those are
browser only.

## Getting started (first visit)

1. **Open the app and read the walkthrough.** A new visitor sees three short steps:
   how it works and camera placement, what you will see and hear, and the safety
   notice. Press *I understand* to unlock the Start buttons. The *Help* button replays
   it at any time.
2. **Place the camera.** Eye level, about an arm's length away, head and shoulders in
   frame, light in front of you, a plain background.
3. **Press *Start with webcam*** (or *Try the demo* if you have no camera). Sit
   naturally, then use *Record good posture* once so "good" means your own baseline.
4. **If it does not work, press *Not working?*** A checklist watches the live frames
   and names the likely cause (nobody in view, too close or far, low light or blocked
   view, low frame rate) with a plain fix. WebGL help and the bug report link are there
   too.
5. **Press *Learn the cues*** to practice: sit tall, then push your head forward, tilt
   it, raise one shoulder, lean. The matching tile lights up. No sounds, nothing is
   recorded.

Design and requirements: [`.kiro/specs/onboarding-and-setup`](.kiro/specs/onboarding-and-setup/requirements.md).

## Safety and medical disclaimer

This wording is a draft. It is not legal advice, and the owner should have a lawyer
review it before any wider launch.

- Posture Guard is a wellness tool. It is not medical advice and not a medical device.
  It does not diagnose, treat or prevent any condition.
- Do not hold a rigid posture. Relax your shoulders and change position often.
  Reminders do not replace regular movement breaks. The evidence that "perfect"
  sitting posture prevents back pain is weak (see the research document).
- Stop and see a qualified clinician if you feel pain, numbness, tingling or
  dizziness, or if pain persists.
- If you have a spine, nerve, neuromuscular or other medical condition, are pregnant
  or are recovering from an injury, check with a professional first.
- Webcam estimates are approximate. Lighting, camera angle, clothing and body shape
  change the result. "Good" means close to your own calibrated baseline.
- Video and landmarks are processed on your machine and not uploaded. The browser
  version loads its pose model and scripts from a CDN.
- Provided as-is, without warranty, under the [MIT License](LICENSE).

How it works in the app: the first run requires an acknowledgement stored as
`ackVersion` in `localStorage`. Bumping `ACK_VERSION` in `docs/app/onboarding.js` asks
everyone again. The same notice appears in the app footer, the landing page, the
dashboard docs page and under the *Relax, don't brace* panel. Full spec:
[`.kiro/specs/safety-and-disclaimers`](.kiro/specs/safety-and-disclaimers/requirements.md).

### What it can diagnose

| Ailment | Folk name | What Posture Guard tells you |
|---|---|---|
| Head forward | Tech neck: your ears have wandered ahead of your shoulders | "Tuck your chin and bring your ears back over your shoulders." |
| Head tilted | The puzzled dog | "Straighten your neck so your ears are level." |
| Shoulder dropped | The one-elbow lean | "Lift your right shoulder and take your weight off that elbow." |
| Leaning sideways | The Leaning Tower of Pisa | "Sit up straight with your weight even on both hips." |

It names *your* left and right, even when your webcam mirrors the picture. Sit up
and it plays a reward chime, because positive reinforcement works on spines too.

Posture Guard is a reminder, not a doctor. If something hurts, see a human
professional, not a webcam.

## The monster (Kiroween 2026: Frankenstein)

Posture Guard is stitched together from parts that were never meant to share a
body. Unlike its namesake, it sits up straight.

| Body part | Donor | Job |
|---|---|---|
| **Eyes** | Google MediaPipe Pose, compiled to WebAssembly in the browser (Python on Linux) | 33 body landmarks per frame from an ordinary webcam |
| **Brain** | Python: scoring, reminder state machine, posture needle, calibration | Decides when you are slouching and what to say about it |
| **Second brain** | A JavaScript transplant of the first (`docs/app/posture-core.js`) | The same decisions, running inside your browser tab |
| **Spinal cord** | A golden timeline: Python records a scripted 632-frame session, Node replays it | Keeps both brains making identical decisions, numbers within 1e-9 |
| **Voice** | Web Audio and speech synthesis in the browser; `paplay` with pico2wave or espeak-ng on Linux | The chime, then "Head forward. Tuck your chin..." |
| **Heartbeat** | A Web Worker timer | Keeps tracking at ~5 fps after the browser throttles a background tab |
| **Memory** | `localStorage` | Your calibration, settings, custom sounds and daily totals |
| **Desktop nervous system** | FastAPI, WebSocket, MJPEG | The Linux dashboard |
| **Immune system** | pytest and hypothesis (Python), `node:test` (JavaScript) | Seven correctness properties plus unit tests; every bug we planted on purpose got caught |
| **Lab test subject** | Playwright, Chromium's fake camera, and ffmpeg turning a photo into a video feed | Checks that the deployed site finds a real person (an Apache-2.0 sample photo; the paperwork is in order) |
| **Lightning** | Kiro: specs, steering and hooks | It's alive. |

Why these parts don't normally fit, and the stitches that hold them:

- **Python can't run in a browser tab, and JavaScript can't import Python.** So the
  brain exists twice, and the golden timeline proves the twins agree on every frame
  of a scripted 632-frame session: every state, every reminder, every word of advice.
- **Browsers throttle background tabs to save battery,** which is exactly when a
  posture coach needs to keep working. A Web Worker keeps the pulse going, and the
  state machine is frame-rate independent, so reminders still land on time at 5 fps in
  the background.
- **A webcam has no depth sensor.** The prototype needed an Intel RealSense depth
  camera; that limb was amputated. Distance now comes from how wide your shoulders
  are in the frame.
- **MediaPipe labels sides from your point of view; webcams often mirror the image.**
  The advice works out which side is yours from the shoulder line, and a property
  test checks that mirroring the picture never changes what it tells you.

## In your browser (no install)

Press *Start with webcam*, leave the tab open, and it chimes when you slouch.

**Requirements:** a webcam, a recent Chrome, Edge or Firefox, and **hardware
acceleration / WebGL turned on**. Everything runs in your browser and no video is
uploaded. If WebGL is off, the site says so up front and *Try the demo* still works.
To turn it on in Chrome or Edge, open `chrome://settings/system`, enable *Use
graphics acceleration when available*, relaunch, and check `chrome://gpu`. On
Linux/Wayland you may also need `--ozone-platform=x11`. In Firefox, set
`webgl.disabled` to `false` in `about:config`.

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

## Feedback design and the research behind it

The feedback rules come from motor-learning and behavior-change research, summarized
in [`docs/research/feedback-and-habit-formation.md`](docs/research/feedback-and-habit-formation.md).
In short:

- Cues are immediate, specific and about the task ("tuck your chin"), never about the
  person. No shaming wording, no punishing sounds, no streak-loss messages.
- Praise is opt-in and earned. Milestone praise (banner and chime, spoken only if
  spoken praise is on) fires once at 5, 15, 30 and 60 continuous good minutes.
- Frequent feedback can help now and hurt retention, so there is a *Coaching level*:
  **Standard** (the original behavior) or **Light** (banner and chime first, voice only
  after a second reminder episode, praise only at milestones). Light never produces
  more reminders than Standard.
- *Test me* is a silent retention test, the measure of learning, separate from the
  coached score. The progress panel suggests trying Light coaching when your latest
  silent score is at least your coached score.
- A per-hour reminder cap (30) limits alarm fatigue, with a visible note when it
  applies. Nothing is spoken during pause or the silent test.

How sure are we? Sources were checked in two tiers. **Verified** means the abstract
or page text was read and supports the claim. **Metadata only** means the citation
exists (Crossref) but the abstract was not readable, so the detail is not relied on
(for example, the often-quoted "a third of feedback interventions decreased
performance" was not re-checked and is not stated as fact). Most evidence is from lab
motor learning and workplace studies, not this app. **Nothing here is clinically
validated.** Spec: [`.kiro/specs/feedback-design`](.kiro/specs/feedback-design/requirements.md).

## Progress and the leaderboard (what is built, what is planned)

| Item | Status |
|---|---|
| *Your progress* panel: last 7 days of good % and good minutes, total minutes, no broken-streak messaging | Built (browser) |
| Silent-test trend versus coached score, and the light-coaching suggestion | Built (browser) |
| Export progress as JSON, *Delete my data* (clears `posture-guard:v1`) | Built (browser) |
| Social leaderboard | **Spec only.** Opt-in, pseudonymous, aggregate scores only, no video or landmarks leave the machine, no account needed for the core app. It must reward consistency, breaks and relaxation, not rigid "good %", and count only tracked time |

The default stays a personal review. Backend options and anti-gaming rules are in
[`.kiro/specs/progress-review`](.kiro/specs/progress-review/requirements.md).

## Planned wellness tools

All spec only, opt-in, off by default, no medical claims, and counted against the
same per-hour prompt cap. See [`.kiro/specs/wellness-tools`](.kiro/specs/wellness-tools/requirements.md).

| Tool | Status |
|---|---|
| Breath check and bracing monitor (*Relax, don't brace*) | Built |
| Guided slow-breathing exercise | Spec only |
| Face and jaw tension prompt (the Pose model has no jaw landmarks, so this needs the Face Landmarker blendshapes and an extra model download) | Spec only |
| Neck and shoulder micro-stretch prompts | Spec only |
| 20-20-20 eye breaks and blink reminders | Spec only |
| Stand and move microbreak timer | Spec only |

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
video/                 # Remotion demo video, rendered in CI from footage of the live app
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
tests/e2e/             # Playwright check of the live site (see Development)
docs/app/              # browser app: app.js (UI, state), posture-core.js (scoring port),
                       #   relax.js, onboarding.js, progress.js, feedback.js (pure, unit-tested)
docs/research/         # feedback and habit-formation research notes
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
  camera imports, keeping the browser port in sync, headers on new files, safety and
  claims, feedback design).
- Follow-on specs (requirements, design and tasks each; built items are checked,
  the rest are labelled spec only):
  - `.kiro/specs/onboarding-and-setup/`: first-run walkthrough, setup check, practice.
  - `.kiro/specs/progress-review/`: personal progress (built), social leaderboard (spec only).
  - `.kiro/specs/wellness-tools/`: breath check (built), the other tools (spec only).
  - `.kiro/specs/safety-and-disclaimers/`: disclaimer wording, acknowledgement, claims.
  - `.kiro/specs/feedback-design/`: research-driven feedback rules and coaching level.
- `.kiro/hooks/pytest-on-change.json`: runs `pytest` whenever a file under
  `src/posture_guard/` or `tests/` is saved.
- `.kiro/hooks/browser-parity-on-change.json`: runs the browser parity tests when
  `docs/app/posture-core.js` or the golden fixture changes.

The property tests found two real problems: the original smoothing window never
confirmed at low frame rates or with jittered webcam timestamps (fixed), and a
session that starts slouched teaches the deviation baseline the wrong neutral
(mitigated by the good-posture anchor, documented above).

## Kiroween 2026

Posture Guard is a [Kiroween 2026](https://kiroween.devpost.com/) entry in the
**Frankenstein** category: seemingly incompatible technologies (a Python brain and
its JavaScript transplant, WebAssembly eyes, two voice boxes, a Web Worker heartbeat)
stitched into one app. See [The monster](#the-monster-kiroween-2026-frankenstein)
above. [`KIROWEEN.md`](KIROWEEN.md) has the submission write-up, the build history
and what Kiro did. Licensed under the [MIT License](LICENSE).

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

Browser end-to-end check (needs a local server and Playwright, not part of `pytest`):

```bash
npm install --no-save playwright@1 && npx playwright install chromium
python -m http.server 8000 --directory docs &
node tests/e2e/live-site.mjs http://localhost:8000/ "" ./e2e-out
```

The third argument is a fake-camera `.y4m` file; pass `""` to skip the webcam parts.
`tests/e2e/live-site.mjs` and `video/scripts/capture.mjs` pre-seed `localStorage`
with onboarding version 1 and ack version 1 so they can reach the Start buttons. If you
bump `ONBOARDING_VERSION` or `ACK_VERSION` in `docs/app/onboarding.js`, update those
hard-coded values too.
