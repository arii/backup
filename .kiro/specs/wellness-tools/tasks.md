# Implementation Plan: Wellness Tools

Checked items are shipped (PR #37) or implemented in FEAT-003. Unchecked items are
**spec only**. FEAT-003 builds none of the unchecked items.

- [x] 1. Breath check and bracing monitor (shipped, PR #37)
  - `relax.js` (`BracingMonitor`, `BreathCheck`), `#breath-check`, tests in
    `tests/js/relax.test.mjs`.
  - _Requirements: 2_
- [x] 2. One-line safety sentence under the "Relax, don't brace" panel (FEAT-003)
  - Text comes from the shared safety constant in `safety-and-disclaimers`.
  - _Requirements: 1.2_
- [ ] 3. `wellness.js` `PromptBudget` and settings master switch (spec only)
  - Tests for hourly cap, minimum gap, pause and test gating.
  - _Requirements: 1_
- [ ] 4. Face Landmarker cost evaluation (spec only)
  - Measure model size, load time, fps and CPU at 2 fps on a mid-range laptop, with and
    without pose running. Decide go or no-go for blendshapes.
  - _Requirements: 4.5, 4.6_
- [ ] 5. Guided slow-breathing exercise (spec only)
  - `BreathingGuide`, circle animation, reduced-motion fallback.
  - _Requirements: 3_
- [ ] 6. Neck and shoulder micro-stretch prompts (spec only)
  - _Requirements: 5_
- [ ] 7. 20-20-20 eye break with countdown (spec only)
  - _Requirements: 6.1, 6.2, 6.5_
- [ ] 8. Face and jaw prompt, time-based first (spec only)
  - Blendshape proxy only after task 4.
  - _Requirements: 4_
- [ ] 9. Blink reminder from `eyeBlink*` (spec only)
  - _Requirements: 6.3, 6.4_
- [ ] 10. Stand and move timer with break counter (spec only)
  - _Requirements: 7_
- [ ] 11. Render voice clips for any new spoken lines (spec only)
  - Needs Kokoro via `scripts/render-voice.mjs`. Until then tools are text and chime only.
  - _Requirements: 1.8_
