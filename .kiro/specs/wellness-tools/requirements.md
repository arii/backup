# Requirements Document: Wellness Tools

## Introduction
Posture is one input to comfort at a desk. This spec covers optional extras that sit
beside posture tracking: breathing, face and jaw tension prompts, neck and shoulder
micro-stretches, eye breaks, and movement breaks. Every tool is a **wellness prompt**,
not a medical measurement or treatment. Safety wording lives in
`.kiro/specs/safety-and-disclaimers/`. Evidence: `docs/research/feedback-and-habit-formation.md`.

Scope markers: **(shipped)** already in the app via PR #37 (`docs/app/relax.js`).
**(spec only)** designed and not built. No wellness tool is built in FEAT-003.

Ground truth about the sensor:
- MediaPipe Pose has 33 landmarks. The only face points are nose, eyes, ears and two
  mouth corners (`mouth_left`, `mouth_right`). There is **no jaw or tongue landmark**.
  Source: MediaPipe Pose Landmarker guide.
- MediaPipe Face Landmarker outputs face landmarks and blendshape scores
  (`outputFaceBlendshapes: true`). It is a separate model and task. Source: MediaPipe
  Face Landmarker guide.
- A 2D webcam cannot see clenching, tongue position, or muscle tension. Blendshapes
  describe visible face shape only.

## Requirements

### Requirement 1: Common rules for every tool (spec only unless noted)
1. EVERY tool SHALL be opt-in and off by default, with its own toggle in settings.
2. NO tool SHALL make a medical claim, give a diagnosis, or promise relief. Copy uses
   verbs like "try", "notice", "if it feels comfortable".
3. EVERY tool SHALL stop and say so if the user reports discomfort ("Skip", "Stop for today").
4. THE App SHALL apply a global prompt budget across posture reminders and all tools:
   at most `WELLNESS.max_prompts_per_hour` (default 6) non-posture prompts per hour, and
   no two prompts within `WELLNESS.min_gap_s` (default 120) of each other.
5. NO tool SHALL prompt during pause, the silent retention test, or "Learn the cues" practice.
6. NO frame, landmark, blendshape score or tool event SHALL leave the device. Counters
   stored locally MAY be added to `store.days` (aggregates only).
7. EVERY tool SHALL respect the Coaching level (Light uses chime instead of voice and no timed praise for tools as well).
8. NO new spoken text SHALL be added without a rendered voice clip (see
   `scripts/render-voice.mjs`). Until clips exist, tools use on-screen text and the chime only.
9. EVERY tool SHALL be keyboard accessible, labelled, and use `aria-live` for text changes.

### Requirement 2: Breath check (shipped)
1. THE App SHALL offer a breath check (`#breath-check`): breathe in, breathe out, then a
   verdict on whether the shoulders rose on the inhale, using `BreathCheck` in `relax.js`.
2. THE App SHALL run the bracing monitor (`BracingMonitor`) that flags shoulders creeping
   up while posture reads good.
3. These SHALL keep their current behaviour and ids.

### Requirement 3: Guided slow-breathing exercise (spec only)
1. THE App SHALL offer an optional paced breathing exercise of 1, 2 or 5 minutes.
2. THE visual SHALL be a circle that grows for the inhale and shrinks for the exhale at a
   user-chosen pace (default 5 s in, 6 s out, within a 3 to 8 s range).
3. THE exercise SHALL pause tracking reminders and SHALL NOT record stats while running.
4. THE exercise SHALL work with `prefers-reduced-motion` by replacing the animation with a
   text countdown.
5. THE App SHALL NOT claim physiological effects. Copy: "A slow breathing break."

### Requirement 4: Face and jaw tension prompt (spec only)
**User Story:** As a user who clenches my jaw while concentrating, I want an occasional
reminder to relax my face.

#### Acceptance Criteria
1. THE feature SHALL be a gentle **prompt**, not a measurement. Text: "Check your face:
   unclench your jaw and let your tongue rest on the floor of your mouth." No score or
   percentage SHALL be shown.
2. THE feature MAY use the Face Landmarker blendshapes as a coarse proxy only:
   `jawOpen` (low and flat suggests closed jaw), `mouthPressLeft` and `mouthPressRight`,
   `browDownLeft` and `browDownRight`, `eyeSquintLeft` and `eyeSquintRight`.
3. THE trigger SHALL be time-based by default (every 30 to 45 minutes). The blendshape
   proxy MAY shift the timing earlier, but SHALL NOT be the only trigger, because a
   clenched jaw with relaxed lips looks the same as a relaxed jaw.
4. THE feature SHALL state its limit in settings: "A webcam cannot see jaw tension. This
   is a reminder, not a reading."
5. THE Face Landmarker model SHALL be downloaded only after the user enables this tool,
   with a visible size and "uses more CPU" note, and SHALL be self-hosted under
   docs/app/vendor/ like the pose model. No new origin SHALL be added without updating the
   privacy statement.
6. THE feature SHALL run the face model at a reduced rate (for example 2 fps) and only
   when the tool is on, to bound CPU cost.
7. THE feature SHALL degrade to the time-based prompt if the model fails to load.

### Requirement 5: Neck and shoulder micro-stretch prompts (spec only)
1. THE App SHALL offer optional prompts such as "Gently turn your head to look over each
   shoulder", "Roll your shoulders back and down", "Look left and right".
2. EACH prompt SHALL be short, shown on screen with a small illustration or text, and
   include "stop if it hurts".
3. THE prompts SHALL be on a rotating list to avoid habituation and SHALL fall within the
   global prompt budget.
4. THE App SHALL NOT use pose angles to coach stretch depth or form.

### Requirement 6: 20-20-20 eye breaks and blink reminder (spec only)
1. THE App SHALL offer an optional eye-break reminder every 20 minutes of tracked time:
   "Look at something about 20 feet (6 m) away for 20 seconds."
2. THE reminder SHALL include a 20 second on-screen countdown the user can dismiss.
3. THE blink reminder MAY use the Face Landmarker `eyeBlinkLeft` and `eyeBlinkRight`
   blendshapes to estimate blink rate over a 1 minute window and show a prompt
   ("Blink slowly a few times") if the rate is very low. It SHALL show no rate.
4. THE blink feature SHALL share the Face Landmarker session with Requirement 4 and SHALL
   NOT run unless one of them is enabled.
5. Copy SHALL NOT say the tool prevents or treats eye disease or strain. It MAY say "many
   people find short screen breaks comfortable".

### Requirement 7: Stand and move microbreak timer (spec only)
1. THE App SHALL offer an optional timer that prompts a short movement break after a
   user-set interval of continuous tracked sitting (default 45 minutes, range 20 to 90).
2. THE prompt SHALL suggest standing, walking, or changing position for 1 to 5 minutes.
3. WHEN the user leaves the frame for at least 30 seconds after a prompt, THE App SHALL
   count a break and reset the timer, and SHALL NOT penalise the absence.
4. THE App SHALL count breaks taken per day locally (`day.breaks`) for the progress review.

### Requirement 8: Wheelchair, standing and varied setups (spec only)
1. THE tools SHALL offer wording that does not assume sitting or standing ("change position").
2. THE movement prompt SHALL be skippable and SHALL NOT reduce any score if skipped.
