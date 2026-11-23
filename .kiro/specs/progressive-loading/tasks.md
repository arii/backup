# Implementation Plan: Progressive Loading and Progressive Disclosure

Checked items are built.
Unchecked items are **spec only**.

Already shipped by PR #70, not repeated here: three-step start list, byte progress,
slow hints, single download as buffers, MoveNet fallback, warm-up under a spinner
(`docs/app/loading.js`, `tests/js/loading.test.mjs`).

- [x] 1. Measure and add load marks
  - Add `performance.now()` marks (click, stream playing, download done, warm-up done,
    first scored frame, settled) to `window.__loadMarks` and `bugReportUrl()` diagnostics.
  - [x] Keep the measurement script from this spec's baseline as `tests/e2e/measure-load.mjs`
    (optional, not run in CI). Done in FEAT-001; baseline re-measured and matches the table.
  - _Requirements: 10_
- [x] 2. Parallel camera and model start, live preview
  - `app.js` `#start-camera` handler: start `loadModel` or `loadMoveNet` before awaiting
    `getUserMedia`; cache the result for retry; show the video as soon as frames play.
  - `loading.js`: `LoadSteps.start/done` for two active steps; `overallPercent`; throttle
    progress to 250 ms; keep `#load-steps`, `#load-bar`, `#load-hint` ids.
  - `index.html` and CSS: `.overlay-msg.compact` strip over the live video (below the
    video at 320 px), solid background, reduced-motion spinner.
  - Per-step explanation sentences, warm-up elapsed counter, Retry and "Try the demo" on
    failure, `<noscript>` message.
  - Tests: extend `tests/js/loading.test.mjs`; e2e: video visible within 1.5 s with the
    model route held.
  - _Requirements: 1, 2, 3.4, 9.2, 10.2, 11_
- [x] 3. Staged reveal of panels and settings
  - New `docs/app/reveal.js` and `tests/js/reveal.test.mjs` (properties R1 to R5).
  - `index.html`: `data-stage` wrappers (ids unchanged), closed `<details>` for settings
    groups, `#reveal-note`, `#reveal-all` button. `app.js`: call `reveal.update` per frame
    with the scaled clock; persist `store.revealAll`.
  - Check at 320 px, in the demo, on the MoveNet fallback and after `stopCamera`.
  - Built in FEAT-003. Measured with `tests/e2e/measure-load.mjs`: at stage 2, 0 visible
    checkboxes and 76 words below the stage (baseline 10 and about 820). e2e seeds `revealAll`
    and `setupDone` (task 8 seeds done for `live-site.mjs`; `capture.mjs` still open).
  - Changed by #81: automatic stages are 0 to 2 only. *Explore more* (three choices, stored in
    `store.explored`) and *Show all settings* open the rest. #86 removed the unreachable
    `returning`/`seasoned` jumps and the "Added: …" notes for stages 3 to 5.
  - Changed by #90: no `<details>` in `<main>`; settings are flat with short labels, panel
    explanations moved to Help, "Not working?" shows only when needed and has no mini view,
    and the fix box is hidden while posture is good. e2e checks at most 25 words at stage 2
    and 200 after *Explore more*, with no visible `summary`.
  - _Requirements: 3.1, 4, 11_
- [x] 4. Progressive setup with "Skip all"
  - Extend `FIRST_RUN` with style, voice, breaks and shoulders steps; delay to stage 2;
    Skip this step, Skip all, header "Set up" button; `store.setup`, `store.setupDone`.
  - Pure helpers and tests in `onboarding.js` and `tests/js/onboarding.test.mjs`
    (skip all grants no consent, enables nothing off by default).
  - Update "Delete my data" to clear `store.setup`, `store.water`, `store.breathIntroShown`.
  - Built in FEAT-004. Steps: framing, calibrate (stage 2), style, voice (stage 3), breaks,
    shoulders, done (stage 4). Changed by #81: the automatic sequence is framing, calibrate
    (good posture only) and done; style, voice, breaks and shoulders are `optional` and open
    only from the header *Personalize* button. Cards drive the real controls (one write path). `skipAll`
    marks the open steps skipped so the header "Set up" button can reopen them. The privacy
    page lists setup progress and the water count (water arrives in task 7).
  - _Requirements: 5, 9.3_
- [x] 5. Automatic breath check intro after tracking has settled
  - `prompts.js`: `breath_intro` id with one-time quiet exemption; tests in
    `tests/js/prompts.test.mjs`.
  - `app.js`: enqueue after stage 2 plus 60 s good posture; consent via `requireConsent`;
    reset `goodSinceBreath`; skip when `lowAccuracy`.
  - e2e: intro asks for consent, declining stores nothing, accepting runs the check.
  - Built in FEAT-004. Offered up to 3 times (`store.breathIntroOffers`), then
    `store.breathIntroShown`. e2e seeds `breathIntroShown` unless a check opts in with
    `intro: true`, because the offer holds back the first eye break by the 10 min gap.
  - _Requirements: 6_
