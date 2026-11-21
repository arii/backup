// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Intent prefetch for the landing page. When a visitor shows they are about to
// open the app (pointer down, keyboard focus, or hovering for more than 150 ms
// on a link to ./app/), ask the browser to fetch the pose model and the WASM
// runtime into its normal HTTP cache, so the first start is faster.
// Never on page load or idle. Skipped on Save-Data and slow connections.
// Same-origin URLs only, exactly the ones loadModel() in app/app.js fetches.
// No service worker, no camera, nothing is sent anywhere.
(() => {
  const HOVER_MS = 150;
  let done = false;

  function slowConnection() {
    const c = navigator.connection;
    return Boolean(c && (c.saveData === true || c.effectiveType === "2g" || c.effectiveType === "slow-2g"));
  }

  // The same SIMD probe the MediaPipe loader uses to pick the runtime build.
  function hasSimd() {
    try {
      return WebAssembly.validate(
        new Uint8Array([
          0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
        ]),
      );
    } catch {
      return false;
    }
  }

  // Without WebGL the app uses the MoveNet fallback, not this model.
  function hasWebGL() {
    try {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      return false;
    }
  }

  function prefetch() {
    if (done || slowConnection() || !hasWebGL()) return;
    done = true;
    const wasm = hasSimd() ? "vision_wasm_internal.wasm" : "vision_wasm_nosimd_internal.wasm";
    ["app/vendor/pose_landmarker_lite.task", "app/vendor/wasm/" + wasm].forEach((path) => {
      // fetch() fills the HTTP cache with the same kind of request the app makes later.
      fetch(new URL(path, location.href).href, { priority: "low" })
        .then((res) => res.arrayBuffer())
        .catch(() => {});
    });
  }

  document.querySelectorAll('a[href="./app/"]').forEach((a) => {
    let timer = 0;
    a.addEventListener("pointerdown", prefetch);
    a.addEventListener("focus", prefetch);
    a.addEventListener("pointerenter", () => {
      timer = setTimeout(prefetch, HOVER_MS);
    });
    a.addEventListener("pointerleave", () => clearTimeout(timer));
  });
})();
