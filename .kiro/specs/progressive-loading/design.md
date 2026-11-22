# Design Document: Progressive Loading and Progressive Disclosure

## Principles
1. Camera on a user gesture only; model download starts at the same gesture, in parallel.
2. The user always sees something that is true: the live video, then a plain status card.
3. Reveal what is useful when it becomes useful; never remove what was shown.
4. Every optional step can be skipped, and "Skip all" leaves the app on its defaults.
5. No build step, no new dependency, no new network origin.

## Modules
- `docs/app/reveal.js` (new): pure `RevealStages`, no DOM, injected `now`. Tested in
  `tests/js/reveal.test.mjs`. Same style as `onboarding.js` and `prompts.js`.
- `docs/app/loading.js` (extend): `LoadSteps` gains an overall percentage, per-step
  explanation text, an elapsed counter for warm-up and a compact mode. `downloadAll`,
  `mb` and `nextPaint` are unchanged. Extra export `startPreload()` (see below).
- `docs/app/app.js`: parallel start in the `#start-camera` handler; calls
  `reveal.update(...)` once per scored frame; applies stage to panels; setup sequence by
  extending `FIRST_RUN`; breath intro through `prompts`.
- `docs/app/prompts.js`: one new id `breath_intro` (type `breath`) with a one-time quiet
  exemption; later `stretch` and `water` ids (type `break`).
- `docs/app/onboarding.js`: add `SETUP_STEPS`, `nextSetupStep(store)`, `skipAll(store)`
  as pure helpers (version constants stay).
- `docs/app/index.html`: wrap panels in `data-stage="N"` containers (ids unchanged),
  `<noscript>`, compact status card, "Show all settings" and "Set up" buttons.
- `docs/index.html`: intent prefetch script (optional, Requirement 8.2).
- `docs/privacy.html`, `docs/index.html` privacy line: wording from Requirement 9.

## Timeline: before and after
Today (fast link, measured): click, 0.3 s video decoded but covered, 0 to 3.8 s dark card,
3.8 s overlay gone, 4.5 s first scored frame, 5.2 s settled, then every panel at once.

Target:
```
page load      stage 0: stage + promise + Start buttons (+ walkthrough on first run)
click          getUserMedia() ──────────────┐                (in parallel)
               downloadAll(model, wasm) ────┤
~0.3 s         video frames playing  ──> show mirrored video, card shrinks to a strip
               download done ──> step "Start the model" (elapsed counter)
               warm-up (blocks main thread, one paint first)
first frame    stage 1: "This session", badge, fps
10 s settled   stage 2: needle, what to fix, tiles, setup step 1 (framing)
2 min          stage 3: reminders & sounds, calibration
5 min          stage 4: breaks, wellness menu, relax, test
next session   stage 5: progress, offline, share, sponsor
```
The 10 s settle comes from the existing "settling in" badge logic (`app.js` around line
1500): it ends when the state leaves NO_PERSON with a scored frame. `RevealStages` adds a
10 s hold on top, so a flicker does not reveal early.

## Parallel start
Current handler order (`app.js` `#start-camera` click): `step("camera")`, `await
getUserMedia`, `await video.play()`, `step("download")`, `loadModel` (which imports the
bundle, resolves the fileset, `downloadAll`), `warmUp`, `finish()`, `begin()`.

New order:
```js
const modelP = canvas ? loadModel(canvas, progress, onDownloaded) : loadMoveNet(progress);
modelP.catch(() => {});                       // handled below; avoids unhandledrejection
const stream = await getUserMedia(...);       // permission prompt runs while bytes flow
video.srcObject = stream; await video.play();
showLivePreview();                            // card becomes a strip
poseLandmarker = await modelP;                // may already be done
await warmUp(...);
```
Rules:
- `loadModel` must not touch `video`. It already only takes `canvas`.
- If getUserMedia rejects, `modelP` keeps running and its result is cached in module
  scope (`preloaded`), so a retry (permission fixed in browser settings) skips the
  download. If the page is left, the fetch is dropped by the browser.
- If MediaPipe fails after the download, the existing MoveNet fallback still runs.
- Step states: the list shows "Allow the camera" and "Download the pose model" both
  active at once. `LoadSteps.step(id)` today marks the previous step done; add
  `LoadSteps.start(id)` and `LoadSteps.done(id)` so two steps can be active.
- `warmUp` still needs `video.readyState >= 2`, so it waits on both.

