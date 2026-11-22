# Face Landmarker cost evaluation

Task: wellness-tools task 4 (requirements 4.5, 4.6; feeds task 9, requirements 6.3, 6.4).
Date measured: 2026-11-21. Decision: **no-go** for blendshape features (jaw proxy and blink reminder) in this release.

## What was measured

Test page loaded `vision_bundle.mjs` and `wasm/` from `docs/app/vendor/` (tasks-vision 0.10.14, already shipped) and `face_landmarker.task` (float16, `outputFaceBlendshapes: true`, one face) from the public MediaPipe model bucket. Headless Chromium (Playwright) on an 8 vCPU Intel Xeon Platinum 8488C, fake camera at 480x640 showing a face. Frames were sent with `detectForVideo`, 20 frames at 2 fps (500 ms apart), median and p90 of the call time. The same page also ran the shipped Pose Landmarker lite model, alone and together with the face model, in one thread as the app does.

| Item | Result |
| --- | --- |
| `face_landmarker.task` size | 3,758,596 bytes (3.6 MiB) |
| Extra wasm | 0 bytes. The tasks-vision wasm (9.4 MB SIMD, 9.3 MB no-SIMD) and bundle are shared with the pose model |
| Model create time, from localhost | 187 to 196 ms (CPU delegate); 104 ms (GPU delegate, software WebGL) |
| Pose create time, same page | 122 to 133 ms |
| Per frame, CPU delegate, pose only | 31.8 ms median, 38.3 ms p90 |
| Per frame, CPU delegate, face only | 21.9 ms median, 25.4 ms p90 |
| Per frame, CPU delegate, pose and face | 53.3 ms median, 71.7 ms p90 |
| Per frame, GPU delegate (software WebGL), pose / face / both | 217 / 117 / 333 ms median |
| JS heap after all runs | about 16 MB (the wasm heap is not included) |

At 2 fps the face model adds about 22 ms per 500 ms, roughly 4 % of one core on this machine. Running 15 fps instead (spacing frames 40 ms apart) gave the same 22 ms per face frame and 53 ms for pose plus face, so both models together cannot keep up with 15 fps on a single thread (about 10 fps at best here).

Caveats:
- The GPU numbers use SwiftShader (software WebGL) and are inflated; they are not evidence about real GPUs. The CPU delegate numbers come from a server CPU that is faster than a typical mid-range laptop; expect 1.5 to 3 times higher on a laptop.
- Model load was measured from localhost, so it has no network time. Over the 1.5 Mbit/s link used in the progressive-loading spec the 3.6 MiB download alone is about 20 s (3.76 MB x 8 / 1.5 Mbit/s).
- The fake camera loops a short clip; real faces, lighting and head turns change the face-detector cost. Battery and thermal cost were not measured.
- CPU % at 2 fps was inferred from per-frame time, not sampled from the OS.

## Size impact

- Offline copy today is about 32 MB (`docs/privacy.html`; `docs/app/vendor` is 31 MB on disk). The face model would add 3.76 MB, about 12 %.
- It would load only after the user turns the tool on (requirement 4.5), so first-visit cost stays at zero. The offline button would either grow by 3.76 MB for everyone or need a second opt-in cache group.
- No new origin is needed if the file is self-hosted under `docs/app/vendor/`.

## Why blink detection fails at 2 fps

A blink lasts about 100 to 400 ms. Sampling every 500 ms sees most blinks as open eyes and misses them, so the "very low blink rate" test of requirement 6.3 would fire for almost everyone. Reliable blink counting needs 10 fps or more. The measurements above show pose and face together cost 53 ms per frame, which is more than half of the time budget at 10 fps and leaves little for rendering, voice and the page. That would take most of one core on a laptop continuously, for a reminder that must not show a rate and cannot be validated.

The jaw proxy (requirement 4.2) is weaker still. Requirement 4.3 already says a clenched jaw with relaxed lips looks the same as a relaxed one, so the blendshapes can only shift a timer. The time-based jaw prompt (task 8) already delivers the user-visible feature.

## Privacy implications if built later

Rules from issue #51 and `docs/legal-checklist.md` would all apply:
- Face blendshapes are biometric-adjacent data. A dated, opt-in consent (`docs/app/consent.js`) must come before any face model loads, separate from the pose consent.
- Store derived scores only. No landmarks, meshes, embeddings or frames are stored or sent.
- Self-host the model; add its sha256 and source to `docs/app/vendor/README.md`.
- `docs/privacy.html` would need a retention statement for blink or face data (none kept beyond the current minute) and the new offline size.

## Decision

No-go. Reasons:
1. Blink reminders need 10 fps or more, which the measured CPU cost makes unreasonable next to pose. At 2 fps the signal is invalid.
2. The jaw proxy cannot be the sole trigger and adds no user-visible value over the time-based prompt that already ships.
3. It would add a second biometric consent, a legal re-review and 3.76 MB of offline size for features the spec itself labels as coarse or unvalidated.

Revisit if: a validated low-rate blink method appears, the pose model is dropped from the same thread (for example a worker per model), or a user need for face tension scoring is shown. Task 4 is done as an evaluation. Task 9 is deferred with this reason.
