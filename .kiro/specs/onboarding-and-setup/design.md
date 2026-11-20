# Design Document: Onboarding and Setup

## Modules
- `docs/app/onboarding.js` (FEAT-003): pure, no DOM, injected time, unit-tested in
  `tests/js/onboarding.test.mjs`. Same pattern as `relax.js`.
- `docs/app/app.js`: wires the card, the Help button, the panel and practice mode, and
  owns `store`/`save()`.
- `docs/app/index.html`: markup inside `#start-overlay`, header Help button, panel.

```
frame result ──> SetupCheck.update({reason,state,fps,metricsPresent}, now)
                      │
                      ├─> diagnosis ──> status line + "Not working?" panel (aria-live)
                      └─> ok        ──> panel shows "Tracking looks good"
```

## Constants (onboarding.js)
```js
export const ONBOARDING_VERSION = 1;   // bump to re-show the walkthrough
export const ACK_VERSION = 1;          // bump to re-ask the safety acknowledgement
export const SETUP = Object.freeze({ persist_s: 4, ok_s: 5, low_fps: 8 });
export function shouldShowOnboarding(store) // true if onboarded < ONBOARDING_VERSION or ackVersion < ACK_VERSION
export function markOnboarded(store)        // sets onboarded and ackVersion, returns store
export class SetupCheck { update(frame, now) -> {diagnosis, fixes, since_s} }
```
`Reason` comes from `posture-core.js` (`NO_POSE`, `LOW_VISIBILITY`,
`FRAMING_OUT_OF_BAND`, `NON_FINITE`). No change to `posture-core.js`.

## Storage
`store.onboarded` (int) and `store.ackVersion` (int) in `posture-guard:v1`. Missing or
non-numeric values count as 0. A future higher `ACK_VERSION` re-asks only the safety
step, not the whole walkthrough, when `onboarded` is current.

## Diagnosis table
| Diagnosis | Trigger | Plain-language fixes |
|---|---|---|
| `no_person_in_view` | `Reason.NO_POSE` for `persist_s` | Sit so your head and shoulders are in frame. Check the camera is not covered. Check you picked the right camera. |
| `low_light_or_blocked` | `Reason.LOW_VISIBILITY` for `persist_s` | Face a light source. Move a lamp behind the screen, not behind you. Move hair, hands or a mug away from your ears and shoulders. |
| `too_close_or_far` | `Reason.FRAMING_OUT_OF_BAND` for `persist_s` | Move about an arm's length from the screen. Your shoulders should span between 12% and 65% of the frame width. |
| `low_fps` | fps < 8 for `persist_s` | Close other tabs and video calls. Plug in the laptop. Try a lower camera resolution. |
| `ok` | `metricsPresent`, no fault, for `ok_s` | None. |

The `too_close_or_far` message uses the live band from `DEFAULTS.scoring`, not a
hard-coded number, so it follows the defaults in `posture-core.js`.

## State machine of SetupCheck
`candidate` diagnosis changes every frame. `since` resets when the candidate changes.
The reported diagnosis switches to the candidate only when `now - since >= persist_s`
(`ok_s` for `ok`). NON_FINITE frames leave candidate and since untouched.

## Practice mode ("Learn the cues")
Reuses the `body.testing` gating (no audio, no stats, no reminders). Each step has a
target metric id (`head_forward`, `head_tilt`, `shoulder_level`, `trunk_lean`, from `CUE_METRICS`) and lights the matching
tile via the existing metric render path. "Next" is manual.

## Live mini view
The stage is hidden behind the start overlay during onboarding and the needle panel
sits in the other column, so instructions alone are hard to follow. The practice panel
and the "Not working?" panel each hold a `.mini-view`: a 160x120 canvas (mirrored with
CSS like the stage) and a small SVG gauge with the same arcs as the main needle.
`renderMiniViews` in `app.js` runs from `render()`, reuses `drawSkeleton` (parameterised
by canvas, context and scale) and the same `rotate((needle + 1) * 90)` transform. It
draws only while its panel is visible and never during the silent test
(`body.testing .mini-view` is hidden and the needle value is withheld).

## Correctness properties
- **P1 persistence**: for any frame sequence where a fault lasts less than `persist_s`,
  the reported diagnosis never leaves its previous value.
- **P2 priority**: given two simultaneous faults, the higher-priority one is reported.
- **P3 ok needs evidence**: `ok` is never reported before `ok_s` seconds of good frames
  and never while a fault is active.
- **P4 hold on glitch**: NON_FINITE frames do not change the diagnosis or any timer.
- **P5 ack versioning**: `shouldShowOnboarding` is true for any store with
  `ackVersion < ACK_VERSION` and false once `markOnboarded` has run for the current
  versions.
- **P6 silence**: while the walkthrough card or practice mode is open, no sound is
  played and `store.days` does not change.

## Test and capture bypass
`context.addInitScript` seeds `localStorage["posture-guard:v1"]` with
`{"onboarded":1,"ackVersion":1}` merged with any existing value. Use the exported
constants' current values; update the scripts when versions are bumped.

## Out of scope
Account creation, analytics on onboarding completion, and per-browser device memory
(spec only, Requirement 8).
