# BackUp — Posture to Die For: launch kit

**Name:** BackUp. **Tagline:** Posture to Die For.
List it everywhere as **BackUp — Posture to Die For**, so both keywords are indexed together.

## Name check (20 Nov 2026, web search only, not legal clearance)

| Name | Finding | Risk |
|---|---|---|
| Posture Guard (old name) | A **Chrome Web Store extension called "Posture Guard"** that watches posture through the webcam, plus postureguardapp.com, a Google Play app, and several GitHub repos | **High**: same product, same store. Renaming was right |
| BackUp | "**BackUp Posture Support**" (Healthy Lab Co), a physical lower-back brace sold online. Also an old student project, "BackUp", a posture-correction device. USPTO has several BACKUP marks for data-backup software (class 9) | **Medium**: a brace isn't a webcam app, but both are posture products. "BackUp" alone gets lost among cloud-backup results |
| Posture to Die For | No product or app found under this phrase | Low |

Before buying a domain, listing in a store, or charging money:
- run a USPTO search for **BACKUP** in classes 9, 10, 42 and 44, and for **POSTURE TO DIE FOR**;
- get a short clearance opinion (see #44 and #51).

Always pair the name with the tagline, because the pairing is what tells BackUp apart from the brace.

## Domains and handles to check

The sandbox couldn't reach WHOIS or RDAP, so **availability isn't verified**. Check these at a registrar:

- Domains, in order of preference:
  - `sitbackup.app`
  - `getbackup.app` (the GitHub user `getbackup` is taken, so the domain may be too)
  - `backup.cam`
  - `posturetodiefor.com`
  - `sitbackup.com`
- **GitHub:** `backup` is an organization and `getbackup` is a user. `sitbackup`, `backupcam`, `posturetodiefor` and `backup-posture` returned "not found" through the API, so they're probably free.
- **npm:** not checked (blocked from the sandbox). Use a scoped name like `@arii/backup`, since plain `backup` is certainly taken.
- **Repo and Pages URL:** the app still lives at `arii.github.io/posture-guard/`. Renaming the repo would break that URL (GitHub redirects repos, not Pages sites). Do it at the same time as pointing a custom domain at Pages.

## Store and launch copy

All copy follows the wellness rules (#41, #51): it **notices, reminds and helps you check in**. It never promises less pain, fixed posture or less stress.

**Chrome Web Store**
- *Name (75 max):* BackUp — Posture to Die For
- *Summary (132 max):* A webcam posture coach that runs in your browser. Slouch and it nudges you; sit well and it cheers. Nothing is uploaded.
- *Description:*
  > BackUp watches how you sit through your webcam and gives you a gentle nudge when you slouch: a chime first, then a few words on what to fix ("Head forward. Tuck your chin…"). Sit well and it notices that too.
  >
  > • Everything runs on your computer. No video, images or body landmarks are uploaded or saved.
  > • Natural recorded voice, chime-only or silent modes, and pause anytime.
  > • "Relax, don't brace": a breath check that helps you notice when you're holding your shoulders up.
  > • Eye and move break reminders based on time at your desk.
  > • A silent "Test me" mode to check your habit without any reminders.
  >
  > BackUp is a general wellness reminder, not a medical device. If something hurts, stop and see a health professional.
- *Camera permission justification:* "The camera is needed to see your head and shoulders and measure posture. Frames are processed in memory on your device and discarded; nothing is stored or sent."
- *Privacy practices tab:* data handled = "Health information" (posture and breathing measurements, processed and stored only on the device). Not sold, not used for unrelated purposes or creditworthiness. Privacy policy: `docs/privacy.html`.

**Product Hunt**
- *Name:* BackUp
- *Tagline (60 max):* Posture to Die For: a webcam posture coach in your browser
- *First comment:*
  > I sit at a desk all day and my head slowly drifts toward the screen. BackUp is the nudge I wanted: open a tab, and it chimes when you slouch and tells you what to fix. It all runs locally (MediaPipe in the browser, no uploads). The part I'm proudest of: it also catches "fake" good posture, when you're bracing your shoulders instead of relaxing into it. Free, open source, and very open to feedback.

**Hackathon (Kiroween 2026, Frankenstein)**
- *One-liner:* BackUp — Posture to Die For: a webcam posture coach stitched together from a pose model, a state machine, a natural TTS voice and some behavior science, all running in one browser tab.
- *Pitch:*
  > Started as a RealSense desktop app; rebuilt in Kiro into a browser app anyone can open. MediaPipe pose runs in the tab, a deterministic posture core is replayed against a recorded frame-by-frame timeline on every change, Kokoro renders a natural voice offline in CI, and a silent "Test me" mode measures whether the habit actually sticks. Posture to die for (please don't).

## Brand use in the product
- **UI:** "BackUp", plain and functional. The tagline appears on the start screen, page titles and the share text.
- **Audio:** clean chimes by default. An optional spooky chime pack is planned, to play up the tagline without making it the default.
- **Internal names stay as they are:** the `posture-guard:v1` storage key (so existing users keep their data) and the repo URL until the domain move.

## Owner-only checklist (issue #30)

These need the owner's accounts, hardware or voice, so an agent cannot do them. Engineering parts of #30 (no-WebGL camera fallback, live-site e2e) are done.

- [x] **Default branch** is `main` (verified 2026-11-23 with `gh repo view`) (Settings, Branches). Check that the repo home page shows the BackUp README and LICENSE.
- [ ] **WebGL in your Chrome** (best accuracy; without it the app uses a simpler fallback): `chrome://settings/system`, turn on "Use graphics acceleration when available", relaunch, then check `chrome://gpu` says "WebGL: Hardware accelerated".
- [ ] **Manual webcam test with a real person.** CI only uses a drawn figure. Open [the app](https://arii.github.io/posture-guard/app/) and:
  1. Click Start, accept the notice, allow the camera. Expect the badge to leave "no one in view" and the fps and angle readouts to move.
  2. Sit upright for 30 seconds. Expect "good posture" and no reminder.
  3. Lean your head forward and hold. Expect a chime, then a spoken cue about your head within a few seconds.
  4. Tilt one shoulder down. Expect a shoulder cue.
  5. Move out of frame. Expect "no one in view", then recovery when you return.
  6. Open Help and try the shoulder and breathing consent dialog: decline once, accept once, withdraw once.
  7. Try "Test me" (silent) for a minute: no sounds or banners.
  8. Click Delete my data and reload: progress and consent are gone.
  Note any wrong cue, then file it with the Report a bug link.
- [ ] **Demo video.** The Remotion render uses a drawn stand-in for the webcam scene. Add your own webcam clip (your own likeness, with your consent) and a voiceover, render, upload to YouTube.
- [ ] **Devpost.** Pick the Frankenstein category and link the repo, the live app, the video and `KIROWEEN.md`.
- [ ] **Legal items** (see `docs/legal-checklist.md`): confirm the Remotion free licence applies to you, run the USPTO search, and book a lawyer review before any payment or store listing.
