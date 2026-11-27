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
| Face tension tool: use Face Landmarker blendshapes, not meshes or embeddings | Not built, rule kept | The shipped jaw prompt is time-based and reads no face landmarks (it says a webcam cannot see jaw tension). The blendshape proxy was evaluated and rejected (`docs/research/face-landmarker-evaluation.md`). The rule stays in `.kiro/specs/wellness-tools/requirements.md` (requirement 1.11) for any future face model. |
| Posture tracking itself reads ear, eye and nose points from the pose model. Decide whether it needs the same opt-in. | Decided, lawyer to confirm | Decision: no second consent dialog for basic tracking. Before the first camera start the app shows the on-device statement and the first-visit notice with an "I understand" step (`docs/app/onboarding.js`), then the browser asks for camera permission, which is a separate explicit per-site opt-in. Processing is in the tab only and stores derived totals. The dated consent record covers the extra shoulder and breathing features. A lawyer should confirm this is enough for BIPA-style rules. |
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
| Peer share link for the weekly score: off by default, dated consent dialog that shows the exact record, six fields, no server, nothing sent until the user copies the link; withdrawing consent removes it | Done | `docs/app/consent.js`, `docs/app/share.js`, `docs/privacy.html#share-links`; e2e "share weekly" checks |
| Import JSON reads a local file only, rejects files over 1 MB and any value that is not a finite non-negative number | Done | `parseImport` in `docs/app/progress.js`; e2e "import" checks |
| Sponsor prompt is triggered by counts kept only in `localStorage`; stated in the privacy page | Done | `docs/app/sponsor.js` |
| Trademark search for "BackUp" before a store listing or paid launch | Needs lawyer | Informal findings above |
| GDPR review (lawful basis, cookie rules). The site sets no cookies. | Needs lawyer | |

## Demo media, Remotion and trademark (issue #44)

Not legal advice. Findings from reading public pages on 20 Nov 2026.

| Item | Status | Finding |
|---|---|---|
| Real-person likeness in test and demo footage | Done | The fake camera feed is now a cartoon figure drawn by `scripts/make-fake-camera.mjs`. No photo of a person is used by CI, the demo video workflow or the docs. The earlier sample photo is gone from the repo. The owner's own webcam clip for the final video is still an owner choice (see `LAUNCH.md`). |
| Remotion licence tier | Likely free, owner to confirm | Sources: [License and pricing](https://www.remotion.dev/docs/license/pricing.md), [License FAQ](https://www.remotion.dev/docs/license/faq.md), [Terms](https://www.remotion.dev/docs/terms). The Free License covers "an individual, whether for personal or commercial use" and organizations of up to 3 people, with no feature limits and no need to contact Remotion. This project is one person's open source work, so it appears to qualify. **Unconfirmed:** the current Terms text itself (only the summary pages were read), and whether the owner's employer or any company would count as the user of the software. If a company of 4 or more people ever renders videos with it, a Company License ($25 per seat per month for Creators, or per-render pricing for Automators, per the pricing page) applies. Remotion says to write to them if unsure. |
| Trademark search for "BackUp" | Needs lawyer | Informal web search only. The USPTO trademark search ([tmsearch.uspto.gov](https://tmsearch.uspto.gov/)) loads but is a JavaScript application that cannot be queried from the sandbox, so **no USPTO result was checked**. Search engines returned only unrelated GitHub backup tools for `"BackUp" posture app webcam`, and nothing for the phrase "Posture to Die For". The earlier findings in `LAUNCH.md` (a physical brace named "BackUp Posture Support", several BACKUP marks for data backup software) stand and were not re-verified. |
| Recommendation | | Before a store listing, a custom domain or any payment: (1) the owner runs the USPTO search for BACKUP in classes 9, 10, 42 and 44 and for POSTURE TO DIE FOR, (2) a short clearance opinion from a trademark attorney, (3) always show "BackUp: Posture to Die For" together, and keep the disclaimer. If the opinion is unfavourable, the name is a string in the UI and docs plus the repo URL, so renaming stays cheap (the `posture-guard:v1` storage key stays). |

## Issue #51 status summary

| Area | State |
|---|---|
| Done in code and site | Consent record for shoulder and breathing features, biometric retention statement, Consumer Health Data policy page, wellness wording, disclaimers, self-hosted model and runtime, no data leaves the device (see the tables above). |
| Consent for basic posture tracking | Decided: onboarding notice plus the browser camera prompt, no second dialog. Lawyer to confirm. See Gap 1. Reasoning and sources: [`docs/audit-2026-11.md`](audit-2026-11.md). |
| Owner-only | Privacy lawyer review (BIPA, MHMDA and similar, FTC health guidance, GDPR), trademark clearance. |
| Future | Face tension tool, Chrome extension, paid tier, any server-side data. Each reopens this checklist. |

Tracking issue: [#51](https://github.com/arii/backup/issues/51). Related: [#44](https://github.com/arii/backup/issues/44), [#30](https://github.com/arii/backup/issues/30).

## Before charging money

A short paid review by a privacy lawyer covering BIPA, the consumer health data laws, the FTC
health guidance and auto-renewal laws, plus Terms of Service. Nothing in this checklist
replaces that review.
