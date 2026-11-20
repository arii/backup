// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Maps TF.js MoveNet keypoints (17 COCO points, pixel coordinates) onto the
// 33-landmark BlazePose array that posture-core.js reads, so the camera mode
// that runs without WebGL (WASM/CPU backend) feeds the same engine. Pure, no
// DOM. tests/js/movenet-adapter.test.mjs.

export const LANDMARK_COUNT = 33;

/** MoveNet keypoint order -> BlazePose landmark index. */
export const MOVENET_TO_BLAZEPOSE = [
  0,  // nose
  2,  // left eye
  5,  // right eye
  7,  // left ear
  8,  // right ear
  11, // left shoulder
  12, // right shoulder
  13, // left elbow
  14, // right elbow
  15, // left wrist
  16, // right wrist
  23, // left hip
  24, // right hip
  25, // left knee
  26, // right knee
  27, // left ankle
  28, // right ankle
];

/**
 * MoveNet keypoint scores run lower than BlazePose visibilities: 0.3 is the
 * usual "keypoint present" threshold for MoveNet, while posture-core.js uses a
 * 0.5 visibility floor. Scale so MoveNet's 0.3 lands on 0.5.
 */
export const MOVENET_SCORE_THRESHOLD = 0.3;
const CORE_VISIBILITY_FLOOR = 0.5;

/** MoveNet score -> BlazePose-style visibility in 0..1. */
export function scoreToVisibility(score) {
  if (!Number.isFinite(score)) return 0;
  return clamp01(score * (CORE_VISIBILITY_FLOOR / MOVENET_SCORE_THRESHOLD));
}

function clamp01(v) {
  return v < 0 ? 0 : Math.min(v , 1);
}

/**
 * keypoints: MoveNet output for one pose ([{x, y, score}] in video pixels, 17 entries).
 * width/height: the video's pixel size, used to normalize x and y to 0..1.
 * Returns 33 {x, y, visibility} landmarks, or null when there is no usable pose.
 * visibility comes from scoreToVisibility. Points MoveNet does not produce get
 * visibility 0. A missing or non-finite keypoint also gets visibility 0 (the
 * core treats NaN visibility as hidden, but 0 keeps drawing code simple).
 */
export function movenetToLandmarks(keypoints, width, height) {
  if (!Array.isArray(keypoints) || keypoints.length < MOVENET_TO_BLAZEPOSE.length) return null;
  if (!(width > 0) || !(height > 0)) return null;
  const out = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }));
  MOVENET_TO_BLAZEPOSE.forEach((target, i) => {
    const k = keypoints[i];
    if (!k || !Number.isFinite(k.x) || !Number.isFinite(k.y)) return;
    out[target] = { x: k.x / width, y: k.y / height, visibility: scoreToVisibility(k.score) };
  });
  return out;
}

/**
 * Wraps a TF.js pose detector (estimatePoses is async) in the synchronous
 * detectForVideo shape that app.js step() expects from MediaPipe. It answers
 * with the latest finished result and starts the next inference only when
 * idle. An inference error is rethrown on every later call.
 */
export function createMoveNetDetector(detector) {
  let latest = null;
  let failure = null;
  let busy = false;
  return {
    detectForVideo(videoEl) {
      if (failure) throw failure;
      if (!busy && videoEl.videoWidth > 0) {
        busy = true;
        const w = videoEl.videoWidth, h = videoEl.videoHeight;
        Promise.resolve().then(() => detector.estimatePoses(videoEl, { flipHorizontal: false })).then((poses) => {
          latest = poses.length ? movenetToLandmarks(poses[0].keypoints, w, h) : null;
        }).catch((err) => { failure = err; }).finally(() => { busy = false; });
      }
      return { landmarks: latest ? [latest] : [] };
    },
  };
}
