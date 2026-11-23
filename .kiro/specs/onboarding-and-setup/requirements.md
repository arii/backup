# Requirements Document: Onboarding and Setup

## Introduction
A first-time visitor to the browser app (`docs/app/`) should understand within a
minute what BackUp does, how to place the camera, what they will see and hear,
and what the app does with their video. If tracking does not work well, the app should
say why in plain language and show the fix. This spec extends Requirement 8 (browser
app) of `.kiro/specs/posture-guard/` and depends on `.kiro/specs/safety-and-disclaimers/`
for the safety notice text.

Scope marker: untagged items are built. Items tagged
**(spec only)** are designed and not built.

## Requirements

### Requirement 1: First-run welcome
**User Story:** As a first-time visitor, I want a short welcome, so I know what the app
does and that it is safe to try before the camera turns on.

#### Acceptance Criteria
1. WHEN `store.onboarded` is missing or lower than `ONBOARDING_VERSION`, THE App SHALL show the welcome card (`#onboarding`) inside `#start-overlay` before the Start buttons act.
2. THE welcome SHALL be one card (`ONBOARDING_STEPS` in `docs/app/onboarding.js`, one entry) with an "I understand" button. Changed by #81: it replaced a three-step walkthrough (how it works, what you will see and hear, safety).
3. THE card SHALL say, in at most three short points, that the camera gives a reminder when you slouch and the video stays on the device, that breaks and breathing are optional, and the short safety text (`SAFETY_SHORT`).
4. THE full safety notice (`SAFETY_POINTS`) SHALL be available on demand from the card ("Full safety notice", a closed `<details>`) and from the footer *Safety* link, without leaving the page.
5. Camera placement SHALL be shown on the start overlay (`#start-intro`) and in the *Get comfortable* setup card, not in the welcome.
6. WHEN the user presses "I understand", THE App SHALL write `store.ackVersion = ACK_VERSION` and `store.onboarded = ONBOARDING_VERSION`, save, and reveal `#start-camera` and `#start-demo` as before.
7. THE ids `#start-camera`, `#start-demo`, `#test-start` and `#breath-check` SHALL NOT change.

### Requirement 2: Help
1. THE App SHALL show a "Help" button in the header that opens the Help dialog (`#help-dialog`). It SHALL show the welcome text, a "Good to know" list (one line each on reminder timing, break prompts, coaching levels, the silent test, storage and the offline copy), and the buttons *Learn the cues* and *Not working?*.
2. Opening Help SHALL NOT clear `store.ackVersion` and SHALL NOT interrupt a running session.

### Requirement 3: Setup check
**User Story:** As a user whose tracking is poor, I want to know what is wrong and how
to fix it.

#### Acceptance Criteria
1. THE `SetupCheck` SHALL take per-frame input `{reason, state, fps, metricsPresent}` and an injected clock and return one diagnosis.
2. THE diagnoses SHALL be: `no_person_in_view` (from `Reason.NO_POSE`), `low_light_or_blocked` (from `Reason.LOW_VISIBILITY`), `too_close_or_far` (from `Reason.FRAMING_OUT_OF_BAND`), `low_fps` (fps below 8), and `ok`.
3. A diagnosis other than `ok` SHALL be reported only after the condition has persisted for `SETUP.persist_s` seconds (default 4). A single bad frame SHALL NOT change the diagnosis.
4. `ok` SHALL be reported only after `SETUP.ok_s` seconds (default 5) of frames with `metricsPresent` true and none of the faults above.
5. WHEN several faults hold at once, THE SetupCheck SHALL report them in a fixed priority: `no_person_in_view`, `low_light_or_blocked`, `too_close_or_far`, `low_fps`.
6. `Reason.NON_FINITE` frames SHALL be ignored (they hold the previous diagnosis), matching the engine.
7. Each diagnosis SHALL map to plain-language fixes (see design).

### Requirement 4: "Not working?" troubleshooting
1. THE App SHALL show the "Not working?" panel (`#setup-panel`, a plain panel with a heading) only while the setup check reports a fix, while a start step is slow or has failed, or after the user picks *Not working?* in Help. WHILE tracking looks good and none of these hold, THE panel SHALL be hidden. (Changed by #90; before, it showed from the start of tracking.)
2. THE panel SHALL show the current diagnosis, its fixes as a checklist, *Learn the cues*, *Show the intro again* and a *Report a bug* link. It SHALL NOT repeat the generic camera placement tips, which are on the start overlay and the *Get comfortable* card.
3. THE panel text SHALL change in an `aria-live="polite"` region.
4. THE panel SHALL cover: camera permission denied or no camera found, camera used by another app, low light or backlight, too close or too far, no one in view, low frame rate (close other tabs, lower resolution), and WebGL or model load failure.

### Requirement 5: Learn the cues
1. THE App SHALL offer a guided practice mode that steps through: sit tall, push your head forward, tilt your head, raise one shoulder, lean to one side.
2. EACH step SHALL light the matching metric tile when the live metric crosses its threshold, and SHALL advance only on user action ("Next"), never on a timer.
3. WHILE practice mode is active, THE App SHALL play no sounds, speak nothing, and record no stats (same gating as the silent test, `body.testing`).

### Requirement 5a: Live mini view
1. WHILE practice mode is active, THE practice panel SHALL show a compact mirrored posture skeleton and a small needle gauge, fed by the same landmarks and needle value as the main stage and needle panel.
2. THE "Not working?" panel SHALL NOT hold a mini view. (Removed by #90: it repeated the stage and the needle panel.)
3. THE mini skeleton SHALL use the same wire colours as the main skeleton, and THE mini needle SHALL use the same rotation as the main needle.
4. WHILE the silent test is running, THE mini views SHALL be hidden and SHALL not be drawn.

### Requirement 6: Accessibility
1. EVERY onboarding control SHALL have a text label, a visible focus state and be reachable by keyboard in reading order.
2. Text that changes (diagnosis, step titles) SHALL be in an `aria-live` region.
3. THE walkthrough SHALL work at 375 px width and honour `prefers-reduced-motion`.
4. THE walkthrough SHALL be dismissible with Escape except at the safety acknowledgement step, which needs the explicit button.

### Requirement 7: Test and capture bypass
1. THE e2e script (`tests/e2e/live-site.mjs`) and `video/scripts/capture.mjs` SHALL seed `localStorage` key `posture-guard:v1` with the current `ackVersion` and `onboarded` via `context.addInitScript` so they reach `#start-demo`.
2. A dedicated e2e check SHALL use a fresh context to assert the walkthrough shows, the Start buttons work after acknowledgement, the safety footer exists, Help reopens the card, and acknowledgement persists after reload.

### Requirement 8: Setup coaching beyond the check (built)
1. THE App MAY offer a camera preview framing guide (shoulder-width target band) before the session starts.
2. THE App MAY offer a one-minute "calibrate and learn" sequence combining calibration with the cue practice.
3. THE App MAY remember the last working camera device and resolution (built for the device; resolution is not remembered).

### Requirement 9: Privacy of diagnostics
1. THE SetupCheck SHALL use only reason, state, fps and a boolean. It SHALL NOT store or transmit frames or landmarks.
2. THE bug-report link SHALL stay a user-initiated link with prefilled text and no automatic upload.
