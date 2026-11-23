# Design Document: Onboarding and Setup

## Modules
- `docs/app/onboarding.js`: pure, no DOM, injected time, unit-tested in
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

## One live view (no mini views)
Earlier builds drew a compact `.mini-view` (a second canvas skeleton and needle) in the
"Not working?" panel and in the practice panel. Users read them as a confusing duplicate,
so #90 and #92 removed both. Learn the cues now uses the main stage skeleton and the
gauge; the angle tiles under the gauge show only while `body.practicing` is set. After
the last step `body.practice-done` keeps the practice panel up with *Try a breath check*
and *Close*. `mini-view.js` keeps only `needleTransform`, used by the main gauge.

## "Not working?" visibility
`app.js` keeps a set of reasons (`setupWhy`): `start` (a slow hint while starting, a
failed or stopped start, no WebGL) and `asked` (Help → *Not working?*). The panel is shown
while the set is not empty. A successful start clears `start`; *Hide* clears `asked`.
The setup check still runs and fills the panel's status and fixes, so they are current
whenever it is opened.

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
Account creation, analytics on onboarding completion, and remembering the camera
resolution. The camera device id is remembered (Requirement 8.3).
