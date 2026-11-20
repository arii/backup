# Legal and privacy checklist (engineering side of issue #51)

**This is not legal advice.** It is an engineering checklist that records what the code and
the site do today, and what still needs a lawyer or is out of scope for now. Take it to a
privacy lawyer before charging money, adding face tracking, or listing a Chrome extension.

Status key: **Done** (in the code or site), **Needs lawyer** (a person must decide or
review), **Future** (a feature that does not exist yet).

## Gap 1: face and biometric rules (BIPA and similar)

| Item | Status | Where |
|---|---|---|
| Opt-in consent with a dated record before shoulder, neck and breathing features. Explains what is measured, tab only, never stored or sent, never used to identify anyone. Features stay off until consent. Withdraw option. | Done | `docs/app/consent.js`, consent dialog and "Shoulder & breathing features" section in `docs/app/index.html`, wiring in `docs/app/app.js` |
| Consent record removed by "Delete my data" | Done | stored in `posture-guard:v1` (`docs/app/privacy.js` `STORE_KEYS`) |
| Public biometric retention and destruction statement | Done | `docs/privacy.html#biometric` |
| Store derived scores only, never landmark arrays or embeddings; no identity matching | Done | Daily totals and counters only; stated in the privacy page |
| Face tension tool: use Face Landmarker blendshapes, not meshes or embeddings | Future | Rule added to `.kiro/specs/wellness-tools/requirements.md` (requirement 1.11) |
| Posture tracking itself reads ear, eye and nose points from the pose model. Decide whether it needs the same opt-in. | Needs lawyer | The consent gate currently covers the shoulder and breathing features only |
| Whether the "capable of identifying" test or Zellmer v. Meta defenses fit this app | Needs lawyer | |

## Gap 2: consumer health data (Washington MHMDA, Nevada, Connecticut)

| Item | Status | Where |
|---|---|---|
| Consumer Health Data Privacy Policy page, linked from the homepage and the app footer | Done | `docs/privacy.html#consumer-health-data`, footers of `docs/index.html` and `docs/app/index.html` |
| Opt-in for breathing and tension features (same consent screen as Gap 1) | Done | `docs/app/consent.js` |
| Red line: no breathing, tension or posture data to a server without redoing this review | Done (rule recorded) | `.kiro/specs/wellness-tools/requirements.md` (requirement 1.10), README, privacy page |
| Whether on-device processing counts as "collecting", and whether the policy text is sufficient | Needs lawyer | |
| FTC Health Breach Notification Rule review before any analytics, accounts or sync | Future | Only relevant once data leaves the device |

## Gap 3: wellness wording and claims

| Item | Status | Where |
|---|---|---|
| Awareness and relaxation wording; no outcome claims ("reduces", "fixes", "prevents", "lowers stress") | Done | Wording pass over `docs/index.html`, `docs/app/index.html`, `README.md`, `docs/app/voice-lines.js`. The only remaining "fix" wording is an instruction to the user ("Please fix your posture"), not a claim. |
| Disclaimer kept in the app, footer, README and privacy page | Done | `docs/app/onboarding.js` `SAFETY_POINTS`, footers |
| Do not publish "silent-test scores improved" without real, honestly collected data | Done (rule) | No such claim is made anywhere |
| Substantiation standard for any future advertising claim | Needs lawyer | FTC Health Products Compliance Guidance |
| Keep the disclaimer in any store listing and on a pricing page | Future | No listing or pricing page exists |

## Gap 4: Chrome extension and payments

| Item | Status |
|---|---|
| Manifest V3: bundle all code, WASM and the model (no remote code). The runtime and model are already self-hosted under `docs/app/vendor/` (issue #45). | Future (extension) |
| Chrome Web Store privacy practices tab and privacy policy URL | Future |
| Camera in an extension: extension page or offscreen document, visible camera indicator and pause | Future |
| Payments through a merchant of record, auto-renewal law compliance, Terms of Service with limitation of liability | Future. Stay with "free + optional sponsor" until there are users. |

## Lower risk items

| Item | Status | Notes |
|---|---|---|
| Screen time is usage data computed locally | Done | Disclosed in the privacy page, kept local |
| EU/UK: self-host the model and runtime so visitor IPs do not go to Google or jsDelivr | Done | `docs/app/vendor/`; e2e asserts no third-party requests |
| Share buttons are plain links, with no third-party widgets or counters | Done | `docs/app/share.js`; e2e asserts no external requests |
| Sponsor prompt is triggered by counts kept only in `localStorage`; stated in the privacy page | Done | `docs/app/sponsor.js` |
| Trademark search for "BackUp" before a store listing or paid launch | Needs lawyer | |
| GDPR review (lawful basis, cookie rules). The site sets no cookies. | Needs lawyer | |

## Before charging money

A short paid review by a privacy lawyer covering BIPA, the consumer health data laws, the FTC
health guidance and auto-renewal laws, plus Terms of Service. Nothing in this checklist
replaces that review.
