# Design Document: Safety and Disclaimers

**Not legal advice.** The owner should have a lawyer review this wording before the
Kiroween submission or any wider launch.

## Single source of truth
`docs/app/onboarding.js` exports the text and the version:
```js
export const ACK_VERSION = 1;
export const SAFETY_SHORT = "...";   // one sentence, footer and landing page
export const SAFETY_POINTS = [...];  // array of strings, the full notice
```
The app renders `SAFETY_POINTS` in the walkthrough and in the "Safety notice" dialog.
Static pages (`docs/index.html`, `docs.html`, README) cannot import it, so they carry
copies. A unit test (`tests/js/onboarding.test.mjs`) asserts that the key phrases from
Requirement 1 appear in `SAFETY_POINTS`, and a docs check (task 6) compares the static
copies to it.

## Wording (draft for counsel)
Short (footer, landing page):
> BackUp is a wellness tool, not medical advice or a medical device. Do not hold a
> rigid posture. Stop and see a clinician if you have pain, numbness or dizziness.

Full notice (`SAFETY_POINTS`):
1. BackUp is a wellness tool. It is not medical advice and not a medical device,
   and it does not diagnose, treat or prevent any condition.
2. Do not hold a rigid posture. Relax your shoulders and change position often. Reminders
   are not a substitute for regular movement breaks.
3. Stop and see a qualified clinician if you feel pain, numbness, tingling or dizziness,
   or if pain persists.
4. If you have a spine, nerve, neuromuscular or other medical condition, are pregnant, or
   are recovering from an injury, check with a professional first.
5. Webcam estimates are approximate. Lighting, camera angle, clothing and body shape
   change the result. "Good" means close to your own calibrated baseline.
6. Your video and body landmarks are processed in your browser and are not uploaded.
   Settings and daily totals are stored in this browser. The pose model and scripts are
   served from this site.
7. The software is provided as-is, without warranty, under the MIT License.

Panel line under "Relax, don't brace":
> This is a gentle check, not a medical test. Stop if anything hurts.

## Placement map
| Surface | Content | Mechanism |
|---|---|---|
| First-run walkthrough, step 3 | Full notice + "I understand" | `ACK_VERSION`, `store.ackVersion` |
| App footer | Short + "Safety notice" link | Reopens the full notice dialog |
| `docs/index.html` | Short, near the call to action | Static copy |
| README, `KIROWEEN.md` | Short + link to this spec | Static copy |
| Relax panel | One sentence | Static in `index.html` |
| Each wellness tool | "Stop if it hurts" | Per-tool copy |

## Acknowledgement flow
```
load -> shouldShowOnboarding(store)? -> show walkthrough (step 3 = notice)
         "I understand" -> store.ackVersion = ACK_VERSION; save(); show Start buttons
         ackVersion < ACK_VERSION later -> re-show only the notice step
```
No acknowledgement is required to read the landing page or docs. Without
acknowledgement the Start buttons do not start the camera or demo.

## Posture stance (why the wording says "relax")
Slater et al. (2019) argue that evidence for "incorrect posture causes spinal pain" is
weak. The app therefore (a) calibrates to each user, (b) watches for bracing and shoulder
rise (`relax.js`), (c) avoids rewarding stillness, and (d) never presents a score as a
health measure. See `docs/research/feedback-and-habit-formation.md`.

## Correctness properties
- **P1 gate**: with `ackVersion < ACK_VERSION`, `#start-camera` and `#start-demo` do not
  start tracking. (e2e fresh-context check.)
- **P2 versioning**: bumping `ACK_VERSION` makes `shouldShowOnboarding` true for every
  existing store.
- **P3 no network**: acknowledging performs no request.
- **P4 consistency**: the static copies contain the same key phrases as `SAFETY_POINTS`.
- **P5 no claims**: a lint test over `docs/app/index.html`, `docs/index.html` and README
  fails on banned phrases (for example "cure", "treat", "prevent back pain", "clinically proven").

## Out of scope
Terms of service, privacy policy documents, age gating, region-specific legal text.
These need counsel and are listed in Requirement 8.
