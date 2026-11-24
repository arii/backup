# Requirements Document: Onboarding and Setup

## Introduction
A first-time visitor to the browser app (`docs/app/`) should understand within a
minute what BackUp does, how to place the camera, what they will see and hear,
and what the app does with their video. If tracking does not work well, the app should
say why in plain language and show the fix. This spec extends Requirement 8 (browser
app) of `.kiro/specs/posture-guard/` and depends on `.kiro/specs/safety-and-disclaimers/`
for the safety notice text.

The #98 PRD (storyboard v3) is the source for the main screen, onboarding, Settings and landing page; where this spec disagrees, the PRD wins.

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
1. THE App SHALL show a "Help" button in the header that opens the Help dialog (`#help-dialog`). It SHALL show the welcome text (with the short safety line) and the buttons *Learn the cues* and *Not working?*, and nothing else. Help is also the last row in Settings (#96). (#92 removed the "Good to know" list that #90 had added: removed explanations are deleted, not moved.)
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
1. THE App SHALL show the "Not working?" panel (`#setup-panel`, a plain panel with a heading) on the main screen only while a start step is slow or has failed, or after the user picks *Not working?* in Help. *Hide* puts away a panel the user opened. Otherwise THE panel SHALL be hidden. (Changed by #90 and #92; before, it showed from the start of tracking. Live tracking problems show as one line in `#warnings` above the gauge.)
2. THE panel SHALL show the current diagnosis, its fixes as a checklist, *Learn the cues*, *Show the intro again* and a *Report a bug* link. It SHALL NOT repeat the generic camera placement tips, which are on the start overlay and the *Get comfortable* card.
3. THE panel text SHALL change in an `aria-live="polite"` region.
4. THE panel SHALL cover: camera permission denied or no camera found, camera used by another app, low light or backlight, too close or too far, no one in view, low frame rate (close other tabs, lower resolution), and WebGL or model load failure.

### Requirement 5: Learn the cues
1. THE App SHALL offer a guided practice mode that steps through: sit tall, push your head forward, tilt your head, raise one shoulder, lean to one side.
2. EACH step SHALL light the matching metric tile when the live metric crosses its threshold, and SHALL advance only on user action ("Next"), never on a timer.
3. WHILE practice mode is active, THE App SHALL play no sounds, speak nothing, and record no stats (same gating as the silent test, `body.testing`).

### Requirement 5a: One live view
1. Learn the cues SHALL use the main video, skeleton and posture gauge. THE App SHALL NOT draw a second skeleton or needle anywhere (no `.mini-view`). (#90 removed the copy in "Not working?"; #92 removed the one in the practice panel. Both were the "duplicate skeleton" users found confusing.)
2. WHILE practice mode is active, THE angle tiles under the gauge SHALL be shown, so the step can light the matching tile. Otherwise they SHALL be hidden.
3. WHEN the last step is done, THE practice panel SHALL stay up with *Try a breath check* and *Close* until the user picks one.

### Requirement 6: Accessibility
1. EVERY onboarding control SHALL have a text label, a visible focus state and be reachable by keyboard in reading order.
2. Text that changes (diagnosis, step titles) SHALL be in an `aria-live` region.
3. THE walkthrough SHALL work at 375 px width and honour `prefers-reduced-motion`.
4. THE walkthrough SHALL be dismissible with Escape except at the safety acknowledgement step, which needs the explicit button.
5. THE posture gauge SHALL carry its one-word label as text and as its `aria-label` ("Posture: upright"), so the state never depends on colour or the needle angle. (#95)
6. THE last automatic setup card SHALL say once where the rest is: Settings for breaks, sounds and progress, Help for *Learn the cues* and *Not working?*. (#95)

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

### Requirement: Nov 23 live UX audit fixes (#102 to #112, implemented)
1. Camera start errors SHALL name the problem: permission denied (with the lock or camera icon steps), no camera, or camera in use. On a camera problem the model steps SHALL hide and the demo SHALL become the primary button (#102).
2. WHILE Learn the cues runs in the demo, THE demo SHALL show the pose the step teaches; the setup card SHALL wait while the practice panel's closing offer is up (#103).
3. WHILE paused, THE skeleton and gauge SHALL dim, the gauge SHALL read "paused", the badge SHALL count the paused time, and the button's description SHALL say "Resume tracking and sounds" (#104).
4. THE footer SHALL have an Intro link that shows the welcome and safety notice again, before starting too; the full safety notice SHALL be open on the step that asks for the acknowledgement (#106, #108).
5. Save my posture again SHALL show a countdown while it records and say what changed when it is saved (#107).
6. THE break card's button SHALL read "End break"; the card SHALL let the dimmed skeleton show through; right after a break the badge SHALL read "back from break" while tracking settles (#111).
7. THE app and landing titles SHALL both read "BackUp: Posture to Die For" (#112).
