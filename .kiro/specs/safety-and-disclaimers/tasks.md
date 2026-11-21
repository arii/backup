# Implementation Plan: Safety and Disclaimers

Checked items are built.
Unchecked items are **spec only** or owner-only (the reason is on the item).

- [x] 1. Safety text constants in `onboarding.js`
  - `ACK_VERSION`, `SAFETY_SHORT`, `SAFETY_POINTS`. Test asserts key phrases.
  - _Requirements: 1, 2.3_
- [x] 2. First-run acknowledgement in the walkthrough
  - "I understand" writes `store.ackVersion`. Start buttons stay gated until then.
  - _Requirements: 2_
- [x] 3. App footer line and "Safety notice" dialog
  - _Requirements: 3.1_
- [x] 4. Landing page line near the call to action (`docs/index.html`)
  - _Requirements: 3.2_
- [x] 5. Dashboard docs section (removed with the Python app in Nov 2026) and
  one sentence under the "Relax, don't brace" panel
  - _Requirements: 3.3, 3.4, 7.2_
- [x] 6. README and `KIROWEEN.md` short notice, privacy and accuracy lines
  - _Requirements: 3, 4, 5_
- [x] 7. Banned-phrase lint test over user-facing copy
  - `tests/js/safety-copy.test.mjs`: app page, landing page, privacy page, README, `KIROWEEN.md`, voice lines, safety constants and tool lines. A sentence that claims to prevent, treat, cure or diagnose fails unless it negates the claim.
  - _Requirements: 6_
- [x] 8. Docs check that static copies match `SAFETY_POINTS`
  - Same test file: the landing page and README carry the `SAFETY_SHORT` sentences, and the README carries the first five `SAFETY_POINTS` as written.
  - _Requirements: 3_
- [x] 9. Per-tool "stop if it hurts" copy
  - `TOOL_SAFETY` and `toolSafety` in `wellness.js`, shown on the prompt card (`#prompt-safety`) for stretch, move, eye, jaw, breathing and "Breathe with me". The jaw setting and the breath panel carry their own line.
  - _Requirements: 7.1_
- [ ] 10. Counsel review of wording, regulatory framing, privacy policy, minors (owner-only)
  - Owner-only: needs a qualified lawyer, which no code change or agent can supply. Required before the Kiroween submission or any wider launch. Not legal advice here. The wording, the Requirement 8 list and `docs/legal-checklist.md` are what to send.
  - _Requirements: 8_
