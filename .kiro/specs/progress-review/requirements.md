# Requirements Document: Progress Review and Leaderboard

## Introduction
Users should see how their posture changes over weeks, and whether the habit carries
over when coaching is off. The default is a **personal progress review** that never
leaves the device. A **social leaderboard is an opt-in, later phase and is spec only**.
It must preserve the privacy rule from `.kiro/steering/architecture.md`: video and
landmarks never leave the machine, and the core app needs no account.

Design stance and evidence: `docs/research/feedback-and-habit-formation.md`.

- Rewards that are tangible or expected can lower intrinsic motivation (Deci et al. 1999).
- Habits take weeks to months, and one missed day does not erase progress (Lally et al. 2010).
- The measure of learning is the silent retention test, not the coached score.
- Upright "perfect" posture is not proven to prevent pain (Slater et al. 2019), so no
  ranking may push people to hold still.

Scope markers: Untagged items are built. **(spec only)** designed, not built. Requirements 4, 5 and the no-server parts of 6 and 7 are built (peer share link). The server, ranking and age policy (6.5, 6.8 to 6.10, 7.1, 7.2, 7.4) are owner-only and not built.

## Requirements

### Requirement 1: Personal progress panel
**User Story:** As a user, I want to see my posture over time, so I can tell whether I
am improving.

#### Acceptance Criteria
1. THE App SHALL show a "Your progress" panel built from `store.days` and `store.tests`.
2. THE panel SHALL list the last 7 calendar days, each with good % and good minutes. Days with no tracked time SHALL show "no data", not 0%.
3. THE panel SHALL show cumulative good minutes over all stored days.
4. THE panel SHALL show the trend of silent-test scores from `store.tests` (most recent first, up to 10), next to the coached good % over the same period.
5. WHEN the latest silent-test good % is at least the coached good % of the preceding 7 days, THE panel SHALL show "You could try light coaching", linking to the Coaching level setting. The suggestion SHALL never change the setting by itself.
6. THE panel SHALL NOT show streak-loss, "you broke your streak", or comparison-to-others text.
7. THE aggregation SHALL be a pure function in `docs/app/progress.js` with node tests, taking `(store, now)` and returning plain data.

### Requirement 2: Data control
1. THE panel SHALL offer "Export JSON" that downloads the stored progress data (`days`, `tests`, `version`), without audio data URLs or calibration.
2. THE panel SHALL offer "Delete my data" that, after a confirm dialog, removes the `posture-guard:v1` key and reloads the app state.
3. Export and delete SHALL work without a network connection.

### Requirement 3: Honest numbers
1. Good % SHALL be computed only from tracked time (`good + bad` seconds). Time in `UNRELIABLE` or paused states SHALL NOT count as good or bad.
2. A day with fewer than `PROGRESS.min_tracked_s` (default 60) tracked seconds SHALL be shown as "too little to score" and excluded from trend lines.
3. Silent tests below 30 tracked seconds are already not stored; the panel SHALL NOT display any test that is missing `good` and `bad`.

### Requirement 4: Schema versioning and import
1. THE stored progress SHALL carry `store.schema` (integer). The reader SHALL accept missing as 1 and SHALL ignore unknown fields.
2. THE App SHALL offer "Import JSON" that validates shape and ranges, previews counts, and merges by day (keep the larger value per field, so a repeat merge changes nothing) or replaces, on user choice.
3. Import SHALL reject files above 1 MB, any value that is not a finite non-negative number, and any day with a seconds value above 86400 or good plus bad above 86400.

### Requirement 5: Richer trends
1. THE panel MAY show a weekly view (ISO weeks) in addition to days.
2. THE panel MAY show the best continuous good streak per day (needs `day.best` recorded).
3. THE panel MAY show a relaxed-shoulders trend. This needs a new daily counter from the bracing monitor (`day.relaxed_s`, `day.shoulder_s` as the measured denominator, `day.brace_events`), with the same privacy rule.
4. THE panel MAY show a coached versus silent comparison chart across weeks.
5. THE panel SHOULD use local dates for day keys. The shipped `todayKey()` uses UTC, so a migration plan is needed before weekly charts.

### Requirement 6: Social leaderboard (opt-in; peer link built, server ranking owner-only)
**User Story:** As a user who enjoys friendly comparison, I want to opt in to share an
aggregate score with a small group, without giving up privacy.

#### Acceptance Criteria
1. THE leaderboard SHALL be off by default and SHALL NOT appear in the UI until the user turns on "Share my weekly score" in settings and gives explicit consent in a dialog that lists exactly what is sent.
2. THE core app (tracking, reminders, progress review) SHALL work with no account, no sign-in and no network.
3. ONLY an aggregate record SHALL leave the device: `{schema, week, nickname, tracked_minutes, consistency_score, breaks_taken}`. Video, frames, landmarks, per-minute data, and device identifiers SHALL NOT be sent.
4. THE nickname SHALL be chosen by the user, pseudonymous, and changeable. THE App SHALL NOT ask for an email address or real name.
5. THE user SHALL be able to leave, and a request to delete their record SHALL be honoured with one action. Leaving SHALL not affect the local data.
6. THE ranking SHALL be computed over `consistency_score`, not raw good %. Consistency combines tracked time per day on at least N days, breaks taken, and relaxed-shoulder time (see design).
7. THE ranking SHALL NOT reward: sitting still, hiding from the camera (untracked time scores zero), leaving the app open with nobody present (presence checks), or holding rigid posture (a good % ceiling counts as 90%).
8. THE leaderboard SHALL show no prizes, coins or other tangible rewards, and SHALL NOT use loss-framed messages ("you dropped to rank 12").
9. THE leaderboard SHALL show the user's own trend by default and other people only as a small group (for example a friends list) with no global public ranking in the first release.
10. Users under the age set by the owner's legal review SHALL NOT be offered sharing (age policy: verify with counsel).

### Requirement 7: Privacy and safety of sharing (peer link built, server parts owner-only)
1. THE sharing channel SHALL use HTTPS, with no third-party trackers, and no cookies.
2. THE submit payload SHALL be signed on the client with a per-install key or a server-issued token to limit trivial forgery. Anti-cheat SHALL NOT require sending raw data.
3. THE privacy notice SHALL state retention (default: delete records older than 12 weeks) and how to delete.
4. A reduced-pressure mode SHALL let a user see only their own line while still contributing, or leave without a trace.
