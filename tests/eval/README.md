# Accuracy eval (issue #113)

Status: **implemented** as a harness, a PR gate and a synthetic bootstrap set. **Spec only:** recorded sessions
from real people. None exist yet.

The eval replays labeled landmark sequences through the real `PostureEngine`
(`docs/app/posture-core.js`) in Node and reports precision and recall, with slouching as the positive class.
It needs no video, no images and no camera.

> **The bundled data is SYNTHETIC.** It is generated from a simulated body, not recorded from a person. The numbers
> it produces check that the harness and the gate work. They are not an accuracy claim about real people, the
> MoveNet degradation model is an assumption, and none of this says anything about health.

## Run it

| Command | What it does |
| --- | --- |
| `npm run eval` | Prints the tables and writes `tests/eval/results/latest.json` (git-ignored). |
| `npm run eval:check` | Same, and exits 1 if any precision or recall is below `tests/eval/baseline.json`. |
| `npm run eval:update-baseline` | Rewrites the baseline and prints a before/after table for the PR body. |
| `npm run eval:generate` | Regenerates `data/synthetic/` (byte-identical on every run). |

`npm run check` runs the gate and the generator check too. `--out <file>` changes where the JSON goes.

## What is measured

Rows use the engine's metric names. A frame is positive for a metric when its label says that metric is slouching.
The engine's answer is what it reports on that frame:

| Row | Engine answer counted as "slouching" |
| --- | --- |
| `head_forward`, `head_tilt`, `shoulder_level`, `trunk_lean` | `cue.metric` from `engine.process` names that metric |
| `overall` | the frame has any cue |
| `overall_alert` | `transition.state` is `bad_chime` or `bad_voice` |

Things to know when reading the numbers:

- A cue names only the single worst metric on a frame. Where two metrics are bad at once, only one can be found.
  The synthetic set slouches one metric at a time to avoid this; real sessions that bend two at once will score lower.
- `overall_alert` includes the engine's own timing (`bad_sustain_s` before it fires, `good_confirm_s` and
  `recovery_good_s` before it clears). Its numbers reflect that timing as well as detection, so they run lower than
  the per-frame rows by design.
- Frames the engine cannot score (no pose, low visibility, NaN, framing out of band) produce no cue. In a slouch
  segment they count as misses.
- Frames labeled `ignore` or outside every label segment are not scored. Calibration-phase frames are normally left
  unlabeled.
- Precision or recall is `null` when it is undefined (nothing predicted, or nothing to find). The gate does not
  compare a baseline `null`, and treats a number that turns `null` as a drop.
- Thresholds are the engine's `DEFAULTS`. The harness holds none, and time comes from each frame's timestamp.

Results are grouped by dataset (a folder under `data/`), by path (`mediapipe`, `movenet`) and by calibration leg
(`comfortable`, `mid_movement`, `none`, plus `all`, which sums the legs). Counts are summed over sessions before the
ratios are taken.

### MoveNet path

Sessions with `"path": "movenet"` hold MoveNet-style pixel coordinates and scores. The harness builds the 17-keypoint
array and runs it through the app's real `movenetToLandmarks` (`docs/app/movenet-adapter.js`), so score-to-visibility
scaling and the 33-landmark layout match the WebGL-off fallback. The engine is the same code as the MediaPipe path.
The app also turns off the shoulder-based relax features on this path (`shoulderChecksOn`); those are not part of
posture scoring and are not evaluated here.

The synthetic MoveNet sessions add assumed degradation to the same simulated motion: 2.5x coordinate noise,
whole-pixel rounding, a small fixed ear error per person, lower and noisier scores, and hips that often fall under the
score floor. These are guesses, not measurements of the model. Replace them with recorded sessions.

### Calibration legs

Each session may begin with the "save my posture" step (`calibration`). The harness calls
`engine.calibration.start("good")` at `start_s`, so the engine measures the next 3 s as the saved posture exactly as
the app does, and from then on measures every metric from that zero point.