Overall percentage: `0.05 camera + 0.80 download + 0.15 warm-up`, using the byte
progress for the download share. Pure function `overallPercent(steps)` exported from
`loading.js` and unit-tested. Camera counts as done when frames play.

## Live preview and the compact card
- `#start-overlay` today is `position:absolute; inset:0; background: rgba(...,.92)`.
  New class `.overlay-msg.compact`: `inset: auto 0 0 0`, solid background `var(--panel)`
  (contrast), the intro, tagline, onboarding and WebGL help hidden, only `#load-steps`,
  `#load-bar`, `#load-hint` visible, max height 40 % of the stage. At 320 px the card
  sits below the video (stage becomes a column) so the face is never covered.
- Video is already mirrored in CSS for the live view? Verify while building; if not,
  mirror the preview with `transform: scaleX(-1)` only on the video element.
- `video` is shown by setting a class on `.stage`, no inline display toggling.
- `begin()` removes the card as now. `stopCamera()` restores the full overlay.
- The canvas `#overlay` (skeleton) stays clear until tracking, so the user does not see
  a skeleton before the model exists.

## Status card text (one line each, plain)
| Step | Label | Why |
|---|---|---|
| Camera | Allow the camera | "Your browser asks first. The video stays on this computer." |
| Download | Download the pose model | "A 15 MB file from this site, one time. It runs in this tab." |
| Start | Start the model on your computer | "Getting ready for your graphics chip. The page may pause for a few seconds." |

The existing slow hints stay. A failure keeps the list and adds **Try again** (re-runs the
handler, reusing `preloaded`) and **Try the demo**.

Announcements: `#load-steps` is `aria-live="polite"` today and gets mutated on every
progress tick (`.load-detail`). Change: the live region holds only the step label; the
detail text moves to `aria-hidden` plus the `progressbar` value. Throttle `progress()` to
250 ms.

Warm-up timer: `warmUp` calls `await nextPaint()` and then blocks in `detectForVideo`.
Start a `setInterval` for the elapsed counter before `nextPaint`; the counter freezes
while the thread is blocked, which is acceptable, and the card text says so. Moving
MediaPipe to a Worker is out of scope (the bundle uses the main thread canvas; see
Out of scope).

## Reveal stages (`reveal.js`)
```js
export const STAGES = Object.freeze({
  idle: 0, tracking: 1, settled: 2, configured: 3, comfortable: 4, returning: 5,
});
export const REVEAL = Object.freeze({ settle_s: 10, config_s: 120, comfortable_s: 300 });
export class RevealStages {
  constructor({ returning = false, revealAll = false, cfg = REVEAL } = {})
  /** frame: { scored: bool, state: "good"|"slouch"|..., paused, silentTest, practice }
   *  now: seconds (scaled by clockScale like pclock). Returns { stage, changed }. */
  update(frame, now)
  forceAll()        // "Show all settings"
}
```
Rules (properties, tested):
- R1 monotonic: `stage` never decreases within an instance.
- R2 no advance while `paused`, `silentTest` or `practice`; time does not accumulate then.
- R3 settle: needs `settle_s` consecutive seconds of scored frames in state good or slouch.
  A gap longer than 3 s of unscored frames resets the hold (not the stage).
- R4 `returning` jumps to stage 4 when settled. `revealAll` or `forceAll()` returns 5.
- R5 `clockScale`: the app passes the scaled clock, same as `pclock`.

Mapping stage to DOM (`data-stage` on the panel wrappers in `docs/app/index.html`):
| Stage | Panels shown |
|---|---|
| 0 | stage, Start buttons, walkthrough, Help, "Not working?" (collapsed) |
| 1 | + "This session" |
| 2 | + posture needle (with tiles), setup step 1 |
| 3 | + "Reminders & sounds" (collapsed `<details>`), "Calibrate to your desk" |
| 4 | + "Relax, don't brace", "Breaks & prompts", wellness menu, "Learn the cues", "Test me" |
| 5 | + "Your progress", "Offline mode", Share, Sponsor |
Collapsed `<details>` also helps the checkbox count: each reminders group is inside a
`<details>` closed by default, so even at stage 4 the visible checkboxes stay low until
the user opens a group. Target is in Requirement 4.9.

