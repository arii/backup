# Posture Guard demo video

A [Remotion](https://www.remotion.dev/) project for the Kiroween submission video
(about 1 minute 50 seconds; the outline is in [`../KIROWEEN.md`](../KIROWEEN.md)).
The footage is real: Playwright records the deployed app, and the edit cuts on the
moments it measured (when the reminder fired, when it spoke, when posture
recovered).

## Render it on GitHub (no setup)

Run the **demo-video** workflow (Actions → demo-video → Run workflow). It records
the live site, renders `out/posture-guard-demo.mp4`, and uploads it as the
`posture-guard-demo` artifact. It also runs on every push that touches `video/`.

## Render it locally

Needs Node 20+, Python 3, `ffmpeg` and `espeak-ng`.

```bash
cd video
npm install
npx playwright install chromium
bash scripts/make-fake-camera.sh person.y4m   # sample photo -> fake webcam feed
bash scripts/make-audio.sh                    # the app's chimes + the spoken cue
npm run capture -- https://arii.github.io/posture-guard/ "$PWD/person.y4m" public
npm run studio                                # preview and tweak
npm run render                                # -> out/posture-guard-demo.mp4
```

## Add yourself

The best shot is you, slumping dramatically, then sitting up. Screen-record the
app with your webcam on, save it as `public/user-webcam.mp4`, and set these in
`public/capture.json` (after `npm run capture`):

```json
"userClip": "user-webcam.mp4",
"userClipSeconds": 20
```

It plays after the demo footage. A voiceover can go on top in any editor, or as
another `<Html5Audio>` in `src/scenes.tsx`.

## Scenes

| Scene | Length | What |
|---|---|---|
| Cold open | 6 s | "Posture to die for. (Please don't.)" while a stick figure slumps |
| Ailments | 10 s | Tech neck, the puzzled dog, the one-elbow lean, the Leaning Tower of Pisa |
| Demo | 24 s | Upright → slouch → chime and *What to fix* → spoken cue → reward chime |
| Your clip | optional | `userClip` |
| Real model | 10 s | The browser's pose model on a real (fake-camera) person |
| The monster | 30 s | The anatomy: eyes, two brains, spinal cord, voice, heartbeat... It's alive. |
| Proof | 14 s | 632 frames, 7 properties, 11 live checks, the `.kiro/` tree |
| Case history | 10 s | Prototype → amputation → transplant |
| Outro | 7 s | URL over the landing page |

Scene lengths live in `src/timeline.ts`; the scenes are in `src/scenes.tsx`.