- `comfortable`: the posture is saved while sitting comfortably.
- `mid_movement`: the posture is saved while the person is moving into a slouch.

In the synthetic set both legs of a body share the labels, the timestamps and every frame after the calibration phase,
so the difference between them is the cost of the bad save alone. The report prints
`mid_movement minus comfortable` per row. The engine caps the saved zero at one threshold per metric, so a bad save
shifts the numbers but cannot hide a whole slouch. Related: issue #107.

## Layout

```
tests/eval/
  README.md        this file
  baseline.json    committed numbers the gate compares against
  schema.mjs       validateSession: the schema below, as code
  harness.mjs      runs the engine over sessions, tallies, groups
  metrics.mjs      confusion counts, precision, recall
  gate.mjs         baseline comparison and the trigger path list
  report.mjs       console tables and the PR-body table
  load.mjs         reads and validates data/<dataset>/*.json
  synthetic.mjs    the deterministic synthetic generator
  data/synthetic/  generated sessions (do not edit by hand)
  data/recorded/   real sessions, only with consent (see Privacy); not created yet
scripts/eval-accuracy.mjs   the CLI      scripts/gen-eval-data.mjs   the generator CLI
```

Each folder under `data/` is a dataset and is reported separately. Add real sessions as `data/recorded/*.json`.

## Session schema (version 1)

One JSON object per file. `validateSession` in `schema.mjs` is the source of truth; loading fails with the file name
and the problems if a session does not validate.

```json
{
  "schema_version": 1,
  "id": "syn-mediapipe-00-comfortable",
  "synthetic": true,
  "source": "synthetic-generator@1",
  "consent": null,
  "path": "mediapipe",
  "frame_size": { "width": 640, "height": 480 },
  "scene": { "lighting": "dim", "fps": 3 },
  "calibration": { "kind": "good", "start_s": 0, "leg": "comfortable" },
  "labels": [
    { "start_s": 4.0, "end_s": 8.0, "label": "good" },
    { "start_s": 8.0, "end_s": 9.0, "label": "ignore" },
    { "start_s": 9.0, "end_s": 15.0, "label": "slouch", "metrics": ["head_forward"] }
  ],
  "frames": [
    [0.0, [0.452, 0.31, 0.95, 0.548, 0.31, 0.95, 0.4, 0.5, 0.95, 0.6, 0.5, 0.95, 0.42, 0.9, 0.95, 0.58, 0.9, 0.95]],
    [0.4, null]
  ]
}
```

| Field | Rules |
| --- | --- |
| `schema_version` | `1`. |
| `id` | File-safe string (letters, digits, `.`, `_`, `-`). Use it as the file name. |
| `synthetic` | `true` for generated data. `false` for a recorded person. |
| `source` | Free text: the generator name, or the recording setup. |
| `consent` | `null` when synthetic. When `synthetic` is `false`: `{ "given": true, "participant": "<pseudonym>", "date": "YYYY-MM-DD" }`. Required. |
| `path` | `mediapipe` or `movenet`. |
| `frame_size` | `movenet` only, required: pixel size the keypoints are measured in. |
| `scene` | Optional free-form tags (lighting, camera angle, clothing, body shape). Not read by the harness. |
| `calibration` | `null` for none, or `{ "kind": "good", "start_s": <s>, "leg": "comfortable" or "mid_movement" }`. `leg` is your label for how the posture was saved. |
| `labels` | Non-empty, sorted by time, no overlaps. `label` is `good`, `slouch` or `ignore`. A `slouch` segment lists `metrics` from `head_forward`, `head_tilt`, `shoulder_level`, `trunk_lean`; other labels list none. Per-segment labels cover per-frame labeling: use short segments. |
| `frames` | Non-empty `[t, points]` pairs, `t` in seconds, strictly increasing (any rate, jitter allowed). `points` is `null` when no pose was found, otherwise 18 numbers. |

`points` holds six landmarks in this order, each as `x, y, confidence`:
left ear, right ear, left shoulder, right shoulder, left hip, right hip.

