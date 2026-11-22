# Implementation Plan: Wellness Tools

Checked items are built. Unchecked items are **spec only** or deferred (the reason is on the item).

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
- [x] 4. Face Landmarker cost evaluation
  - Measured and written up in `docs/research/face-landmarker-evaluation.md`: model 3.76 MB (wasm shared), about 22 ms per frame on the CPU delegate (53 ms with pose), 12 % more offline size. Decision: **no-go** for blendshapes now. Numbers come from a server CPU and software WebGL, not a mid-range laptop.
  - _Requirements: 4.5, 4.6_
- [x] 5. Guided slow-breathing exercise and breathing moments (`breathing.js`)
  - "Breathe with me" and rotated one-line prompts. Tests in `tests/js/breathing.test.mjs`.
  - _Requirements: 3_
- [x] 6. Neck and shoulder micro-stretch prompts
  - Already covered: `stretch` is a scheduler prompt (`prompts.js`, off until chosen in Breaks & prompts, 10 minute gap, quiet start, no prompts while paused or in a silent test), and the "Take a break" menu and the prompt's "Show me" button run the guided neck, shoulder roll and chest demo (`wellness.js`, `DEMO_LINES`). The demo uses no camera, never scores form, and the card carries "Stop if anything hurts" (`TOOL_SAFETY`).
  - _Requirements: 5_
- [x] 7. 20-20-20 eye break with countdown (`breaks.js`)
  - _Requirements: 6.1, 6.2, 6.5_
- [x] 8. Face and jaw prompt, time-based part
  - `jaw` prompt in `breaks.js` and `prompts.js`, off until set to 30 or 45 minutes, with the required text in `BREAK_LINES.jaw` and the limit note "A webcam cannot see jaw tension. This is a reminder, not a reading." The blendshape proxy is not built (task 4 decision: no-go).
  - _Requirements: 4_
- [ ] 9. Blink reminder from `eyeBlink*` (deferred, not built)
  - Deferred by the task 4 decision: a blink lasts 100 to 400 ms, so 2 fps sampling misses most blinks, and 10 fps or more with pose running costs about half of the frame budget. It would also need a separate biometric consent and a legal re-review. See `docs/research/face-landmarker-evaluation.md`.
  - _Requirements: 6.3, 6.4_
- [x] 10. Stand and move timer with break counter (`breaks.js`)
  - _Requirements: 7_
- [x] 11. Render voice clips for any new spoken lines
  - `scripts/render-voice.mjs` via the voice-clips workflow. A line without a clip falls back to speechSynthesis.
  - _Requirements: 1.8_
