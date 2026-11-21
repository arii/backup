# Implementation Plan: Feedback Design

Checked items are built. Unchecked items are **spec only**, or blocked (the reason is on the item).

- [x] 1. Specific cues, recovery praise, faded positive chime, opt-in spoken praise (shipped)
  - `posture-core.js` cues and `positive_chime`, `app.js` settings.
  - _Requirements: 1, 2, 3.1, 5.1_
- [x] 2. Silent retention test and separate `store.tests` (shipped)
  - _Requirements: 9.1_
- [x] 3. Pause with no tracking, reminders or praise (shipped)
  - _Requirements: 5.2, 8.3_
- [x] 4. `feedback.js` `FeedbackPolicy`
  - Levels, hourly cap, milestone ladder. Tests: `tests/js/feedback.test.mjs` (light never
    exceeds standard, milestone once per streak, cap enforced, absence resets streak).
  - _Requirements: 3.2, 3.3, 6, 7_
- [x] 5. Coaching level setting persisted as `store.coachingLevel`
  - _Requirements: 3.2, 3.4, 5.3_
- [x] 6. Milestone banners at 5, 15, 30, 60 minutes
  - Chime plus banner, spoken only with spoken praise on, existing clips only.
  - _Requirements: 6_
- [x] 7. Reminder cap and "Taking a break from reminders" status
  - _Requirements: 7.1, 7.2, 7.3_
- [x] 8. Progress view presents the silent test next to the coached score
  - _Requirements: 9.2, 9.3_
- [x] 9. Research doc and spec cross-links
  - `docs/research/feedback-and-habit-formation.md`.
  - _Requirements: 11_
- [x] 10. Shame-string deny-list test over banner and cue text
  - `tests/js/feedback.test.mjs`: every cue, milestone banner and spoken line in `voice-lines.js`, plus the visible text of the app page.
  - _Requirements: 1.3, 6.5_
- [x] 11. Suggest Light after repeated dismissals or mutes
  - `recordAnnoyance` and `shouldSuggestLight` in `feedback.js` (5 events in 7 days, a declined offer stays away 14 days). `app.js` records Snooze, Not now, Don't show again and a move to a quieter reminder style, and shows `#light-suggest` under Coaching level. It never switches on its own.
  - _Requirements: 7.4_
- [ ] 12. Adaptive fading driven by the retention score (blocked, needs real-user data)
  - Blocked: the fade thresholds and step size cannot be chosen or tested honestly without real retention-score data from users, and the app collects none (no server, issue #51). Any numbers now would be invented. Task 11 and the progress view's "try Light" hint (silent score at least as good as coached) are the data-free versions. Revisit when volunteers share exported scores. See open questions in the design.
  - _Requirements: 3_
