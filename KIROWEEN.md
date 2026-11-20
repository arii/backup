# Posture Guard: Kiroween 2026 submission

**Posture to die for.** (Please don't.) Leave a browser tab open; your webcam
watches how you sit, chimes when you slouch, and tells you out loud what to fix.
Nothing leaves your computer.

- **Category:** Frankenstein
- **Try it:** <https://arii.github.io/posture-guard/app/> (press *Try the demo* for no camera)
- **Code:** <https://github.com/arii/posture-guard> (MIT License)
- **Kiro artifacts:** [`.kiro/`](.kiro/) (spec, steering, two hooks)

## What it does

Posture Guard runs MediaPipe Pose on your webcam, measures head-forward, head
tilt, shoulder level and trunk lean, and runs a reminder state machine: a chime
after 2 s of sustained slouching, a spoken prompt 10 s later, and a reward chime
when you sit back up. Reminders say what is wrong and how to fix it ("Right
shoulder dropped: lift your right shoulder and take your weight off that elbow"),
using your own left and right even when the camera image is mirrored. A posture needle shows how close you are to slouching, and
"Record good posture" / "Record slouch posture" calibrate it to your own desk.

It comes in two forms that share one behavior:

- **Browser app** (GitHub Pages), the main product: webcam, pose model and posture
  logic all run in the tab. It keeps tracking in a background tab, plays Web Audio
  chimes and a speech-synthesis prompt, and keeps calibration and daily good/slouch
  totals in `localStorage`.
- **Linux desktop app** (Python, FastAPI dashboard): the same logic for offline use,
  with a webcam or a no-camera demo.

## Devpost copy

**Tagline:** Posture to die for. A webcam posture coach stitched together from
parts that were never meant to share a body.

**Short description:** Leave a browser tab open and Posture Guard watches how you
sit. Slouch and it chimes; keep slouching and it tells you what's wrong ("Head
forward: tuck your chin") and how to fix it. MediaPipe eyes, a Python brain and its
JavaScript twin, kept in lockstep by a 632-frame golden timeline. Runs locally, no install.

## Why Frankenstein

The category asks for seemingly incompatible technologies stitched into one app.
Posture Guard's body parts come from different languages and runtimes, and the
interesting work is in the stitches:

| Part | Donor | Stitch |
|---|---|---|
| Eyes | MediaPipe Pose as WebAssembly in the browser, `mp.solutions.pose` in Python | Both feed the same 33-landmark format into the same scoring |
| Brain | Python scoring, state machine, needle, calibration | Specified, property-tested, the reference implementation |
| Second brain | JavaScript port in `docs/app/posture-core.js` | A golden timeline: Python records 632 frames, Node must reproduce every state, reminder, cue and number (within 1e-9). A Kiro hook re-runs it whenever the JS core or the fixture is saved, and a pytest fails if Python changes without regenerating it |
| Voice | Web Audio + speech synthesis; `paplay` + pico2wave/espeak-ng | One cue text ("Your right shoulder is low...") spoken by either |
| Heartbeat | A Web Worker timer | Browsers throttle background tabs; the worker keeps ticking and the frame-rate-independent state machine still times reminders correctly at 5 fps |
| Lab test subject | Playwright, Chromium's fake camera, ffmpeg | A photo is turned into a video feed so CI can check the deployed site detects a real person |
| Amputated limb | Intel RealSense depth camera | Removed; shoulder width in the frame replaced depth as the distance check |

The README's [The monster](README.md#the-monster-kiroween-2026-frankenstein) section
has the full anatomy.

## How the project changed during the hackathon

The repository was created on **2026-11-13**, inside the October 30 - December 4,
2026 submission period. All of it was built during the hackathon, in two phases
with different tools:

| Dates | Built with | What |
|---|---|---|
| Nov 13-14 | Other AI coding tools (commits by `Obvious`, `obvious-autobuild[bot]`, one `Antigravity Agent` commit), reviewed and merged by Ariel Anders | **RealSense prototype**: a Linux-only posture corrector that required an Intel RealSense depth camera, a Python dashboard, the original scoring and reminder state machine, and the GitHub Pages landing page |
| Nov 18 | **Kiro** (commits by `Kiro Agent`), reviewed and merged by Ariel Anders | **Webcam and browser version**: everything below |

What the Kiro phase changed (PRs #19 onward):

- **From special hardware to any webcam.** Webcam became the input, and RealSense
  support was then removed entirely: the depth camera driver, the depth distance
  gate, the udev rules and the RealSense setup. A framing check (shoulder width in
  the frame) replaced the depth-sensor distance check.
- **From a Linux install to a web page.** A browser version on GitHub Pages:
  MediaPipe in the tab, a JavaScript port of the scoring and state machine, Web
  Audio, background-tab tracking. No install, no special camera.
- **Specific advice.** Reminders name the problem, the side and the fix, instead
  of a generic "fix your posture".
- **Robustness.** NaN/inf tracking glitches hold the current state instead of
  resetting it; frame-rate-independent smoothing; strict `config.yaml`
  validation; custom good/bad sounds; good/slouch calibration.
- **Verification.** Property-based tests, a frame-by-frame parity test between
  the Python and browser versions, and an end-to-end test of the deployed site.

## How Kiro was used

- **Spec-driven development.** [`.kiro/specs/posture-guard/`](.kiro/specs/posture-guard/)
  holds EARS-style requirements (9 requirement groups), a design with seven numbered
  correctness properties, and a 12-task plan that was checked off as each task's
  tests passed.
- **Steering.** [`.kiro/steering/architecture.md`](.kiro/steering/architecture.md)
  fixes the rules every change follows: `config.yaml` as the single source of
  truth, injected timestamps (no wall-clock reads in the logic), frame-rate-
  independent smoothing, lazy hardware imports, and keeping the browser port in
  sync with Python.
- **Follow-on specs.** Five more spec folders under `.kiro/specs/`
  (`onboarding-and-setup`, `progress-review`, `wellness-tools`,
  `safety-and-disclaimers`, `feedback-design`), each with EARS requirements, a design
  and a task list. Built tasks are checked. Spec-only tasks stay unchecked and are
  labelled.
- **Research-driven feedback.** [`docs/research/feedback-and-habit-formation.md`](docs/research/feedback-and-habit-formation.md)
  maps motor-learning and habit research to design rules: specific, task-focused
  cues, opt-in earned praise, lower-intensity (Light) coaching, a silent retention
  test, an hourly reminder cap, and no shame or streak-loss messages. Some sources
  were verified from abstracts or page text, others from citation metadata only, and
  the document says which.
- **Safety stance.** A versioned first-run acknowledgement, a footer notice and
  disclaimers on every doc surface; the wording is a draft for a lawyer to review.
- **Steering additions.** `.kiro/steering/architecture.md` now has rules for safety
  claims and feedback design.
- **Hooks.** `.kiro/hooks/pytest-on-change.json` runs `pytest` when package or
  test files are saved; `.kiro/hooks/browser-parity-on-change.json` runs the
  browser parity tests when the JavaScript core or its fixture changes.
- **Property-based testing.** `tests/test_properties.py` (hypothesis) checks the
  design's properties: the needle stays finite in [-1, 1] for any input including
  NaN/inf; angles don't change when landmarks are scaled; neutral-band noise and
  short slouches never remind; one chime per slouch episode; NaN frames change
  nothing; the state machine never raises; mirroring the image never changes
  the posture advice. Deliberately broken versions of the
  code (removed glitch hold, broken voice cooldown, shortened sustain, removed
  clamp, doubled recovery chime) were each caught.
- **Python-to-browser parity.** `tests/browser_golden.py` runs the real Python
  pipeline through a scripted 632-frame session and records every frame;
  `tests/js/` requires the browser engine to reproduce it exactly (states and
  reminders identical, numbers within 1e-9).

### Bugs the tests found

- **Low-frame-rate smoothing.** In the prototype, good posture never confirmed
  below about 6.7 fps or with the uneven frame timing real webcams produce. Fixed.
- **Wrong neutral.** Without calibration, a session that starts slouched teaches
  the slow baseline that slouching is normal. Mitigated: "Record good posture"
  anchors the baseline, and the README says to record it once per session.
- **Over-strict shoulder threshold.** The end-to-end test showed an upright person
  being reminded, and the golden timeline showed ~1 deg landmark jitter crossing
  the 1 deg exit band of the 4 deg shoulder threshold. Fixed: raised to 6 deg.

## Testing

- CI on every push: `ruff`, `pytest` (including the hypothesis properties), the
  browser parity and property tests (Node), shellcheck, and a smoke check of the
  real MediaPipe and OpenCV packages.
- `live-site` workflow: after each GitHub Pages deploy, Playwright opens the
  deployed app, runs demo mode, then webcam mode with Chromium's fake camera
  playing a photo of a person, so the real pose model loads from the self-hosted vendor files and
  detects her. Screenshots are kept as a workflow artifact.

## Known limitations

- **Not medical advice.** Posture Guard is a wellness tool, not a medical device. It
  tells users not to hold a rigid posture and to stop and see a clinician for pain,
  numbness or dizziness. The wording is a draft that a lawyer should review before any
  wider launch.

- **No clinical validation.** Nothing in the app or the research notes has been
  clinically validated. The research is mostly lab motor learning and workplace
  studies, and several citations were checked from metadata only.
- **Webcam accuracy.** A 2D webcam estimate depends on lighting, angle, clothing and
  body shape. "Good" is relative to the user's own calibration.
- **Spec only, not built:** the social leaderboard, face and jaw tension prompts, eye
  breaks and blink reminders, neck and shoulder stretch prompts, the microbreak
  timer and the guided breathing exercise. Built: onboarding, safety acknowledgement,
  Help, *Not working?*, *Learn the cues*, the personal progress panel, Light coaching,
  milestone praise and the hourly reminder cap.
- **Desktop app.** The Python dashboard does not have the onboarding or progress
  panel.
- **E2E scripts.** `tests/e2e/live-site.mjs` and `video/scripts/capture.mjs` hard-code
  onboarding version 1 and ack version 1. Update them when those versions change.
- **Physical webcam.** The automated live test uses Chromium's fake camera playing
  a photo; it does not cover a physical camera.
- **2D only.** Without a depth camera, every angle comes from the 2D landmarks.
- **Self-hosted runtime.** The browser app serves the MediaPipe runtime and model
  from its own site (`docs/app/vendor/`); video and landmarks never leave the tab.

## Submission checklist

| Item | Status |
|---|---|
| Built during Oct 30 - Dec 4, 2026 | Yes: repo created 2026-11-13 |
| Public repository | Yes |
| OSI-approved license, visible | Yes: [MIT](LICENSE) |
| `.kiro/` committed (not gitignored) | Yes: spec, steering, 2 hooks |
| Working demo link | Yes: <https://arii.github.io/posture-guard/app/> |
| How Kiro was used | This file and the README's "Built with Kiro" section |
| Category | Frankenstein |
| Demo video | Draft rendered by the `demo-video` workflow from real footage of the live site ([`video/`](video/)); add your own webcam clip and voiceover, then upload to YouTube |

### Demo video outline (about 3 minutes)

1. **0:00** "Posture to die for. Please don't." Slump dramatically, open the live
   URL, press *Start with webcam*.
2. **0:20** Sit up straight: the badge reads GOOD POSTURE, the skeleton is green.
3. **0:40** Slouch: the needle swings right, the chime plays and the *What to fix*
   box says "Head forward: tuck your chin..."; keep slouching to hear it spoken.
   Drop one shoulder to show "Shoulders uneven".
4. **1:10** Sit up: the recovery chime and "Back to good posture".
5. **1:30** Record good and slouch posture; show the calibrated needle.
6. **1:50** Switch tabs: reminders still fire in the background.
7. **2:10** The monster: the anatomy table (eyes, two brains, spinal cord, voice,
   heartbeat), then the golden-timeline parity test and the property tests in CI,
   and the `.kiro/` spec, steering and hooks that were the lightning.
8. **2:40** The build history: the RealSense prototype first, the amputation, then
   the webcam and browser version with Kiro. End on "It's alive."

## Owner checklist

Items only the repository owner can do (from issue #30 and the license review):

- [ ] Switch the repository default branch to `main` (Settings, Branches).
- [ ] Check WebGL in your own Chrome (`chrome://gpu`) and open the live app once.
- [ ] Run a manual test with a real webcam: record good posture, slouch, hear the voice.
- [ ] Record the demo video voiceover and your own webcam clip, then replace the sample photo footage. See the likeness warning in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
- [ ] Replace the sample photo `id_fail_distant_waist_up.jpg` used by CI and the video with your own or a cleared image.
- [ ] Confirm Remotion's free tier covers you, or buy a license.
- [ ] Submit on Devpost (deadline Dec 4, 2026, 2:00 PM PT) and add the YouTube link.
- [ ] Run a trademark search on "Posture Guard" before any commercial use.
