# Design Document: Feedback Design

## Principles to rules
| Principle (source in `docs/research/`) | Rule | Where |
|---|---|---|
| Guidance effect: frequent feedback helps now, hurts retention (Salmoni 1984, Winstein 1990) | Faded praise, Light level, retention test | `positive_chime`, `feedback.js`, `store.tests` |
| Task-level feedback beats self-level feedback (Kluger & DeNisi 1996) | Cues name the movement, never judge the person | `cueText` in `posture-core.js` |
| Autonomy and positive feedback aid learning (Wulf & Lewthwaite 2016; Chiviacowsky & Wulf 2005) | Opt-in praise, level, mode, pause | settings in `app.js` |
| Tangible rewards undermine motivation, verbal positive feedback helps (Deci et al. 1999) | Verbal and banner praise only, no points | milestones |
| Habits take weeks, misses do not reset (Lally 2010 via Gardner 2012) | No streak-loss messaging | progress view, milestones |
| Alarm fatigue (Sendelbach & Funk 2013) | Hourly reminder cap with a visible note | `feedback.js` |
| Sounds carry urgency (Hellier & Edworthy 1999) | Low-urgency tones for posture | `tones()` in `app.js` |

## Module: `docs/app/feedback.js`
Pure, injected time, unit-tested in `tests/js/feedback.test.mjs`. It decides *whether* a
feedback action is allowed. `app.js` still plays sounds and shows banners.

```js
export const FEEDBACK = Object.freeze({
  max_reminders_per_hour: 30,
  light_episode_window_s: 600,
  milestones_min: [5, 15, 30, 60],
});
export const LEVELS = ["standard", "light"];
export class FeedbackPolicy {
  constructor(level = "standard", cfg = FEEDBACK)
  setLevel(level)
  // Called when the engine emits a reminder nudge; returns { allow, voice, capped }
  onReminder(now, { episodeId })
  // Called when GOOD time accrues; returns a milestone minute (5, 15, 30, 60) or null
  onGood(now, dt)
  // Called when bad posture or an untracked gap resets the good streak
  onBad()
  // Called for recovery and regular praise; returns allow boolean
  onPraise(kind, now)
  reset()
}
```
Decision details:
- **Standard**: allow every reminder the engine emits (subject to the hourly cap). Voice
  allowed whenever the engine says voice (current behaviour).
- **Light**: first reminder of an episode is banner and chime, voice suppressed. Voice
  allowed only when the previous episode ended less than `light_episode_window_s` ago
  (a second consecutive episode). Regular timed praise is suppressed. Recovery and
  milestone praise still allowed.
- **Cap**: sliding one-hour window of granted reminders. When full, `allow` is false and
  `capped` true. The status line shows "Taking a break from reminders".
- **Milestones**: `onGood` accumulates continuous good seconds. When the total crosses a
  threshold in `milestones_min` that has not fired in this streak, it returns that minute
  once. `onBad` clears the accumulator and the fired set. Gaps longer than 5 s between
  `onGood` calls (pause, no person) also reset the streak so absence is not rewarded.
- Pause and silent test: `app.js` does not call `FeedbackPolicy` at all while paused or
  testing, and does not play audio then. A guard in `fire()` enforces this as well.

## Sounds
Positive: rising major arpeggio (existing `playGood`). Corrective: short falling two-tone
(existing `playBad`). Peak gain 0.5 with exponential decay. No new sounds.
No spoken text is added (`docs/app/voice-lines.js` is not modified; new lines would have
no rendered clip and fall back to robotic speech).

## Milestone copy (banner only, no new speech)
- 5 min: "5 minutes of steady posture"
- 15 min: "15 minutes of steady posture"
- 30 min: "30 minutes of steady posture. Remember to move soon."
- 60 min: "An hour of steady posture. Stand up and move for a minute."
Spoken, if spoken praise is on: an existing `PRAISE` line.

## Persistence
`store.coachingLevel` ("standard" or "light"). Missing means standard. Invalid values are
treated as standard.

## Correctness properties
- **P1 light never exceeds standard**: for any scripted sequence of reminder episodes, the
  count of allowed reminders, voice lines and praises under `light` is less than or equal
  to the count under `standard`.
- **P2 milestone once**: each milestone fires at most once per continuous good streak,
  and in increasing order. After `onBad`, the ladder restarts.
- **P3 absence is not a streak**: a gap above 5 s between good samples resets the streak.
- **P4 cap**: in any 3600 s window, granted reminders are at most `max_reminders_per_hour`.
- **P5 silence**: while paused or in the silent test, no reminder, praise, milestone or sound
  is produced.
- **P6 praise rate bounded**: timed praise count per minute is at most 1 (the faded
  schedule has a first gap of 15 s then growing gaps, and spoken praise rides on the chime).
- **P7 no shame strings**: a test over banner and cue strings fails on a deny-list (for
  example "lazy", "bad posture again", "streak lost", "failed").
- **P8 default**: with no stored level, behaviour equals `standard`.

## Open questions (spec only)
- A third level "off until I ask" that relies on Test me.
- Adaptive fading from the retention score. Needs data on real users first.
- Haptics or wearable output. Out of scope for a browser app.
