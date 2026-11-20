# Vendored third-party files

These files are served from this site so the app contacts no third-party host at runtime
(see issue #45). They are unmodified copies. Do not edit them by hand.

| File | Source | sha256 |
| --- | --- | --- |
| `vision_bundle.mjs` | `@mediapipe/tasks-vision@0.10.14` (npm, `vision_bundle.mjs`) | `e77f281f9619150d937023c355bae170e9120e3b9e43f1e23a2a7bee07197669` |
| `wasm/vision_wasm_internal.js` | same package, `wasm/` | `9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c` |
| `wasm/vision_wasm_internal.wasm` | same package, `wasm/` | `f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc` |
| `wasm/vision_wasm_nosimd_internal.js` | same package, `wasm/` | `abe9b6fbeaf86fcb53a5edce3926c82ccb0619e18fed4d9d9ce561ee7f55e054` |
| `wasm/vision_wasm_nosimd_internal.wasm` | same package, `wasm/` | `38b61feab2fd7934e05cbe9f68baa308978a5e3b7f85c1913bb8ae89b8ef8b97` |
| `pose_landmarker_lite.task` | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `movenet/movenet_bundle.mjs` | esbuild bundle of `@tensorflow/tfjs-core@4.22.0`, `tfjs-converter@4.22.0`, `tfjs-backend-cpu@4.22.0`, `tfjs-backend-wasm@4.22.0`, `@tensorflow-models/pose-detection@2.1.3` (see below) | `6a2b4906222a28ed24b2ff18501b0f0f81223d36496d2ca072857a958990eec1` |
| `movenet/tfjs-backend-wasm.wasm` | `@tensorflow/tfjs-backend-wasm@4.22.0`, `wasm-out/` | `70a5d516060464e5269f01c74bac1772d6b8ab6cb612acf16b5cdaf61f78d892` |
| `movenet/tfjs-backend-wasm-simd.wasm` | same package, `wasm-out/` | `77ebb28a6d34f371dbbf2086b7f2de8994acd8ea5a3cf1fa24d2c26c840cac7b` |
| `movenet/model.json` | MoveNet SinglePose Lightning v4, `https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4?tfjs-format=compressed` (redirects to Kaggle Models) | `c65a3447162efa0c42af29498a4b151f4415b36ff3ae6fae2b28a32e840dcbfb` |
| `movenet/group1-shard1of2.bin` | same model archive | `b42c3232bf13b0efc691d3f0693dd3fc74404f709b1deee0a271828af6dbbea2` |
| `movenet/group1-shard2of2.bin` | same model archive | `8253ab965aa3122c08f331777ca395ce9ca19bb9e7cb278b99de1c46dbdeb6dc` |

The npm tarball `mediapipe-tasks-vision-0.10.14.tgz` has sha256
`3122ba7a70d414ffbb3a1bd194c370594a1bf1c90e467c375a5b8bd25be2c004`.

## No-WebGL fallback (`movenet/`)

MediaPipe's web runtime needs WebGL. When WebGL is unavailable the app loads `movenet/` lazily
(TensorFlow.js on its WebAssembly backend running MoveNet Lightning) and maps its 17 keypoints
to the landmarks `posture-core.js` reads (`movenet-adapter.js`). The 4.6 MB model archive
(`.tar.gz`) has sha256 `28b9a96dde847d2c5dd0d44ddd131d6dfd388b8a014a4535dc31b4059ce61765`.
`movenet_bundle.mjs` was built once, with this entry file, and committed:

```
npm i @tensorflow/tfjs-core@4.22.0 @tensorflow/tfjs-converter@4.22.0 \
  @tensorflow/tfjs-backend-wasm@4.22.0 @tensorflow/tfjs-backend-cpu@4.22.0 \
  @tensorflow-models/pose-detection@2.1.3 esbuild
# entry.js
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-converter";
import "@tensorflow/tfjs-backend-cpu";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import { createDetector, SupportedModels, movenet } from "@tensorflow-models/pose-detection";
export { tf, setWasmPaths, createDetector, SupportedModels, movenet };
npx esbuild entry.js --bundle --format=esm --minify --target=es2020 --legal-comments=none --outfile=movenet_bundle.mjs
```

The bundle contains default model URLs on tfhub.dev and storage.googleapis.com as strings. The app
always passes its own `modelUrl` and WASM paths, so nothing is fetched from them (the e2e fails
on any request that leaves the origin).

## License

MediaPipe, `@mediapipe/tasks-vision`, TensorFlow.js, `pose-detection` and the MoveNet model are Apache-2.0. The license text is in `LICENSE` here
(from <https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE>). The source map files
from the package are not vendored.

## Updating

```
npm pack @mediapipe/tasks-vision@<version>
```

Copy `vision_bundle.mjs` and `wasm/*` here, re-download the model, update the hashes above and
the `TASKS_VISION` path in `../app.js` if the layout changes.

## Repository size

The two WASM builds and the model add about 24 MB. Each upgrade adds the same again to git
history. The `nosimd` build is only for browsers without WebAssembly SIMD; drop it (and its
CI check) if the supported-browser list allows.