Show-all control: `<button id="reveal-all" class="link">Show all settings</button>` in the
header row; text toggles to "Simplify the page". `store.revealAll` is persisted. Hidden
panels use `hidden` so they leave the tab order. `renderPromptSettings()` and the other
renderers write to hidden elements without effect, so no code change there.

Announcement: `#reveal-note` (`role="status"`, visually quiet, 6 s) shows "Added: reminders
and sounds" at each stage change.

## Setup sequence (progressive configuration, "skip all")
Reuse `FIRST_RUN` (`app.js` `firstRun`, `#first-run`, `store.firstRunDone`). Today it is shown
at the first Start with steps framing, calibrate and sounds. Changes:
1. Delay it until stage 2 (settled), so it is not on top of a loading page.
2. Add steps after calibrate: `style` (mode radio and "say what to fix"), `voice`
   (sound pack, voice picker), `breaks` (eye, move, stretch, water toggles; defaults
   pre-selected), `shoulders` (explains the shoulder and breathing features and starts the
   consent dialog on "Turn on", otherwise skip).
3. Every card: **Back**, **Next**, **Skip this step**, and a footer button **Skip all, use
   defaults**. The current "Skip intro" button becomes "Skip all".
4. State in `store.setup = { step, skipped: [], done: [] }`; `store.firstRunDone` stays for
   back-compat and is set when the sequence ends or Skip all is pressed. `store.setupDone`
   marks completion. "Set up" in the header reopens the first skipped step.
5. Pure helpers in `onboarding.js`: `SETUP_STEPS` (keys and the reveal stage that unlocks
   them), `nextSetupStep(store, stage)`, `skipStep(store, key)`, `skipAll(store)`.
   `skipAll` sets `setupDone`, never writes consent, never flips an off-by-default
   setting on.
6. Each step reuses the existing control inside the settings panels by moving the live
   controls into the card (re-parenting a node keeps its id and handlers) or by calling the
   same `settings.js` setters. Prefer calling setters, so there is one write path.

Setup waits while a posture reminder, pause, test or practice is active (it checks the
same flags as `prompts.poll`).

## Auto breath check: reconciling consent, scheduler and the 20 min loop
Today: `relaxStep()` shows nothing without consent (`"off until you opt in"`). The auto
check enqueues `breath` after `AUTO_BREATH_S` of good posture, only if consent and
`relaxReminders`. The scheduler blocks all non-posture prompts for 300 s.

New:
```
stage >= 2 AND good for 60 s AND no setup card AND !store.breathIntroShown
   ──> prompts.enqueue("breath_intro")
          scheduler: ignores first_quiet_s for this id, once. global_gap_s still applies after.
   card: "Want to try a 30 second breath check? It looks at your shoulders." [Try it] [Not now]
     consent? yes ──> start check, goodSinceBreath = 0, store.breathIntroShown = true
     consent? no  ──> Try it opens requireConsent(startBreathCheck)
                      cancel or Not now ──> snooze 10 min, breath features stay off,
                                           breathIntroShown stays false until offered 3 times
```
- Never starts without consent. The consent text (`CONSENT_POINTS`) is unchanged, so
  `CONSENT_VERSION` stays 1. The intro card adds only a short pointer to it.
- After the intro check, the existing 20 min loop is unchanged.
- `lowAccuracy` (MoveNet) suppresses the intro, because `neckRatio` is not reliable there.
- `prompts.js` change: `PROMPT_DEFS.breath_intro = { type: "breath", cooldown_s: 600 }`
  and in `poll`, a flag `intro: true` bypasses the quiet-start check once. Tests extend
  `tests/js/prompts.test.mjs`: bypass applies once, global gap applies afterwards,
  posture reminder still wins, pause and silent test block it, disabled when dismissed.
- Open question: if the user prefers no exemption, drop the bypass and let the intro wait
  300 s; nothing else changes.

## Wellness menu and water (built, `docs/app/wellness.js`)
One "Take a break" card at stage 4 with six entries (Stretch, Breathe with me, Breath
check, Look away, Stand and move, Drink water). It reuses `breaks.js` (eye, move),
`breathing.js` ("Breathe with me"), `relax.js` (breath check). New content:
- `stretch`: three timed micro-stretches (neck side, shoulder roll, chest opener), text and
  a small CSS or SVG outline, no pose-based form scoring (`wellness-tools` Requirement 5.4).
- `water`: timer prompt plus "I drank" counter. No camera inference; the reason is in
  Requirement 7.4. A future camera version (hand near mouth for 1 s) needs a consent
  version bump and a false-positive study; not planned here.
