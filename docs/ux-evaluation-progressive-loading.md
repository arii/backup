# UX evaluation: progressive loading

Evaluation of the first-run experience after the progressive-loading work
(`.kiro/specs/progressive-loading`). The "hostile critic" and "impeccable" audit skills were not
available, so the same two passes were done by hand: a sceptical first-time visitor walk-through,
then a polish pass.

## Method

A scratch Playwright script (not committed) walked the local build in headless Chromium with a fake
camera (`--use-file-for-fake-video-capture`), software WebGL (SwiftShader), and a fresh profile.
Screenshots were taken at landing, start screen, onboarding, 1 s, 3 s and 6 s after Start, after
"Show all settings" and after "Set up", and were viewed one by one. Console `error` and `warning`
messages and page errors were collected in every scenario. Load numbers come from
`tests/e2e/measure-load.mjs`, the full flow from `tests/e2e/live-site.mjs` (208 PASS, 0 FAIL).

Scenarios, each at 1280x800 and 320x640 unless noted:

1. Landing page, then the app.
2. Fake camera.
3. Demo mode (`#start-demo`).
4. WebGL disabled.
5. Network held to about 1.5 Mbit/s (CDP `Network.emulateNetworkConditions`), 1280x800.
6. Camera denied (`getUserMedia` rejects with `NotAllowedError`).
7. `prefers-reduced-motion: reduce`.

## Critic findings

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | High | Denied camera at 320 px: the page stayed scrolled to the bottom of the stage, so the Try again and Try the demo buttons and the explanation were above the viewport. The explanation sat below the step list, far from the buttons. | Fixed. `showError` (`docs/app/app.js`) scrolls the overlay to its top and brings it into view. The error paragraph now sits above the step list in `docs/app/index.html`. Re-checked in a screenshot. |
| 2 | Medium | Loading step descriptions overflowed the card by 24 px at 320 px ("this computer" was cut off). | Fixed. `.load-why` uses `flex: 0 0 calc(100% - 24px)`. |
| 3 | Low | After a failure the third step ("Start the model") still shows an empty circle and "Getting ready for your graphics chip". It reads as pending. | Not fixed. The list shows where the sequence stopped and the buttons say what to do next. Changing it would mean a new "skipped" state for little gain. |
| 4 | Low | First Tab press on a fresh load goes through the header (Help, Show all settings, links) before it reaches the onboarding Next button. | Not fixed. The header is first in the DOM and reading order. Moving focus automatically would surprise screen reader users. Recorded as a limitation. |
| 5 | Low | The score bar label "Good posture held... next 'looking good' in 8.8 s" is drawn across the fill edge. | Not fixed, out of scope (existing UI, not part of progressive loading). |
| 6 | Info | In the headless font the heart in "Sponsor" renders as an underscore. | Not an app bug: the headless Chromium here has no glyph for it. |
| 7 | Info | "Tracking is running slowly" shows on software WebGL at 4 fps. | Correct behaviour for SwiftShader, not seen on real hardware. |

Checked and fine: the landing page makes no overstated promise (it says what runs locally and
that WebGL is needed for best accuracy); the staged reveal note and "Show all settings" appear in
the right order; "Skip all, use defaults" is reachable on the first setup card; the Take a break
menu says plainly that stretch, move and water are not analysed by the camera and never touch
the score; the compact loading strip leaves the live video fully visible at both sizes; demo mode
needs no camera and no model download; no horizontal scroll at 320 px in any scenario.

## Polish findings

| Check | Result |
|---|---|
| Copy and tone | Consistent plain sentences in the wellness menu, setup cards, reveal note and privacy text. No em dashes in the new strings. The existing page titles keep their em dash and were left alone. |
| Alignment and spacing | Header wraps cleanly at 320 px. Step list fixed (finding 2). |
| Focus order | Header, then start card, then footer. Visible focus ring on all controls (`#9ec5ff` outline). See finding 4. |
| Reduced motion | The `prefers-reduced-motion` block removes transitions and animations. A page animation check showed 0 running animations with the preference set. |
| Contrast (WCAG AA 4.5:1, computed from the CSS colours) | muted text on page 5.92, on panel 5.27; error red on panel 5.28; green on panel 7.09; amber on page 10.07. All pass. |
| Console | No `error` messages and no page errors in any scenario. The only warnings are Chromium GL driver notes from SwiftShader. |
| Dead code | `npm run check` (Biome, fallow, node tests, gen-precache check) passes. |
| Precache | `docs/app` changes are covered by `scripts/gen-precache.mjs` (regenerated). This file lives in `docs/` outside `docs/app`, so it is served by GitHub Pages but not precached. |

## Before and after

Times from the click on Start with webcam. "Before" is the FEAT-001 baseline.

| Measure | Before | After |
|---|---|---|
| Video visible, 1280x800 | 3.8 s | 0.27 s |
| Video visible, 320x640 | 3.3 s | 0.25 s |
| Video visible, 1.5 Mbit/s | 86.5 s | 0.17 s |
| First scored frame, 1280x800 | 4.5 s | 5.0 s (within run-to-run noise) |
| First scored frame, 1.5 Mbit/s | not recorded | 86.5 s (the 15 MB model download is the floor) |
| Landing: checkboxes and radios | 10 | 0 |
| Landing: words / controls | about 840 / 48 | 38 / 4 (landing page itself: about 1020 to 96 words) |
| Stage 2: words below the stage | about 820 | 76 |
| Controls, visible (1280x800): landing / start ready / settled / stage 2 | not recorded | 15 / 16 / 15 / 20 |
| Checkboxes and radios at every stage | 10 | 0 |
| Denied camera | explanation and buttons could be off screen at 320 px | buttons and explanation in view, step list shows "Allow the camera" failed |

## Limitations

- Headless Chromium on SwiftShader: absolute times are relative. Real GPUs score the first frame sooner.
- No screen reader or real-device run. Focus order and labels were checked by Tab key sequence and DOM reading only.
- The denied-camera case was simulated by rejecting `getUserMedia`. Browsers that show a permission prompt and wait (rather than reject) were not tested.
- The first scored frame is bound by the model download on slow networks. Progressive loading shows the video and progress during the wait but cannot shorten it.
