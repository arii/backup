# Requirements Document: Safety and Disclaimers

## Introduction
Posture Guard gives posture and movement reminders from a webcam. It is a wellness tool.
This spec defines what the app, the landing page and the docs must say so users are not
misled about what it does, and what to do if something hurts. It also records the
product stance that shapes the wording: there is no strong evidence that holding
"perfect" posture prevents pain (Slater et al. 2019), so the app asks people to relax and
move, not to brace.

**This spec is not legal advice. The owner should have a lawyer review the wording
before the Kiroween submission or any wider launch.** Regulatory points below are
pointers for that review, not conclusions.

Scope markers: **(FEAT-003)** implemented on this branch. **(spec only)** designed, not built.

## Requirements

### Requirement 1: Core statements (FEAT-003)
THE safety notice SHALL say, in plain language:
1. Posture Guard is a wellness tool. It is not medical advice and not a medical device.
   It does not diagnose, treat, cure or prevent any condition.
2. Do not hold a rigid posture. Relax your shoulders and change position often.
3. Stop and see a qualified clinician if you have pain, numbness, tingling or dizziness.
   See a clinician for pain that persists.
4. If you have a spine, nerve, neuromuscular or other medical condition, are pregnant, or
   are recovering from an injury, check with a professional before relying on any
   posture or movement advice.
5. Webcam estimates are approximate. Lighting, camera angle, clothing and body shape
   affect accuracy.
6. The software is provided as-is under the MIT License, without warranty.
7. It is not a substitute for regular movement breaks.

### Requirement 2: Acknowledgement (FEAT-003)
1. WHEN `store.ackVersion` is missing or lower than `ACK_VERSION`, THE App SHALL show the
   safety notice with an "I understand" button before the camera or demo can start.
2. THE acknowledgement SHALL be stored locally as `store.ackVersion` and SHALL NOT be sent anywhere.
3. WHEN the notice text changes materially, THE owner SHALL bump `ACK_VERSION` to re-ask.
4. THE acknowledgement SHALL be a button press, not a pre-ticked box, and SHALL NOT be
   bundled with consent to anything else.

### Requirement 3: Persistent placement (FEAT-003)
THE notice or a link to it SHALL appear in:
1. the browser app footer (`docs/app/index.html`), as a short line with a "Safety notice" link that reopens the full text;
2. the landing page `docs/index.html` near the call to action;
3. one sentence under the "Relax, don't brace" panel;
4. (removed with the Python dashboard in Nov 2026) the dashboard docs page.
THE README and `KIROWEEN.md` SHALL carry the short notice (FEAT-003 docs step).

### Requirement 4: Privacy statement (FEAT-003)
1. THE app SHALL state that video frames and landmarks are processed on the device and
   not uploaded, and that settings and daily totals are stored in the browser (`localStorage`).
2. THE app SHALL state that the model and scripts are self-hosted on the same origin
   (docs/app/vendor/), so only GitHub Pages sees the request.
3. WHEN any future feature sends data off the device (see `progress-review` social
   phase), THE privacy statement SHALL be updated first and consent SHALL be explicit.

### Requirement 5: Accuracy and fairness statement (FEAT-003 for text)
1. THE app SHALL say the measure is relative to the user's own calibration, so "good" means
   close to the user's recorded baseline, not a universal ideal.
2. THE app SHALL say that wheelchair users, standing desks, different body types,
   prostheses and mobility aids can affect detection, and that calibration is the remedy.
3. THE app SHALL NOT display scores as judgements of health or body.

### Requirement 6: Claims discipline (FEAT-003 for rule)
1. NO copy in the app, docs or demo video SHALL claim to prevent, treat or cure back pain,
   neck pain, headaches, eye disease or any condition.
2. COPY MAY say the tool "reminds you", "helps you notice", or "gives you a nudge".
3. TESTIMONIAL or outcome statements SHALL NOT be used unless backed by a study and reviewed.
4. Research citations in `docs/research/` SHALL describe the evidence and its limits, and
   say the app is not clinically validated.

### Requirement 7: Wellness tools (spec only for the tools, rule applies now)
1. EACH wellness tool (`wellness-tools` spec) SHALL carry "stop if it hurts" or equivalent
   in its own copy.
2. THE breath panel SHALL carry the sentence from Requirement 3.3.

### Requirement 8: Regulatory pointers for counsel (spec only)
THE owner SHOULD ask counsel to confirm:
1. That the app stays within the US FDA "general wellness" policy for low-risk products
   (FDA, *General Wellness: Policy for Low Risk Devices*, January 2026) by making no
   disease or condition claims.
2. How EU Medical Device Regulation (MDR) and UK equivalents apply if the app is offered in
   those markets.
3. Data protection duties if any data leaves the device (GDPR, CCPA), and rules for minors.
4. Whether the limitation of liability in the MIT License is sufficient for consumer
   use in the target markets, and whether terms of use are needed.
5. Open source and contributor obligations for the vendored MediaPipe assets (Apache-2.0 LICENSE in docs/app/vendor/).

### Requirement 9: Accessibility of the notice (FEAT-003)
1. THE notice SHALL be readable at 375 px, keyboard operable, and have a visible focus state.
2. THE notice SHALL be plain text, at a reading level suitable for a general audience.
