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

### Requirement 1: First-run walkthrough
**User Story:** As a first-time visitor, I want a short walkthrough, so I know how to
use the app before the camera turns on.

#### Acceptance Criteria
1. WHEN `store.onboarded` is missing or lower than `ONBOARDING_VERSION`, THE App SHALL show the walkthrough card inside `#start-overlay` before the Start buttons act.
2. THE walkthrough SHALL have three steps: (a) how it works and camera placement, (b) what you will see and hear, (c) the safety notice with an "I understand" button.
3. Step (a) SHALL state: camera at eye level, about an arm's length away, head and shoulders in frame, light in front of you, plain background.
4. Step (b) SHALL describe the posture needle, the "what to fix" box, chime then voice reminders, and that spoken praise is opt-in.
5. Step (b) SHALL state that video and landmarks stay on the device, and that only settings and daily totals are saved in `localStorage` key `posture-guard:v1`.
6. WHEN the user presses "I understand", THE App SHALL write `store.ackVersion = ACK_VERSION` and `store.onboarded = ONBOARDING_VERSION`, save, and reveal `#start-camera` and `#start-demo` as before.
7. THE ids `#start-camera`, `#start-demo`, `#test-start` and `#breath-check` SHALL NOT change.

### Requirement 2: Replay
1. THE App SHALL show a "Help" button in the header that reopens the walkthrough at step (a).
2. Reopening SHALL NOT clear `store.ackVersion` and SHALL NOT interrupt a running session beyond showing the card.

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
1. THE App SHALL offer a "Not working?" panel reachable from the header and from the status line when a fault persists.
2. THE panel SHALL show the current diagnosis, its fixes as a checklist, the existing WebGL help panel, and the existing `#report-bug` link.
3. THE panel text SHALL change in an `aria-live="polite"` region.
4. THE panel SHALL cover: camera permission denied or no camera found, camera used by another app, low light or backlight, too close or too far, no one in view, low frame rate (close other tabs, lower resolution), and WebGL or model load failure.

### Requirement 5: Learn the cues
1. THE App SHALL offer a guided practice mode that steps through: sit tall, push your head forward, tilt your head, raise one shoulder, lean to one side.
2. EACH step SHALL light the matching metric tile when the live metric crosses its threshold, and SHALL advance only on user action ("Next"), never on a timer.
3. WHILE practice mode is active, THE App SHALL play no sounds, speak nothing, and record no stats (same gating as the silent test, `body.testing`).

### Requirement 5a: Live mini view
1. WHILE practice mode is active, THE practice panel SHALL show a compact mirrored posture skeleton and a small needle gauge, fed by the same landmarks and needle value as the main stage and needle panel.
2. WHILE the "Not working?" panel is open and tracking runs, THE panel SHALL show the same mini skeleton and needle.
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

### Requirement 8: Setup coaching beyond the check (spec only)
1. THE App MAY offer a camera preview framing guide (shoulder-width target band) before the session starts.
2. THE App MAY offer a one-minute "calibrate and learn" sequence combining calibration with the cue practice.
3. THE App MAY remember the last working camera device and resolution.

### Requirement 9: Privacy of diagnostics
1. THE SetupCheck SHALL use only reason, state, fps and a boolean. It SHALL NOT store or transmit frames or landmarks.
2. THE bug-report link SHALL stay a user-initiated link with prefilled text and no automatic upload.
