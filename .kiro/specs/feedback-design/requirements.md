# Requirements Document: Feedback Design

## Introduction
How BackUp tells people they are doing well or poorly decides whether they keep
using it and whether the skill carries over when the app is off. This spec turns the
evidence in `docs/research/feedback-and-habit-formation.md` into testable rules for cues,
praise, reminders and sounds. The app is not clinically validated, and the evidence is
mostly from laboratory motor learning and workplace studies.

Existing behaviour that these rules describe or extend (shipped): specific "what to fix"
cues, chime then voice reminders (`bad_sustain_s` 2 s, `voice_delay_s` 10 s,
`voice_repeat_cooldown_s` 30 s), recovery praise, faded positive chime
(`positive_chime`: first after 15 s, then about every 90 s with growth 1.5 and jitter 0.25),
opt-in spoken praise, pause, and the silent "Test me" retention test.

Scope markers: **(shipped)**, **(built)**, **(spec only)**.

## Requirements

### Requirement 1: Cue content (shipped)
1. EVERY reminder SHALL name the specific thing to change (head forward, head tilt, shoulder
   level, lean) when a cue is known, and fall back to the generic prompt otherwise.
2. CUE wording SHALL be about the task or the movement ("tuck your chin", "level your
   shoulders"), not about the person ("you are lazy", "bad posture again").
3. NO wording SHALL shame, scold, count failures aloud, or compare to others.
4. CUES SHALL be immediate: a reminder SHALL fire within `state.bad_sustain_s` of confirmed
   bad posture plus the audio latency, not batched.

### Requirement 2: Positive feedback is earned (shipped)
1. PRAISE SHALL follow earned behaviour only: sustained good posture, recovery after a
   reminder, or an effort milestone. THE App SHALL NOT praise when tracking is unreliable,
   paused, no one is in view, or during the silent test.
2. RECOVERY praise SHALL fire when good posture is restored after a reminder.
3. PRAISE wording SHALL vary: the app SHALL cycle through its lines and SHALL NOT repeat
   the same line twice in a row.

### Requirement 3: Fading and bandwidth (shipped)
1. POSITIVE chimes SHALL be faded: first after about 15 s of good posture, then with
   growing gaps, so praise is rarer as good posture continues.
2. THE App SHALL offer a **Coaching level** setting: `standard` (current
   behaviour) and `light`.
3. `light` SHALL be lower-intensity feedback (it does not reduce the reminder count): banner and chime only on the first
   reminder of an episode, voice only after a second consecutive reminder episode within
   `FEEDBACK.light_episode_window_s` (default 600), and praise only at milestones and
   recovery. It SHALL NOT fire more reminders, voice lines or praises than `standard`
   for the same posture sequence.
4. THE default level SHALL be `standard`. THE App SHALL NOT switch levels without the user.
5. THE progress panel MAY suggest `light` (see `progress-review` Requirement 1.5).

### Requirement 4: Escalation (shipped)
1. A reminder episode SHALL start with a short chime and banner. A spoken prompt SHALL be
   added only after the user stays in bad posture for `state.voice_delay_s`.
2. SPOKEN prompts SHALL be rate limited by `state.voice_repeat_cooldown_s`.
3. THE escalation SHALL NOT go beyond a spoken prompt. No louder or harsher tier SHALL exist.

### Requirement 5: User control (shipped)
1. SPOKEN praise SHALL be off by default and opt-in (shipped).
2. THE user SHALL be able to choose the mode (silent, chime, chime and voice), toggle
   specific cues, pause, and run the silent test at any time (shipped).
3. THE user SHALL choose the Coaching level.
4. THE App SHALL let the user mute everything with the existing mode "silent" and with Pause.

### Requirement 6: Effort milestones
1. THE App SHALL show a milestone banner and play the positive chime after 5, 15, 30 and 60
   continuous good minutes.
2. EACH milestone SHALL fire at most once per continuous good streak. A bad episode
   resets the streak and the milestone ladder.
3. MILESTONE praise SHALL be spoken only if spoken praise is on, using existing praise
   clips. It SHALL NOT use new spoken text.
4. MILESTONE wording SHALL reward effort and time ("30 minutes of steady posture"), not a
   score and not a streak count that can be lost.
5. THE App SHALL NOT show any "streak broken" or "you lost" message, in any view.

### Requirement 7: Alarm fatigue
1. THE App SHALL cap reminders to `FEEDBACK.max_reminders_per_hour` (default 30, high enough
   not to change the demo or e2e behaviour).
2. WHEN the cap is reached, THE App SHALL show "Taking a break from reminders" in the
   status area until the hour window frees capacity, and SHALL stop reminder sounds and
   speech but keep the on-screen state.
3. THE App SHALL count recovery praise and milestone chimes separately from reminders.
4. WHEN a user dismisses or mutes reminders repeatedly, THE App MAY suggest the `light`
   level (built: `shouldSuggestLight` in `feedback.js`).

### Requirement 8: Auditory design (shipped)
1. THE positive sound SHALL be a short rising major arpeggio.
2. THE corrective sound SHALL be a short falling two-tone, at moderate volume, with no
   harsh timbre, no alarm siren, and no repeated bursts.
3. NO sound SHALL play during pause or the silent test or "Learn the cues" practice.
4. THE built-in tones SHALL keep the shipped peak gain (0.5 in `app.js` `tones()`), and any custom
   sound the user uploads is the user's choice.

### Requirement 9: Retention is the measure of learning (shipped)
1. THE silent "Test me" SHALL show no reminders, praise or sounds, and its result SHALL be
   stored separately in `store.tests`.
2. THE progress view SHALL present the test result as "how you do without coaching" next to
   the coached score, and SHALL NOT merge the two.
3. THE App SHALL NOT call a coached score a measure of learning.

### Requirement 10: Reward restraint (shipped rule, spec only for social)
1. THE App SHALL NOT use points, coins, badges that unlock features, or other tangible
   rewards for posture behaviour.
2. ANY later social feature SHALL follow `progress-review` Requirement 6.

### Requirement 11: Evidence honesty
1. DOCUMENTATION SHALL cite sources with their verification status and limits, and SHALL
   say the app is not clinically validated.
