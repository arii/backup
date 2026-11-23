# Implementation Plan: Onboarding and Setup

Checked items are built.
Unchecked items are **spec only**.

- [x] 1. `onboarding.js` pure module
  - `ONBOARDING_VERSION`, `ACK_VERSION`, `SETUP`, `shouldShowOnboarding`,
    `markOnboarded`, `SetupCheck` with injected clock. Uses `Reason` from `posture-core.js`.
    Tests: `tests/js/onboarding.test.mjs` (each diagnosis, persistence delay, priority,
    NON_FINITE hold, ack versioning).
  - _Requirements: 1.6, 3_
- [x] 2. Walkthrough card in `#start-overlay` (superseded by #81: one welcome card with the
  safety notice on demand)
  - "I understand" writes `ackVersion` and `onboarded`. Start buttons keep their ids.
  - _Requirements: 1, 7.1_
- [x] 3. Help button and dialog
  - Welcome text, a "Good to know" list (the panel explanations moved there in #90),
    *Learn the cues* and *Not working?*.
  - _Requirements: 2_
- [x] 4. "Not working?" panel
  - Checklist from `SetupCheck`, *Learn the cues*, *Show the intro again* and Report a bug.
    Since #90 it shows only when there is something to fix, a start step is slow or
    failed, or the user asks for it in Help.
  - _Requirements: 4_
- [x] 5. "Learn the cues" practice mode
  - Silent gating shared with the retention test.
  - _Requirements: 5_
- [x] 5a. Live mini skeleton and needle in the practice panel
  - `renderMiniViews`, `.mini-view`; e2e asserts the canvas is drawn and the needle moves in the demo.
    The "Not working?" copy was removed in #90.
  - _Requirements: 5a_
- [x] 6. Accessibility pass
  - Labels, focus states, `aria-live`, Escape handling, 375 px, reduced motion.
  - _Requirements: 6_
- [x] 7. E2E and capture scripts
  - Seed `posture-guard:v1`; add the fresh-context onboarding check.
  - _Requirements: 7_
- [x] 8. Camera framing guide on the preview (superseded: built as the framing step of the progressive setup in `.kiro/specs/progressive-loading`, task 4)
  - _Requirements: 8.1_
- [x] 9. One-minute "calibrate and learn" sequence (superseded: merged into the calibrate step and stage 2 reveal of `.kiro/specs/progressive-loading`, tasks 3 and 4)
  - _Requirements: 8.2_
- [x] 10. Remember last working camera device
  - `openCamera()` in `app.js` stores `store.cameraDeviceId` from the working track, requests it with `deviceId: {exact}` next time (`cameraConstraints` in `settings.js`), and on `OverconstrainedError`, `NotFoundError` or `NotReadableError` (`isDeviceGoneError`) forgets it and asks again for the default camera. Permission errors are not retried. Resolution is not remembered. Listed on the privacy page.
  - _Requirements: 8.3_
