# Implementation Plan: Onboarding and Setup

Checked items are implemented in FEAT-003 on branch `feat/onboarding-specs-feedback`.
Unchecked items are **spec only**.

- [x] 1. `onboarding.js` pure module
  - `ONBOARDING_VERSION`, `ACK_VERSION`, `SETUP`, `shouldShowOnboarding`,
    `markOnboarded`, `SetupCheck` with injected clock. Uses `Reason` from `posture-core.js`.
    Tests: `tests/js/onboarding.test.mjs` (each diagnosis, persistence delay, priority,
    NON_FINITE hold, ack versioning).
  - _Requirements: 1.6, 3_
- [x] 2. Walkthrough card in `#start-overlay`
  - Three steps, "I understand" writes `ackVersion` and `onboarded`. Start buttons keep
    their ids.
  - _Requirements: 1, 7.1_
- [x] 3. Help button and replay
  - _Requirements: 2_
- [x] 4. "Not working?" panel
  - Checklist from `SetupCheck`, existing WebGL help and `#report-bug`.
  - _Requirements: 4_
- [x] 5. "Learn the cues" practice mode
  - Silent gating shared with the retention test.
  - _Requirements: 5_
- [x] 6. Accessibility pass
  - Labels, focus states, `aria-live`, Escape handling, 375 px, reduced motion.
  - _Requirements: 6_
- [x] 7. E2E and capture scripts
  - Seed `posture-guard:v1`; add the fresh-context onboarding check.
  - _Requirements: 7_
- [ ] 8. Camera framing guide on the preview (spec only)
  - _Requirements: 8.1_
- [ ] 9. One-minute "calibrate and learn" sequence (spec only)
  - _Requirements: 8.2_
- [ ] 10. Remember last working camera device (spec only)
  - _Requirements: 8.3_
