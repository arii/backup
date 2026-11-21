# Design Document: Wellness Tools

## Architecture
```
Pose frames (shipped) ─────────> PostureEngine ──> reminders / praise
        │                                   │
        └─> BracingMonitor, BreathCheck (relax.js, shipped)
                                            │
                     PromptBudget (spec only) ◄── every non-posture prompt asks first
                       ▲        ▲        ▲        ▲
         BreathingGuide  JawPrompt  StretchPrompts  EyeBreak/Blink  MoveTimer   (built, except the face model and blink)
                                  │                       │
                  Face Landmarker (optional second model, lazy, ~2 fps)
```

## Shipped
`docs/app/relax.js`: `RELAX` (config), `neckRatio`, `BracingMonitor`, `BREATH_PHASES`
(`inhale_s 5`, `exhale_s 4`, `settle_record_s 3`), `BreathCheck`. Tests in
`tests/js/relax.test.mjs`. The breath check is a diagnostic ("did your shoulders rise?"),
not the guided exercise below.

## Spec only: shared pieces
### PromptBudget (`docs/app/wellness.js`, pure, injected time)
```js
export const WELLNESS = Object.freeze({ max_prompts_per_hour: 6, min_gap_s: 120 });
class PromptBudget { request(kind, now) -> boolean; record(kind, now); snooze(kind, until) }
```
`request` returns false when the hourly cap or minimum gap would be violated, when the
app is paused, in test or practice mode, or when the Coaching level is Light and the tool
is not marked essential. Posture reminders are not subject to this budget but are counted
toward the combined alarm-fatigue cap in `feedback-design`.

### Settings
Each tool has `store.wellness.<tool> = { on:false, ... }`. Defaults off. A single
"Wellness prompts" master switch in settings gates all of them.

## Tool designs
### Guided breathing
Pure `BreathingGuide` with phases `[inhale, exhale]`, injected clock, and a `progress(now)`
in [0, 1] that drives a CSS scale. Reduced motion shows "In... 3, 2, 1". No sensing needed
(it does not use the camera). Stats are not recorded.

### Face and jaw tension
What the camera can honestly do:
| Signal | Source | What it tells you | Limit |
|---|---|---|---|
| Mouth corners | Pose `mouth_left`, `mouth_right` | Rough mouth width. | No jaw, no tongue. |
| `jawOpen` | Face Landmarker blendshape | Mouth open amount. | A clenched and a relaxed closed mouth look the same. |
| `mouthPress*` | blendshape | Lips pressed together. | Lip tension is not jaw tension. |
| `browDown*`, `eyeSquint*` | blendshape | Frowning or squinting. | Also caused by glare and expression. |
Decision: a **time-based prompt** is the primary trigger. Blendshapes may only pull the
prompt earlier when brow-down and squint stay high for a minute, to catch concentrated
frowning. No numbers are shown.

Cost: a second model (the face landmarker bundle, several MB) and extra CPU. Run it at
about 2 fps on the existing video element, on a separate loop from pose. Load lazily
on opt-in. Evaluate cost on a mid-range laptop before building (task 4).

### Micro-stretch prompts
A list of short strings with `id` and `text`, rotating without repeats until all have
been shown. Rendered in the banner. No sensing.

### 20-20-20 and blink
`EyeBreak` counts tracked seconds. At 1200 s it requests a prompt and runs a 20 s
countdown. Blink: from `eyeBlinkLeft/Right` crossing a threshold (for example 0.5),
count blinks per 60 s window. If the count is below a low threshold for two windows in a
row, request a prompt. Thresholds are tunable constants in `WELLNESS`. Never display
the rate.

### Movement break
`MoveTimer` accumulates tracked sitting seconds, requests a prompt at the interval, and
on a 30 s absence after the prompt counts one break and resets.

## Correctness properties (spec only)
- **P1 budget**: over any 60 minute window, `PromptBudget` grants at most
  `max_prompts_per_hour` prompts and no two within `min_gap_s`.
- **P2 silence**: no tool prompt is granted during pause, silent test or practice.
- **P3 off means off**: with the master switch off, no model is loaded and no timer runs.
- **P4 no leak**: no tool issues a network request except the one-time model download.
- **P5 proxy is never sole trigger**: the jaw prompt fires on its time interval even if
  all blendshape inputs read relaxed.
- **P6 absence is not failure**: leaving the frame never lowers any stored score.
- **P7 light never exceeds standard**: for the same inputs, Light grants no more tool
  prompts than Standard.

## Risks
- Face model download and CPU on weak machines: gate behind opt-in and a visible note.
- Misreading blendshapes as a health signal: no numbers, no claims, copy review via
  `safety-and-disclaimers`.
- Prompt overload: the global budget and the Coaching level cap it.