- `mediapipe`: `x` and `y` are normalized 0..1 (the pose landmarker's output), `confidence` is its visibility.
- `movenet`: `x` and `y` are pixels in `frame_size`, `confidence` is the MoveNet keypoint score.
- A coordinate may be `null` to record a NaN glitch. Confidence is always a number from 0 to 1.

To record real sessions, save the landmarks the app already computes. Do not save the camera image.

## The gate

Two ways to run it, same comparison (`compare` in `gate.mjs`):

- **Unit test, always on.** `tests/js/eval-baseline.test.mjs` runs the eval and fails if any number is below
  `baseline.json`. The `browser-core` CI job runs every `tests/js` test on every pull request, so this is the gate
  that is active today. The eval takes under a second.
- **Path-triggered CI job, pending.** `node scripts/eval-accuracy.mjs --ci` skips a pull request that touches no
  scoring or eval file and fails otherwise like the test. The workflow job that calls it needs a token with the
  `workflow` scope to push, which was not available when this was written; the job to add to
  `.github/workflows/ci.yml` is in the pull request description. Until it is added the script still works locally.

What the gate compares and when `--ci` runs:

- On a pull request it lists the changed files and runs the eval only if one is in `EVAL_TRIGGER_PATHS`
  (`gate.mjs`): `docs/app/posture-core.js` (it imports nothing), `docs/app/movenet-adapter.js` (shapes the MoveNet
  landmarks), everything under `tests/eval/` (code, data, baseline), `scripts/eval-accuracy.mjs`,
  `scripts/gen-eval-data.mjs` and `.github/workflows/ci.yml`. If the file list cannot be read, it runs.
  A scoring input added later (for example a new module `posture-core.js` imports) must be added to that list.
- Outside a pull request it always runs.
- It fails if any precision or recall in `baseline.json` is lower than the current value by more than `1e-9`, or has
  gone missing. Improvements pass and are listed.
- `node scripts/gen-eval-data.mjs --check` (also a unit test) checks that `data/synthetic/` is byte-identical to what
  the generator writes.

### Changing the baseline on purpose

1. Run `npm run eval` before your change and keep the output.
2. Make the change, run `npm run eval:check`. It lists every number that fell.
3. If the change is right anyway, or it improved something, run `npm run eval:update-baseline`.
4. Paste the before/after table it prints into the PR body, with one line on why each drop is acceptable.
   A change that improves a metric records its before/after numbers the same way.
5. Commit `baseline.json` with the change. Changing eval data or code means a new baseline too.

## Privacy

From issue #113: recordings stay local, or enter the repo only if every person in them consents. Nothing here uploads,
fetches or sends data anywhere; the eval reads local files only.

- Store landmarks, never video or photos. Do not commit images of people.
- A recorded session needs a `consent` block, and the validator rejects it without one.
- Use a pseudonym for `participant`. Do not put names, faces or other identifying details in `scene` or `source`.
- Without consent to share, keep the files local and uncommitted. The loader reads whatever is in `data/`, so
  check `git status` before every commit.

## Synthetic generator

`synthetic.mjs` is seeded (`SEED = 113`, mulberry32; never the platform RNG). `npm run eval:generate` rewrites
`data/synthetic/` and a rerun is byte-identical; a unit test and the CI job check that.

It produces 8 simulated bodies, each as MediaPipe-shaped and MoveNet-shaped, each with both calibration legs: 32
sessions, about 0.6 MB. Variation: shoulder width and torso and neck length, camera position, camera roll, body yaw,
a per-person comfortable offset per metric, slow posture drift, per-frame noise, 2, 3 and 5 fps with 25% timestamp
jitter, dropped frames (and one outage in dim scenes), NaN coordinates, dim lighting with lower confidence, and two
bodies whose hips are out of frame. Each session scripts good posture, then one slouch per metric (the trunk lean
slouch is skipped when the hips are out of frame), with 1 s ramps labeled `ignore` between segments and some good
stretches carrying a small offset that is still good. Angles are defined in the engine's normalized image space.
