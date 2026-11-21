# Design Document: Activity States

## Module: `docs/app/activity.js`
Pure, injected time (seconds), tested in `tests/js/activity.test.mjs`.

```js
export const ACTIVITY = { TRACKING, PAUSED, SILENT_TEST, PRACTICE, BREATH_CHECK, BREATHE_GUIDE, EYE_BREAK, DEMO };
export class ActivityMachine {
  constructor({ leave_s, grace_s } = {})   // leave_s default DEFAULTS.state.no_person_timeout_s, grace_s default 10
  get current()                            // mode > foreground > TRACKING
  isActive(state)                          // true for a paused test as well as for PAUSED
  start(state, now)  -> boolean            // accepted?
  stop(state, now, reason = "completed") -> boolean   // reason: completed|cancelled|timeout|left_frame|mode
  observePresence(present, now) -> boolean // true once when an eye break or demo ends with left_frame
  inGrace(now)       -> boolean
  policy(now)        -> frozen policy row
  label(now)         -> string
  lastEnd                                  // { state, reason } of the latest end, or null
}
```

## States and layering
Modes (priority order): PAUSED > SILENT_TEST > PRACTICE. Foreground: BREATH_CHECK, BREATHE_GUIDE, EYE_BREAK, DEMO. Setup and calibration recording stay TRACKING; their first-run cards go through the `setupCards` field.

| Start | While a mode runs | Breath check | Guide | Eye break | Demo |
|---|---|---|---|---|---|
| mode (pause) | accepted (a pause may sit over a test); a test or practice is refused while paused | cancels it (`mode`) | cancels | cancels | cancels |
| BREATH_CHECK | refused | refused | accepted as hand-off (no grace) | refused | refused |
| BREATHE_GUIDE | refused | refused | refused | refused | refused |
| EYE_BREAK or DEMO | refused | refused | refused | replaces (no grace) | replaces (no grace) |

Test and practice exclude each other. Stopping PAUSED over a test returns to SILENT_TEST.

## Policy table
| State | frames | engine | reminders | praise | speak | score | prompts | setupCards | leaveCancels | graceAfter_s | label |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TRACKING | yes | track | yes | yes | yes | day | yes | yes | no | 0 | |
| PAUSED | no | track | no | no | no | none | no | no | no | 0 | Paused |
| SILENT_TEST | yes | track | no | no | no | test | no | no | no | 0 | Silent test |
| PRACTICE | yes | track | no | no | no | none | no | no | no | 0 | Learn the cues |
| BREATH_CHECK | yes | track | no | no | yes | day | no | no | no | 0 | Breath check |
| BREATHE_GUIDE | yes | hold | no | no | yes | none | no | no | no | 10 | Breathing, posture paused |
| EYE_BREAK | yes | hold | no | no | yes | none | no | no | yes | 10 | Eye break, posture paused |
| DEMO | yes | hold | no | no | yes | none | no | no | yes | 10 | Break, posture paused |
| (grace) | yes | track | no | no | yes | day | no | yes | no | 0 | |

Fields: `frames` (landmarks are processed at all), `engine` (`track` feeds `PostureEngine.process`; `hold` calls a new `PostureEngine.hold(landmarks, now)` that scores presence only and freezes the state machine, needle and calibration, with no nudges), `reminders` (posture reminders, the cue and fix box, reminder note), `praise` (timed, milestone, recovery, spoken), `speak` (any speech or clip), `score` (`day` daily totals and session good, bad, streak; `test` silent test only; `none`), `prompts` (PromptScheduler may open prompts), `setupCards`, `leaveCancels`, `graceAfter_s`, `label`.

## Grace
When EYE_BREAK, DEMO or BREATHE_GUIDE ends (any reason, not a hand-off), `graceUntil = now + 10`. While TRACKING and `now < graceUntil` the policy is the grace row. The app calls `engine.restart()` at the same time, so the 2 s `bad_sustain_s` dwell begins after the restart and a reminder cannot appear when a break ends. Resume from PAUSED keeps today's `restart()` and needs no grace.

## Cancel, timeout, leave
All endings go through `stop(state, now, reason)`. `observePresence` is fed once per frame; it ends EYE_BREAK or DEMO with `left_frame` after `leave_s` of continuous absence, only once, and the absence timer resets at every start and end. No break credit comes from `left_frame` or `cancelled`; `breaks.taken` stays on completion only.

## Ad hoc sites in `app.js` to replace (FEAT-003)
| Site | Today | Becomes |
|---|---|---|
| `speak` | checks `paused`, `test`, `practice` | `policy.speak` |
| `fire` | drops nudges by `paused`/`test`/`practice` | engine `hold` plus `policy.reminders`, `policy.praise` |
| `fireMilestone` | checks flags | `policy.praise` |
| `account` | tallies by `test`, breath | `policy.score` |
| `promptStep` / `PromptScheduler.poll` ctx | `{paused, test, breathCheck}` | `policy.prompts` |
| `setPaused` | sets flag, restarts | `start/stop(PAUSED)` |
| `setupBlocked` | flags | `policy.setupCards` |
| `revealStep` ctx | `paused`, `silentTest`, `practice` | `current` |
| `showSponsor` / `shouldOfferSponsor` `silent` | flags | `!policy.prompts` |
| `startGuide` / `openBreak` guards | flags | `start()` return value |
| `startPractice` / `startTest` guards | flags | `start()` return value |
| `render` / `renderFix` | flags | `policy.reminders`, `label` |

## Error handling
An unknown state or a refused start returns `false` and changes nothing. An unknown stop reason throws `TypeError` (a programming error). `stop` of an activity that is not running returns `false`.

## Test plan
Unit: transitions, rejected starts, layering of pause over test, each stop reason, grace timing with injected time, leave detection, labels, policy completeness and freezing. Property (seeded RNG): over random start, stop and time sequences, reminders and praise are false in every non-TRACKING state, in grace and while paused, and reminders are true only when TRACKING outside grace. App level: `tests/e2e/live-site.mjs` gets checks that an eye break shows no cue and no tally, and that grace holds reminders back.
