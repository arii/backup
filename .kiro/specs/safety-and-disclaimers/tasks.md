# Implementation Plan: Safety and Disclaimers

Checked items are built.
Unchecked items are **spec only**.

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
- [ ] 7. Banned-phrase lint test over user-facing copy (spec only)
  - _Requirements: 6_
- [ ] 8. Docs check that static copies match `SAFETY_POINTS` (spec only)
  - _Requirements: 3_
- [ ] 9. Per-tool "stop if it hurts" copy when wellness tools ship (spec only)
  - _Requirements: 7.1_
- [ ] 10. Counsel review of wording, regulatory framing, privacy policy, minors (spec only)
  - Required before the Kiroween submission or any wider launch. Not legal advice here.
  - _Requirements: 8_
