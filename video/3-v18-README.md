# BackUp: Posture to Die For, v18

The delivered main video is `1-backup-main-v18.mp4`: 65.9 seconds, 1920 x 1080, 30 fps. No social cut is included. This is the original delivered render, not a new render.

`2-backup-v18-editable-source.zip` contains the matching 36-file Remotion project, including the raw app capture, narration, music, chime and illustrated camera input. Extract it into a separate directory, then run `npm ci`, `npm run restore-footage`, and `npm run render`. Node requirements are in its package.json; restoration also requires FFmpeg. The technical composition ID remains `BackUpDemo`.

The existing parent video project is preserved. This archive keeps the final v18 timeline, source offsets and assets together without mixing them with older scripts or captures. Its optional SVG generator has an editing-environment-specific sharp import and output path, already documented in the archived README. It is not required for restoration or rendering. Legacy props remain for source fidelity.

## What this video shows

- Illustrated animated camera input, not physical-person camera capture.
- Actual app capture with its detector unchanged. Face and ear estimates are approximate; this is not evidence of real-person posture recovery.
- Narration, music, chime and corrective speech added in edit. The corrective cue matches the visible shoulders-uneven reminder; it is not a recording of live product audio.
- A configured Kiro hook, not proof that the hook executed.

See `4-v18-scene-description.md` for scene timing and limitations. The approved name WAV remains unchanged and unused in the source. No production app or .kiro files are changed.

## Verification

The archived project passed `npm ci --ignore-scripts` and `npm run typecheck`. The MP4 was inspected at the cue and closing-title scenes; media metadata confirms 1920 x 1080, 30 fps, 65.92 seconds including audio padding. Rendering was not repeated. These checks do not certify the underlying posture detector's accuracy.

SHA256:

- ZIP: `873744355bb660612c3455cad24c09ce51f21a33e78b6d2cb6c1e2cb47cf5a36`
- MP4: `5d0571f83e16c15c9b72ac22e59d5883f27b68e10688871c381b99da3147251a`
- Preserved unused name WAV: `89b345867ba12df234609853c74fbf8f90ed9edab30f0a1b705c4bd4c1497c1e`

Product/code-owner review is requested. This PR does not authorize merge, deployment or a redesign.
