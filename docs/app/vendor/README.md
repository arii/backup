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

The npm tarball `mediapipe-tasks-vision-0.10.14.tgz` has sha256
`3122ba7a70d414ffbb3a1bd194c370594a1bf1c90e467c375a5b8bd25be2c004`.

## License

MediaPipe and `@mediapipe/tasks-vision` are Apache-2.0. The license text is in `LICENSE` here
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
