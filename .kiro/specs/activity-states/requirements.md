# Requirements Document: Activity States

## Introduction
When the app asks the user to look 20 feet away (the 20-20-20 eye break), it must not
also comment on posture. The same holds for the guided stretch, move, water and jaw
demos and for "Breathe with me". Today this is decided by separate flags in
`docs/app/app.js` (`paused`, `test`, `practice`, `breath.active`, `guide.active`, `card`).
This spec replaces them with one explicit activity state machine
(`docs/app/activity.js`) that says what the app may do in each state. Related specs:
`wellness-tools` (the activities), `feedback-design` (reminders and praise).

**User story:** As a person taking an eye break, I want the app to stay quiet about my
posture while I look away, so that the break is a break and my posture score is not
hurt by looking at something far away.

## Requirements

### Requirement 1: One source of truth
1. THE App SHALL hold exactly one current activity state, one of: TRACKING, PAUSED, SILENT_TEST, PRACTICE, BREATH_CHECK, BREATHE_GUIDE, EYE_BREAK, DEMO.
2. EVERY decision to remind, cue, praise, speak, tally, open a prompt or show a first-run card SHALL read the policy of the current state, not a separate flag.
3. THE machine SHALL be pure: no DOM, no clock. Every call SHALL take the time as an argument.

### Requirement 2: Eye break and other suppressing activities
1. WHILE the state is EYE_BREAK, DEMO or BREATHE_GUIDE, THE App SHALL show no posture reminder, no cue or fix box, no timed, milestone, recovery or spoken praise, and no posture note.
2. WHILE the state is EYE_BREAK or DEMO, THE App SHALL NOT add to the slouch or good-posture tallies, the daily totals, the streak or the silent test. Looking away or stretching is not slouch time.
3. WHILE the state is EYE_BREAK, DEMO or BREATHE_GUIDE, THE posture engine SHALL NOT change its machine, needle or calibration and SHALL NOT emit nudges. It MAY still note whether a person is present.
4. THE activity SHALL still speak its own guided lines.
5. WHILE one of these activities runs, THE App SHALL open no new non-posture prompt.

### Requirement 3: Layering and exclusion
1. PAUSED, SILENT_TEST and PRACTICE are modes. A mode SHALL cancel any running foreground activity and SHALL block starting one.
2. BREATH_CHECK, BREATHE_GUIDE, EYE_BREAK and DEMO are foreground activities and SHALL be mutually exclusive, with these existing exceptions: starting a demo or an eye break replaces an open eye break or demo, and the breathing guide hands off to the breath check.
3. THE user SHALL still be able to pause during a silent test. When the pause ends, the test continues.
4. A silent test and practice SHALL exclude each other, and neither SHALL start while paused.
5. PAUSED SHALL always win: when paused the policy is the PAUSED policy, whatever else is active.

### Requirement 4: Ending an activity
1. EVERY activity SHALL end through one call that names a reason: completed, cancelled, timeout, left_frame or mode.
2. Stop or Not now (cancelled), the 60 s card timeout (timeout), the end of the 20 s countdown (completed, at the moment it ends and not after the closing text), starting a pause or a test (mode) and leaving the frame (left_frame) SHALL each end the activity.
3. WHEN the user has been out of frame for `no_person_timeout_s` (2 s) during an EYE_BREAK or DEMO, THE machine SHALL end it with left_frame. Leaving the frame SHALL NOT grant break credit. Break credit SHALL still be granted only on completion, as today. The 2 minute away rule in `breaks.js` is unchanged.
4. A glance away shorter than `no_person_timeout_s` SHALL NOT end the activity. Being absent before an activity starts SHALL NOT end it at once.

### Requirement 5: Grace after a break
1. WHEN EYE_BREAK, DEMO or BREATHE_GUIDE ends for any reason, THE App SHALL run a grace period of 10 s. During it the app tracks and scores again but shows no reminder, cue or praise and opens no prompt.
2. WHEN the activity ends, THE engine SHALL be restarted (history and timers cleared), as when a pause ends, so that the normal 2 s bad-posture dwell applies after grace.
3. THE grace length SHALL be a named constant in `activity.js`, not part of `DEFAULTS`.
4. A hand-off between activities (guide to breath check, eye break to demo) SHALL NOT start grace between them.

### Requirement 6: What stays as it is
1. BREATH_CHECK SHALL keep today's scoring (shoulders are being measured) but show no reminder or praise.
2. WHILE SILENT_TEST or PRACTICE, THE App SHALL keep its current behaviour: no reminders, no praise, no speech, and the test counts to the silent test only.
3. WITH no activity running, THE App SHALL behave exactly as before. Existing unit tests and the e2e script SHALL pass unchanged.
4. THE prompt budget (quiet start, 10 minute gap, cooldowns) SHALL be unchanged.

### Requirement 7: Visible state
1. WHILE a suppressing activity runs, THE App SHALL show a gentle label (for example "Eye break, posture paused"). It SHALL contain no health claim and no judgement.
2. THE label SHALL be announced politely (`aria-live`) and SHALL NOT need colour to be understood.
3. Progress views SHALL NOT count activity time as slouching or as good posture.
