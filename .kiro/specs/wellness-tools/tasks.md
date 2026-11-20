# Implementation Plan: Wellness Tools

Checked items are built. Unchecked items are **spec only**.

- [x] 1. Breath check and bracing monitor (shipped, PR #37)
  - `relax.js` (`BracingMonitor`, `BreathCheck`), `#breath-check`, tests in
    `tests/js/relax.test.mjs`.
  - _Requirements: 2_
- [x] 2. One-line safety sentence under the "Relax, don't brace" panel
  - Text comes from the shared safety constant in `safety-and-disclaimers`.
  - _Requirements: 1.2_
- [x] 3. Shared prompt scheduler and "Breaks & prompts" settings (`prompts.js`, `settings.js`)
  - Priorities, a 10 minute gap, a quiet start, and no prompts while paused or in a silent test. Tests in `tests/js/prompts.test.mjs`.
  - _Requirements: 1_
- [ ] 4. Face Landmarker cost evaluation (spec only)
  - Measure model size, load time, fps and CPU at 2 fps on a mid-range laptop, with and
    without pose running. Decide go or no-go for blendshapes.
  - _Requirements: 4.5, 4.6_
- [x] 5. Guided slow-breathing exercise and breathing moments (`breathing.js`)
  - "Breathe with me" and rotated one-line prompts. Tests in `tests/js/breathing.test.mjs`.
  - _Requirements: 3_
- [ ] 6. Neck and shoulder micro-stretch prompts (spec only)
  - _Requirements: 5_
- [x] 7. 20-20-20 eye break with countdown (`breaks.js`)
  - _Requirements: 6.1, 6.2, 6.5_
- [ ] 8. Face and jaw prompt, time-based first (spec only)
  - Blendshape proxy only after task 4.
  - _Requirements: 4_
- [ ] 9. Blink reminder from `eyeBlink*` (spec only)
  - _Requirements: 6.3, 6.4_
- [x] 10. Stand and move timer with break counter (`breaks.js`)
  - _Requirements: 7_
- [x] 11. Render voice clips for any new spoken lines
  - `scripts/render-voice.mjs` via the voice-clips workflow. A line without a clip falls back to speechSynthesis.
  - _Requirements: 1.8_