- [x] 6. Intent prefetch on the landing page
  - `docs/prefetch.js`, linked from `docs/index.html`; skips on Save-Data and 2g.
  - Privacy wording in `docs/privacy.html` (line 50) and `docs/index.html` (line 412).
  - e2e: one request per vendor file across landing then app.
  - Built: `docs/prefetch.js` fetches the model and WASM on pointerdown, focus, or hover over 150 ms
    of the Launch link; skipped on Save-Data and 2g; privacy text updated.
  - _Requirements: 8.2 to 8.4, 9.1_
- [x] 7. Wellness menu: stretch and water
  - "Take a break" menu consolidating Stretch, Breathe with me, Breath check, Look away,
    Stand and move, Drink water; guided demos in `#prompt-card`; `stretch` and `water`
    scheduler ids; local water count in "Your progress".
  - Build on `wellness-tools` Requirement 5 (stretch). Water camera detection is not
    planned.
  - Built: `docs/app/wellness.js`; water reminder off by default plus an "I drank" count in
    "Your progress", cleared by Delete my data.
  - _Requirements: 7_
- [x] 8. Update e2e and capture scripts
  - `tests/e2e/live-site.mjs`: seed `setupDone` and `revealAll` next to `onboarded`,
    `ackVersion`, `firstRunDone` (init script around lines 98 to 105); keep clicks on
    `#start-demo` and `#start-camera`; adjust the places that open `#setup-panel summary`
    (lines 599, 648); add the scenarios listed in design.md.
  - `video/scripts/capture.mjs`: add the same seeds (lines 41 to 43), wait for the compact
    card to go after the clicks on `#start-demo` (line 72) and `#start-camera` (line 108).
  - Built in FEAT-006. `live-site.mjs` already had the seeds and the design.md scenarios (video
    within 1.5 s with the model route held, stage 0 at most 2 checkboxes, stage 2 reveal, clockScale
    reveal, Show all settings, skip all, breath intro, 320 px per stage); a 320 px check that the
    video is in view while the model loads was added. `capture.mjs` seeds `setupDone`, `revealAll`
    and `breathIntroShown` and waits for `#start-overlay` to go after both Start clicks; the demo,
    webcam and landing recordings ran against the local build.
  - _Requirements: 10, 12.3_
- [x] 9. Docs and checks
  - Run `node scripts/gen-precache.mjs` after `docs/app` changes.
  - Update README/landing screenshots if the first view changes (`video/scripts/capture.mjs`).
  - Mark `onboarding-and-setup` tasks 8 and 9 as superseded or merged where overlapping.
  - Run `npm run check`.
  - Built in FEAT-006. `onboarding-and-setup` tasks 8 and 9 are marked superseded. The first view
    did not change in a way that needs new README or landing screenshots (the landing page is
    untouched; the app first view only gained the compact card), so none were regenerated.
  - Re-measured: see "Measured results" in requirements.md.
  - _Requirements: 12_

## Order and parallelism
Tasks 1 and 2 first (2 delivers most of the "looks alive" value). Task 3 depends on 2 for
the compact card. Tasks 4 and 5 depend on 3 and can be done in parallel. Task 6 is
independent. Task 7 is independent and spec only. Task 8 follows each of 2 to 5 and is
finished last; do not leave e2e red between tasks.

## Open questions for the user
1. Camera on page load, or only after the click? Recommended: only after the click.
   **Decision: only after the click. The model download starts in parallel with the camera prompt.**
2. Prefetch the 15 MB model: never, on intent (hover or focus on "Open the app"), or for
   every visitor on idle? Recommended: on intent, plus parallel start on click.
   **Decision: on intent (hover, focus, pointerdown), skipped on Save-Data and 2g.**
3. Should the first breath check ignore the 5 minute quiet start once, or wait for it?
   **Decision: ignore it once (one-time exemption in `prompts.js`); it still goes through the
   scheduler and always asks for consent first.**
4. Water: reminder and "I drank" tap only, or also camera-based detection later (new
   consent text, false positives with eating and phone calls)?
   **Decision: reminder (off by default) and "I drank" tap only, no camera detection.**
5. How strict should staging be: reveal by time and tracking state as designed, or let
   people open everything with one click from the start (design has both)?
   **Decision: staged reveal as designed, plus an always-available "Show all settings".**
6. Show a sample looping demo in the stage before the click (small asset), or keep it text?
   **Decision: deferred, not built. The spec did not recommend it, it adds an asset to the
   precache, and "Try the demo" already gives a no-camera preview (requirements 3.2).**

- [x] Pre-start screen budget: minimal app start screen, About & credits dialog, and a collapsed-by-default landing page (see requirements.md, "Pre-start screen budget").
