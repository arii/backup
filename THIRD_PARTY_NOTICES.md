# Third-party notices

BackUp is released under the [MIT License](LICENSE). It uses the third-party
work below. This is not legal advice. Licenses and sources were taken from the
projects' own pages and should be re-checked before commercial use.

## Shipped with the site

| Component | Where | License | Notes |
|---|---|---|---|
| `@mediapipe/tasks-vision` 0.10.14 (JavaScript bundle and WASM runtime) | `docs/app/vendor/` | Apache-2.0 | Unmodified copies, with hashes in [`docs/app/vendor/README.md`](docs/app/vendor/README.md). License text: [`docs/app/vendor/LICENSE`](docs/app/vendor/LICENSE). |
| MediaPipe Pose Landmarker (lite) model, `pose_landmarker_lite.task` | `docs/app/vendor/` | Apache-2.0 per Google's MediaPipe documentation and model card | Downloaded from `storage.googleapis.com/mediapipe-models` and self-hosted. Confirm against the official model card before commercial use. |
| TensorFlow.js (`@tensorflow/tfjs-core`, `tfjs-converter`, `tfjs-backend-cpu`, `tfjs-backend-wasm`) 4.22.0 and `@tensorflow-models/pose-detection` 2.1.3, bundled with esbuild into `movenet_bundle.mjs`, plus the two `tfjs-backend-wasm` binaries | `docs/app/vendor/movenet/` | Apache-2.0 | Used only when WebGL is unavailable. Hashes and build steps in [`docs/app/vendor/README.md`](docs/app/vendor/README.md). License text: [`docs/app/vendor/LICENSE`](docs/app/vendor/LICENSE). |
| MoveNet SinglePose Lightning v4 model (TF.js format) | `docs/app/vendor/movenet/` | Apache-2.0 per the model's Kaggle page | Downloaded once from the TF Hub / Kaggle Models link in the vendor README and self-hosted. Confirm against the model card before commercial use. |
| Kokoro-82M voices `af_heart` and `am_michael` | Generated MP3s in `docs/app/voice/` | Apache-2.0 ([model card](https://huggingface.co/hexgrad/Kokoro-82M)) | The committed audio is generated output. The `kokoro-js`, transformers.js and onnxruntime packages run only in CI (`scripts/render-voice.mjs`) and are not shipped. |

## Used to build the demo video

| Component | License | Notes |
|---|---|---|
| Remotion 4 (`video/`) | [Remotion License](https://www.remotion.dev/docs/license) | Free for individuals and small companies, paid above a size threshold. The owner must confirm the free tier applies before publishing the rendered video. |
| Sample photo `id_fail_distant_waist_up.jpg` from [`google-ai-edge/mediapipe-samples-web`](https://github.com/google-ai-edge/mediapipe-samples-web) | The repository is Apache-2.0. The photo's own source and license are not confirmed. | Used as a fake camera feed in CI and in the draft demo video (`video/scripts/make-fake-camera.sh`). It is not served by the site. |

**Likeness warning.** The sample photo shows a real person. A copyright license does
not cover a person's likeness in promotional material (right of publicity or
personality rights). Before publishing the demo video to YouTube or Devpost, replace
the photo with your own footage, or confirm that the photo is a cleared stock image.

## Names and trademarks

"Kiro" and "Kiroween" are used only to describe the hackathon and the tool used to
build this project. "MediaPipe" and "Google" belong to their owners. "BackUp"
may already be used by other products. Run a trademark search before any commercial
use or app-store listing.
