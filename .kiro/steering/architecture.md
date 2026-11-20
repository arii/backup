# BackUp: Steering and Engineering Standards

## File headers and style
- Every newly created source file (`.js`, `.mjs`, `.ts`, `.tsx`, `.sh`) starts with:
  ```
  // Author: Ariel Anders
  // Copyright (c) 2026 Ariel Anders
  // SPDX-License-Identifier: MIT
  ```
  (`#` comments in shell scripts). Do not add or change headers on existing files.
- Vanilla ES modules in `docs/app/`, no bundler and no runtime dependencies. Match the
  surrounding style; comments explain why, not what.

## The app
- **The browser app is the only product** (`docs/app/`, GitHub Pages). The old Python
  desktop app was removed; do not reintroduce a second implementation.
- **Webcam is the only camera**, read with the tasks-vision PoseLandmarker. The
  shoulder-width framing gate stands in for a depth sensor. "Try the demo" runs
  scripted good and slouch poses without a camera.
- After ANY change under `docs/app/`, run `node scripts/gen-precache.mjs`; CI runs it
  with `--check`. It rewrites `precache.json` and the cache version in `sw.js`.

## Configuration
- Thresholds, dwell times, smoothing constants, calibration windows and praise timing
  live in `DEFAULTS` in `docs/app/posture-core.js`. Do not hardcode them elsewhere.
- Changing a default means updating the config recorded in
  `tests/js/fixtures/golden-timeline.json` only if the golden test says it must; the
  fixture is a frozen regression record, not a generated file.

## Time and state
- **Injected time.** The state machine, needle smoother, baseline and calibration
  recorder take `now` (seconds) from frame timestamps. Never read the clock inside
  scoring, state, needle or calibration logic.
- **Frame-rate independence.** Any EMA uses `alpha = 1 - exp(-dt / tau)`, never a
  per-frame constant. Windows must work at 2 fps and with jittered timestamps.
- **Glitches hold state.** `Reason.NON_FINITE` (NaN/inf landmarks) leaves every
  streak, timer, the baseline and calibration untouched.

## Privacy
- Frames and landmarks never leave the machine. Settings and calibration live in
  `localStorage` (key `posture-guard:v1`).
- The app is self-hosted: the MediaPipe runtime, WASM and pose model live in
  `docs/app/vendor/` (versions and sha256 in its README, Apache-2.0 LICENSE alongside).
  `docs/app/index.html` carries a meta CSP limiting everything to `'self'`. Do not add a
  third-party origin without updating the CSP, `docs/privacy.html` and the live-site
  e2e check that asserts no cross-origin requests.

## Testing
- `node --test "tests/js/*.test.mjs"` (Node 22, `node:test`, no dependencies). Every
  module has a `tests/js/<name>.test.mjs`. Randomized properties use a seeded RNG, never
  `Math.random`, and no test may be skipped.
- `npm run check` also runs Biome lint and format and fallow dead-code (config in `biome.json`,
  `.fallowrc.json`). Do not export symbols only to test them from nowhere; fallow flags them.
- New behavior in `posture-core.js` needs a unit, property or golden-timeline test.
- `tests/e2e/live-site.mjs` is the Playwright end-to-end check (CSP, vendored files,
  reflow, first run). CI serves `docs/` locally and runs it.
- CI (`.github/workflows/ci.yml`) runs the node tests, the precache check, the vendored
  file checksums, the e2e and ShellCheck on every branch.

## Safety and claims
- BackUp is a wellness tool. No copy, spec or code comment may claim to
  diagnose, treat, prevent or cure a condition, or that it improves health outcomes.
  Do not call the research "proof" or the app "clinically validated".
- The safety notice text lives in one place (`SAFETY_SHORT` and `SAFETY_POINTS` in
  `docs/app/onboarding.js`). Reuse it; keep README and landing page
  consistent with it. Changing its meaning means bumping `ACK_VERSION` so users are
  asked again. Bumping `ONBOARDING_VERSION` or `ACK_VERSION` also means updating the
  hard-coded values in `tests/e2e/live-site.mjs` and `video/scripts/capture.mjs`.
- The disclaimer wording is a draft and not legal advice. A lawyer reviews it before a
  wider launch.

## Feedback design
- Follow `docs/research/feedback-and-habit-formation.md` and
  `.kiro/specs/feedback-design/`: cues are specific and task-focused, praise is opt-in
  and earned, no shaming or streak-loss messages, no punishing sounds, no sound during
  pause or the silent test, and an hourly reminder cap.
- Do not edit spoken strings in `docs/app/voice-lines.js` without re-rendering the
  clips with `scripts/render-voice.mjs`. New text without a clip falls back to robotic
  speech synthesis.
- Browser-only helper modules (`relax.js`, `onboarding.js`, `progress.js`,
  `feedback.js`) stay pure: no DOM, injected time, with a matching test in `tests/js/`.
- Label each new feature as implemented or spec only in the docs. Cite a source as
  verified only if its abstract or page text was read.
