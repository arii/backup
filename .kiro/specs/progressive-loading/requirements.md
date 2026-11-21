# Requirements Document: Progressive Loading and Progressive Disclosure

## Introduction
First-time visitors to the browser app (`docs/app/`) think it is broken, and the page
shows a lot of checkboxes and text at once. This spec makes the first visit feel alive
and introduces the app in stages: show the live camera as early as possible, explain
what is loading, reveal panels and settings only as they become useful, and let the
user configure things step by step or skip all of it.

It extends `.kiro/specs/onboarding-and-setup/` (first-run card, "Learn the cues",
first-run guide), `.kiro/specs/wellness-tools/` (breath check, eye, move and stretch
prompts) and `.kiro/specs/safety-and-disclaimers/` (consent gate). It builds on PR #70,
which added the three-step start list in `docs/app/loading.js`.

Scope marker: untagged items are built. Items tagged **(spec only)** are designed and
not built. Everything below the "Already built" section is spec only unless stated.

## Baseline: what a first visitor sees today
Measured on the local build (`docs/` via `python3 -m http.server`), headless Chromium
with a fake camera and software WebGL (SwiftShader), fresh profile, no throttling,
unless noted. Real GPUs differ; treat as relative.

| Moment | 1280x800 | 320x640 |
|---|---|---|
| First contentful paint | 288 ms | 100 ms |
| Camera frames decoded (after click on Start) | 0.34 s | 0.19 s |
| Video actually visible (start overlay removed) | 3.8 s | 3.3 s |
| First scored frame (tracking running) | 4.5 s | 3.6 s |
| "settling in" ends (state good or slouch) | 5.2 s | 4.7 s |
| Video visible, simulated 1.5 Mbit/s link | 86.5 s | not run |

Page content at every stage (landing, onboarding done, start-ready, tracking):
about 840 to 860 words in the DOM, 48 to 49 visible controls, 10 checkboxes and radios.
Nothing is hidden or collapsed except the "Not working?" panel (`<details>`). The count
is the same before and after tracking starts, because the whole dashboard is rendered
on load. In the first viewport at 1280x800 there are 10 to 11 controls; at 320 px
there are 8 before the Start buttons appear and 2 after (the rest are below the overlay).
Findings that make it look broken:

1. The video is playing about 0.3 s after the click, but `#start-overlay` (opaque
   `rgba(20,23,28,.92)`, `docs/app/index.html` line 54) covers it until the model is
   warmed up. The user sees a dark card for 3 s (fast link) to 86 s (slow link).