Both register as scheduler ids so they share quiet start, gap, snooze and "don't show".
Demos play inside the prompt card (`#prompt-card`), so no new overlay.

## Preload and prefetch options
| Option | Effect | Privacy and wording | Recommendation |
|---|---|---|---|
| A. Parallel on click | Saves the camera prompt time from the critical path | None | Do it |
| B. Prefetch on intent (hover, focus, pointerdown on the landing page link) | Model may be cached before the app opens | One sentence on browser HTTP cache | Do it, skip on Save-Data and 2g |
| C. Prefetch on landing idle for everyone | Best first start, but 15 MB to every visitor, including people who only read the page | Privacy page and landing line must change; mobile data cost | Do not, unless the user asks |
| D. Camera on load | Video instantly | Contradicts "camera starts when you choose" | Do not |
| E. Service worker precache by default | Offline | Contradicts opt-in offline | Do not |

For B, size is known from `precache.json` (model plus WASM, about 15 MB of the 32 MB
total). Implementation: a 15-line inline-free script file `docs/prefetch.js` loaded from
`docs/index.html` (CSP-safe, `script-src 'self'`), which on intent adds
`<link rel="prefetch" href="app/vendor/pose_landmarker_lite.task">` and the WASM files. Hash
or version query strings must match the ones `loadModel` fetches, or the prefetch is
wasted: `loadModel` uses plain `fetch(url)` with no query, so use the same URL. Add an e2e
check that exactly one request per file is made after landing then app (HTTP cache hit).

## Test and capture changes
- `tests/js/loading.test.mjs`: add `overallPercent`, two active steps, throttled progress.
- `tests/js/reveal.test.mjs` (new): R1 to R5.
- `tests/js/prompts.test.mjs`: `breath_intro` cases above.
- `tests/js/onboarding.test.mjs`: `nextSetupStep`, `skipStep`, `skipAll` never grants consent.
- `tests/e2e/live-site.mjs`: existing scenarios seed `onboarded`, `ackVersion`,
  `firstRunDone` (line 98 to 105) and click `#start-demo` or `#start-camera`. They also
  open `#setup-panel summary` (lines 599, 648) and read settings controls directly. These
  need: seed `setupDone: true` and `revealAll: true` in the init script so every panel
  exists, `await` the compact card state where the test waits for the overlay, and new
  scenarios: video visible within 1.5 s with the model route held; stage 0 shows at most
  2 checkboxes; stage 2 reveal after settle (use `?clockScale=600` in demo); "Skip all"
  leaves defaults and no consent; breath intro asks for consent and declining stores
  nothing; 320 px has no horizontal scroll at each stage.
- `video/scripts/capture.mjs`: seeds `onboarded` and `firstRunDone` (line 41 to 43) and
  clicks `#start-demo` (line 72) and `#start-camera` (line 108). Add `revealAll` and
  `setupDone` to the seed so screenshots show the full dashboard as before, and wait for
  the compact card to go.
- Anything that waits for `#start-overlay` to be `display:none` stays valid because
  `begin()` still removes it.
- After any `docs/app/` change: `node scripts/gen-precache.mjs`; CI checks it with
  `--check`.

## Correctness properties
- **P1** Reveal stage never decreases within a session (R1).
- **P2** Skip all grants no consent and enables nothing that is off by default.
- **P3** The breath check never starts without `hasConsent(store)`.
- **P4** `getUserMedia` is never called without a click on `#start-camera`.
- **P5** No request leaves the site origin (existing e2e check 5 still passes).
- **P6** All pre-existing element ids exist in the DOM at every stage.
- **P7** The live-region text changes at most once per step, not per progress tick.

## Risks
- Hidden panels may break code that measures layout (mini-views draw only when visible;
  they already check visibility). Test practice and "Not working?" at stage 0 and 2.
- A user who wants a setting right now may not find it. Mitigation: "Show all settings"
  is always in the header, Help links to it.
- Parallel start raises peak memory slightly (buffers held while the permission prompt is
  open). The two buffers are about 15 MB; acceptable.
- Headless numbers use software WebGL; real GPU warm-up differs. Re-measure on a laptop
  GPU before tuning `REVEAL` constants.

## Out of scope
Moving inference into a Web Worker, shrinking the model, camera auto-request, analytics,
face or gesture-based water detection, any server component.
