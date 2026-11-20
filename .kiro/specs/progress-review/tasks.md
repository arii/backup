# Implementation Plan: Progress Review and Leaderboard

Checked items are implemented in FEAT-003 on branch `feat/onboarding-specs-feedback`.
Unchecked items are **spec only**. The social leaderboard is spec only.

- [x] 1. `progress.js` aggregation
  - `summarize`, `exportJson`, `PROGRESS`. Tests: `tests/js/progress.test.mjs` (7-day window,
    null for sparse days, cumulative, test trend, `try_light`, bad input skipped).
  - _Requirements: 1, 3_
- [x] 2. "Your progress" panel
  - 7-day list, cumulative minutes, test trend vs coached, light-coaching suggestion, no
    streak-loss text.
  - _Requirements: 1_
- [x] 3. Export JSON and "Delete my data"
  - _Requirements: 2_
- [ ] 4. `store.schema` and Import JSON (spec only)
  - _Requirements: 4_
- [ ] 5. Local-date day keys and migration (spec only)
  - _Requirements: 5.5_
- [ ] 6. Daily relaxed-shoulders counters and trend (spec only)
  - Needs `day.relaxed_s` from `BracingMonitor`.
  - _Requirements: 5.3_
- [ ] 7. Weekly view, per-day best streak, coached vs silent chart (spec only)
  - _Requirements: 5.1, 5.2, 5.4_
- [ ] 8. Consistency score module with the 90% cap (spec only)
  - _Requirements: 6.6, 6.7_
- [ ] 9. Peer share link prototype, no server (spec only)
  - _Requirements: 6.1, 6.3, 6.4_
- [ ] 10. Consent dialog and settings toggle (spec only)
  - _Requirements: 6.1, 7.3_
- [ ] 11. Server option B: signed aggregate API, retention and delete endpoint (spec only)
  - Needs counsel on privacy policy, minors and data rights first.
  - _Requirements: 6.5, 6.10, 7_