2. The step list (PR #70) only starts after the click. Before that the page shows an
   empty dashboard: badge "waiting", fps "-", needle "--", four tiles of "-", disabled
   buttons with "Start the webcam first" tooltips.
3. The steps run in series: camera permission, then download, then warm-up. The model
   download (the long part) waits for the user to answer the camera prompt.
4. Right after the overlay goes, the first-run guide card, "Settling in" note, "This
   session", practice, test, progress, offline, breaks, consent, calibration and
   sounds panels all appear together.

## Already built (PR #70 and earlier)
- Three-step start list (`#load-steps`, `LoadSteps` in `docs/app/loading.js`): Allow the
  camera (hint after 8 s), Download the pose model (progress bar, "X of Y MB", slow note
  after 12 s), Start the model (spinner, hint after 6 s). `aria-busy` on the overlay,
  `aria-live="polite"` on the list.
- Model and WASM downloaded once as buffers (`downloadAll`, sizes from `precache.json`),
  fallback to MoveNet if MediaPipe fails, `warmUp()` before the dashboard shows.
- First-run walkthrough card (`#onboarding`, 3 steps, "I understand", `ONBOARDING_VERSION`,
  `ACK_VERSION`), first-run guide after first Start (`FIRST_RUN`, `#first-run`: framing,
  calibrate, sounds), Help button, "Not working?" panel, "Learn the cues".
- Consent gate (`consent.js`, `requireConsent`) for breath check, "Breathe with me",
  breathing moments and shoulder-creep reminders.
- Prompt scheduler (`prompts.js`): no non-posture prompt in the first 300 s, then at most
  one per 600 s, priority posture > breath > break > breathing > share. Auto breath check
  every `AUTO_BREATH_S` = 1200 s of good posture, only with consent and
  `settings.relaxReminders`.
- Tests: `tests/js/loading.test.mjs`, `tests/e2e/live-site.mjs`.

## What remains
- Nothing is shown before the click except a static dashboard and a dark card.
- The live camera is hidden behind the overlay during the whole load.
- Camera permission, download and warm-up are serial.
- No staged reveal: all panels and ten checkboxes show at once, before and after tracking.
- No guided configuration with a skip option beyond the first-run guide's three steps.
- The auto breath check cannot appear in the first 5 minutes, and nothing introduces it.
- Warm-up blocks the main thread; the spinner and elapsed time can freeze.
- There is no cheap way to start the download earlier (hover, focus or landing page).

## Requirements

### Requirement 1: Show the live camera immediately
**User Story:** As a visitor who pressed Start, I want to see myself right away, so I know
it is working.

#### Acceptance Criteria
1. WHEN the user presses `#start-camera`, THE App SHALL call `getUserMedia` and start the model download in parallel, not one after the other.
2. WHEN the first video frame is playing, THE App SHALL show the mirrored video in the stage and reduce `#start-overlay` to a compact status card that does not cover the video (a strip at the bottom of the stage, or beside the video at 320 px).
3. THE App SHALL NOT call `getUserMedia` before a user gesture (no auto-request on page load). Reason: the privacy page and the start copy say nothing uses the camera until the user chooses to.
4. WHILE the model is loading, THE App SHALL not draw skeleton, needle or posture text, and SHALL say "Camera is on. Loading the pose model, no video leaves your computer."
5. IF the camera is denied or missing, THE App SHALL show the existing `cameraErrorMessage` text and keep the demo button available. The download already started SHALL continue so the retry is fast.
6. THE demo path (`#start-demo`) SHALL not request the camera and SHALL not download the pose model.

### Requirement 2: Progress window that explains what is happening
1. THE status card SHALL keep the three PR #70 steps and ids (`#load-steps`, `#load-bar`, `#load-hint`) and add one plain sentence per step saying what it is for and that it stays on the device (for example, "The pose model is a 15 MB file. It runs in this tab; your video is never uploaded").
2. THE card SHALL show an overall percentage that combines download progress (weighted by bytes) and a fixed share for warm-up, so the bar never sits at 100 % while work remains.
3. WHEN warm-up runs, THE card SHALL show an elapsed-seconds counter that is updated by a timer running before the blocking call and SHALL state that the page may pause briefly.
4. THE card SHALL be a `role="status"` region. Step changes SHALL be announced once each (not on every progress tick). The progress bar keeps `role="progressbar"` and its value is updated at most every 250 ms.
5. WHEN a step runs long, THE existing slow hints (8 s, 12 s, 6 s) SHALL still show. A step that fails SHALL stay visible with a Retry button and a "Try the demo" link.
6. WHEN loading finishes, THE card SHALL hide itself and move focus to `#state-badge` as `begin()` does today. WHEN `prefers-reduced-motion: reduce` is set, the spinner SHALL be a static indicator and the bar SHALL not animate its width transition.
7. THE card SHALL reflow at 320 px without horizontal scroll.

### Requirement 3: A calm first paint
1. BEFORE tracking starts, THE App SHALL show the stage, a one-sentence promise, the two Start buttons, the privacy line and (first run only) the walkthrough. The empty needle, tiles, "This session", test, progress, offline, calibration, sounds and breaks panels SHALL NOT be shown.
2. THE page SHALL NOT show a "Sample" still or looping demo thumbnail before the click. Decision: skipped (the spec did not recommend it, and the Try the demo button already gives a no-camera preview).
3. THE first paint SHALL stay under 500 ms on the local build, unchanged from the baseline.
4. WHEN JavaScript fails to load, THE page SHALL show a `<noscript>` message that says the app needs JavaScript (today the page shows a dead dashboard).

### Requirement 4: Progressive disclosure of panels and settings
**User Story:** As a new user, I want to see only what I need now, and the rest when it
becomes useful.

#### Acceptance Criteria
1. THE App SHALL define reveal stages in a pure module `docs/app/reveal.js` (injected clock, no DOM, tested):
   - **Stage 0, before tracking:** stage, Start buttons, walkthrough, Help.
   - **Stage 1, tracking running** (first scored frame): "This session" summary, state badge, fps, Pause.
   - **Stage 2, settled** (state is good or slouch, not "settling in", for 10 s of scored frames): posture needle, "What to fix" box, tiles, and the setup steps of Requirement 5.
   - **Stage 3, 2 minutes of tracking with no setup error:** "Reminders & sounds" and "Calibrate to your desk".
   - **Stage 4, 5 minutes (the prompt quiet period ends) or on the first prompt:** "Breaks & prompts", "Relax, don't brace", the wellness menu, "Test me".
   - **Stage 5, after first session ends or on the second visit:** "Your progress", "Offline mode", Share, Sponsor card.
2. A returning user (`store.onboarded >= ONBOARDING_VERSION` and `store.firstRunDone`) SHALL jump to Stage 4 at settle and see all panels from the next visit's second session.
3. THE page SHALL include a persistent "Show all settings" button. Pressing it SHALL reveal everything, set `store.revealAll = true`, and be reversible ("Simplify the page").
4. Hidden panels SHALL use the `hidden` attribute (out of the tab order and the accessibility tree), not just CSS opacity.
5. WHEN a stage reveals, THE App SHALL announce it once in a `role="status"` line (for example, "Added: reminders and sounds") and SHALL NOT move focus, except when the user pressed the control that triggered it.
6. A panel the user opened by hand (Help, "Not working?", Show all settings) SHALL stay revealed for the session. Reveals SHALL never hide something already shown during the session.
7. IF the user pauses, switches to a silent test, or tracking stops (`stopCamera`), THEN the stage SHALL not go backward, and SHALL not advance during a pause or test.
8. THE ids of all existing controls SHALL NOT change (`#start-camera`, `#start-demo`, `#test-start`, `#breath-check`, and the e2e ids). Hidden controls SHALL still exist in the DOM so `setTrackingControls`, `renderPromptSettings` and the e2e script keep working.
9. THE settings checkbox count visible at the end of Stage 2 SHALL be at most 2, and visible words below the stage at most 150. (Baseline: 10 and about 840.)

### Requirement 5: Progressive configuration with "skip all"
**User Story:** As a user, I want to set things up one small step at a time, and skip
all of it if I want.

#### Acceptance Criteria
1. THE App SHALL extend the existing first-run guide (`FIRST_RUN`, `#first-run`) into a "Set up as you go" sequence. Each step is one card with one idea, shown after its reveal stage: (1) framing check (built), (2) calibrate good and slouch (built), (3) reminder style (Chime + voice, Chime only, Silent; and "say what to fix"), (4) sound pack and voice, (5) breaks: eye, move, stretch, water, (6) shoulder and breathing features (the consent step, Requirement 6).
2. EVERY card SHALL have **Skip this step** and a persistent **Skip all, use defaults** button. Skip all SHALL set `store.setupDone = true`, close the sequence, keep the defaults in `settings.js`, and SHALL NOT enable anything that is off by default (breathing moments, spoken praise, water reminders) and SHALL NOT record consent.
3. A skipped step SHALL be marked skipped, not done, and SHALL be available from a "Set up" button in the header (next to Help) and under "Show all settings".
4. Steps SHALL appear only while posture is good or settling, never during a posture reminder, pause, silent test or practice. The sequence waits, it does not queue behind the prompt scheduler.
5. Progress SHALL persist in `store.setup = {step, skipped:[...], done:[...]}` and SHALL be removed by "Delete my data".
6. A step that changes a setting SHALL apply it immediately and show it in the matching settings panel. The sequence SHALL be keyboard-operable, announce the step title in `role="status"`, and move focus to the card heading only when the user pressed Next or Skip.
7. THE sequence SHALL not repeat what the walkthrough and first-run guide already say; steps 1 and 2 are the existing `FIRST_RUN` entries, not new copies.

### Requirement 6: Automatic breath check after tracking has settled
1. THE App SHALL offer the first breath check automatically once, when all hold: stage is 2 or later, posture has been good for 60 s, no first-run or setup card is open, no posture reminder is showing, and the user has not turned the prompt off.
2. THE offer SHALL go through `PromptScheduler` as a prompt id `breath_intro` with the `breath` priority, and SHALL ignore `first_quiet_s` (300 s) exactly once per profile (`store.breathIntroShown`). The 600 s global gap SHALL still apply after it. (Open question: exemption versus waiting for the 5 min quiet period.)
3. IF `hasConsent(store)` is false, THE offer card SHALL say what is measured and offer **Try it** and **Not now**. **Try it** SHALL open the existing consent dialog (`requireConsent`). Declining SHALL not start the check, SHALL set a 10 min snooze through the scheduler, and SHALL leave the breath features off. The app SHALL never start a breath check without consent.
4. IF consent exists and `settings.relaxReminders` is true, THE automatic 20-minute check (`AUTO_BREATH_S`) SHALL continue unchanged, and `goodSinceBreath` SHALL reset when the intro check runs.
5. THE "Try a breath check" button (`#practice-breath`) and `#breath-check` SHALL stay and SHALL be revealed at the same stage as the offer (Stage 2 and 4 respectively).
6. THE breath check SHALL not run in demo mode unless the demo is on its good-posture phase, and SHALL not run while `lowAccuracy` is true (MoveNet fallback does not give a reliable shoulder signal).

### Requirement 7: Wellness menu (stretch, breath, eyes, water) (spec only)
**User Story:** As a user, I want one place to pick a break, with a short demo of each.

#### Acceptance Criteria
1. THE App SHALL add one "Take a break" menu (Stage 4) that lists: Stretch (neck and shoulder micro-stretch, `wellness-tools` Requirement 5), Breathe with me (built), Breath check (built), Look away (20-20-20 eye break, built in `breaks.js`), Stand and move (built), Drink water (new). It SHALL replace the separate buttons, not add to them.
2. EACH entry SHALL show a 10 to 20 second guided demo: a text and animated outline, no camera inference, no form coaching. Under `prefers-reduced-motion`, the demo is a static sequence of steps.
3. EACH entry SHALL be a scheduler prompt id with its own on/off setting, snooze and "don't show again", through `PromptScheduler` (no new timers outside it). Defaults: eye and move as built; stretch and water off until chosen in the setup sequence (Requirement 5 step 5).
4. **Water:** THE App SHALL NOT infer drinking from the camera in this spec. It offers a reminder (default off, interval 30, 45, 60, 90 minutes) and a one-tap "I drank" that adds to a local daily count (`store.water[YYYY-MM-DD]`), shown in "Your progress" and removed by "Delete my data". Reason: wrist-to-mouth is indistinguishable from eating, touching the face or a phone call with the pose model, and it would extend landmark use beyond what the consent text describes. A camera-based version would need its own consent text and version bump, and is an open question.
5. THE menu SHALL be reachable by keyboard, SHALL use `<button>` elements, and SHALL fit at 320 px.

### Requirement 8: Starting earlier without breaking the privacy promise
1. WHEN the user presses `#start-camera`, THE App SHALL start the model and WASM download at the same time as `getUserMedia` (Requirement 1.1). This needs no wording change: the user asked to start, files come from this site.
2. THE landing page (`docs/index.html`) MAY start a prefetch of the model and WASM when the user shows intent: pointer down, focus or hover (more than 150 ms) on the "Open the app" link. It SHALL be skipped when `navigator.connection.saveData` is true, `effectiveType` is `2g` or `slow-2g`, or the device is on a metered connection. It SHALL use `<link rel="prefetch">` or `fetch()` to the same origin only (CSP: `default-src 'self'`, `connect-src 'self'`, no change).
3. THE landing page SHALL NOT prefetch the model for every visitor on page load or idle. (Open question: user may choose otherwise, which needs the privacy wording change in Requirement 9.)
4. Prefetch SHALL NOT install a service worker. The service worker stays opt-in (`offline.js`).

### Requirement 9: Privacy and wording
1. `docs/privacy.html` line 50 says that without the Offline button "nothing is cached on purpose". WHEN Requirement 8.2 ships, THE page SHALL say: "Like any website, your browser may keep the pose model in its normal HTTP cache after you start the app. This is not the Offline mode and holds no video." The landing page privacy line (`docs/index.html` line 412) SHALL change the same way.
2. THE status card SHALL say the camera is on and nothing is uploaded, using the same wording as `#start-intro`.
3. THE water count and setup progress SHALL be listed in the privacy page's "what is stored" list.
4. No new third-party request, no analytics for load timing. Load timings (Requirement 10) are kept in memory and shown only in the bug report diagnostics (`bugReportUrl`) as numbers.

### Requirement 10: Measurement
1. THE App SHALL record `performance.now()` marks for: click, stream playing, download done, warm-up done, first scored frame, settled. They SHALL be added to the "Report a bug" diagnostics and to `window.__loadMarks` for e2e.
2. THE e2e script SHALL assert the video is visible (overlay not covering it) within 1.5 s of the click with the fake camera, even while the model is still loading (use a throttled model route to hold the download).

### Requirement 11: Accessibility, layout and compatibility
1. THE new status card, reveal line and setup cards use `role="status"` or `aria-live="polite"`, never `role="alert"` except for failures.
2. Focus: no automatic focus moves during load; at the end of load focus moves to `#state-badge` (unchanged). Setup cards move focus only after a user action.
3. Reduced motion is honored for the spinner, bar transition and reveal fade.
4. The app SHALL reflow at 320 px, tested in the e2e 320 px checks.
5. Colour contrast of the compact card on top of the video SHALL be at least 4.5:1 (use a solid dark card, not text on the video).
6. Demo mode: staged reveal works the same (stage clock from scored frames; the demo produces frames); `?clockScale=600` scales the reveal timers like prompt timers.
7. Browsers without WebGL: the compact card and reveal work the same on the MoveNet fallback, and the card keeps the fallback explanation.

### Requirement 12: Repository checks
1. `npm run check` SHALL pass (Biome lint and format, fallow dead code, JS tests, precache check).
2. WHEN files in `docs/app/` change, `node scripts/gen-precache.mjs` SHALL be run and the result committed.
3. `tests/e2e/live-site.mjs` and `video/scripts/capture.mjs` SHALL keep working (see tasks 9 and 10).

## Measured results
Measured after FEAT-001 to FEAT-006 with `tests/e2e/measure-load.mjs` (same setup as the
baseline: local build, headless Chromium, fake camera, software WebGL, fresh profile).
Times are from the click on Start with webcam.

| Moment | Before 1280x800 | After 1280x800 | Before 320x640 | After 320x640 |
|---|---|---|---|---|
| First contentful paint | 288 ms | 100 ms | 100 ms | 104 ms |
| Camera frames decoded | 0.34 s | 0.25 s | 0.19 s | 0.24 s |
| Video actually visible | 3.8 s | 0.40 s | 3.3 s | 0.25 s |
| First scored frame | 4.5 s | 5.4 s | 3.6 s | 4.6 s |
| "Settling in" ends | 5.2 s | 5.6 s | 4.7 s | 4.8 s |

| Throttled to 1.5 Mbit/s, 1280x800 | Before | After |
|---|---|---|
| Video visible | 86.5 s | 0.19 s |
| First scored frame | not recorded | 86.6 s (the download is the floor) |

| Page density (visible) | Before | After |
|---|---|---|
| Landing: checkboxes and radios | 10 | 0 |
| Landing: words / controls | about 840 / 48 | 200 / 15 |
| Stage 2: checkboxes and radios | 10 | 0 |
| Stage 2: words below the stage | about 820 | 76 |

Notes: the first scored frame varies by about 1 s between runs on software WebGL, so the
change from the baseline is within noise. At 320 px the first measurement after the staged
reveal showed the video at 3.6 s because the page stayed scrolled to the Start button and
the video sat above the viewport; `showLivePreview` now scrolls it into view
(`docs/app/app.js`) and `live-site.mjs` checks it.
