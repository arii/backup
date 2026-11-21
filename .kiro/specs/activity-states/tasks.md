# Implementation Plan: Activity States

- [ ] 1. Baseline: run unit and e2e checks before changing behaviour
  - _Requirements: 6.3_
- [x] 2. Spec: requirements, design, tasks (this folder)
- [x] 3. Pure state machine `docs/app/activity.js` with `tests/js/activity.test.mjs`
  - Unit and seeded property tests for layering, grace, stop reasons and leave detection.
  - _Requirements: 1, 3, 4, 5_
- [ ] 4. `PostureEngine.hold` and wiring in `app.js`
  - Replace the flags listed in design.md, restart the engine at break end, feed `observePresence`, show the label with `aria-live`.
  - _Requirements: 1.2, 2, 4, 5, 7_
- [ ] 5. e2e checks and docs
  - Eye break shows no cue and no tally, grace holds reminders back, label shown; update `wellness-tools` requirement 1.5 note and the README if needed.
  - _Requirements: 2, 5, 6.3, 7_
