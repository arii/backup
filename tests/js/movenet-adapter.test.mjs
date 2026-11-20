// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// movenet-adapter.js: MoveNet keypoints -> the 33 BlazePose landmarks posture-core.js reads.

import assert from "node:assert/strict";
import test from "node:test";
import {
  LANDMARK_COUNT,
  createMoveNetDetector,
  MOVENET_SCORE_THRESHOLD,
  MOVENET_TO_BLAZEPOSE,
  movenetToLandmarks,
  scoreToVisibility,
} from "../../docs/app/movenet-adapter.js";
import {
  DEFAULTS,
  LEFT_EAR,
  LEFT_HIP,
  LEFT_SHOULDER,
  PostureEngine,
  RIGHT_EAR,
  RIGHT_HIP,
  RIGHT_SHOULDER,
  State,
  scorePose,
} from "../../docs/app/posture-core.js";

const W = 640,
  H = 480;
const NAMES = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];

/** A front-facing seated pose in video pixels. headDx shifts the head sideways (a lean). */
function pose({ headDx = 0, hipScore = 0.54, score = 0.54 } = {}) {
  const at = {
    nose: [320 + headDx, 170],
    left_eye: [335 + headDx, 150],
    right_eye: [305 + headDx, 150],
    left_ear: [360 + headDx, 165],
    right_ear: [280 + headDx, 165],
    left_shoulder: [400, 300],
    right_shoulder: [240, 300],
    left_elbow: [420, 400],
    right_elbow: [220, 400],
    left_wrist: [420, 470],
    right_wrist: [220, 470],
    left_hip: [380, 470],
    right_hip: [260, 470],
    left_knee: [380, 479],
    right_knee: [260, 479],
    left_ankle: [380, 479],
    right_ankle: [260, 479],
  };
  return NAMES.map((n) => ({
    name: n,
    x: at[n][0],
    y: at[n][1],
    score: n.endsWith("_hip") ? hipScore : score,
  }));
}

test("maps the 17 keypoints to BlazePose indices and normalizes to 0..1", () => {
  const lm = movenetToLandmarks(pose(), W, H);
  assert.equal(lm.length, LANDMARK_COUNT);
  assert.equal(new Set(MOVENET_TO_BLAZEPOSE).size, 17);
  assert.equal(lm[LEFT_SHOULDER].x, 400 / W);
  assert.equal(lm[LEFT_SHOULDER].y, 300 / H);
  assert.ok(Math.abs(lm[LEFT_SHOULDER].visibility - 0.9) < 1e-9);
  assert.equal(lm[RIGHT_SHOULDER].x, 240 / W);
  assert.equal(lm[RIGHT_SHOULDER].y, 300 / H);
  assert.equal(lm[LEFT_EAR].x, 360 / W);
  assert.equal(lm[RIGHT_EAR].x, 280 / W);
  assert.equal(lm[LEFT_HIP].y, 470 / H);
  assert.equal(lm[RIGHT_HIP].x, 260 / W);
  assert.equal(lm[0].x, 0.5); // nose
  assert.ok(Math.abs(lm[27].visibility - 0.9) < 1e-9); // left ankle
});

test("landmarks MoveNet does not produce are invisible", () => {
  const lm = movenetToLandmarks(pose(), W, H);
  const mapped = new Set(MOVENET_TO_BLAZEPOSE);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    if (!mapped.has(i)) assert.equal(lm[i].visibility, 0, `landmark ${i}`);
  }
});

test("MoveNet's 0.3 keypoint threshold lands on the core's 0.5 visibility floor", () => {
  assert.equal(MOVENET_SCORE_THRESHOLD, 0.3);
  assert.ok(Math.abs(scoreToVisibility(0.3) - DEFAULTS.scoring.visibility_floor) < 1e-9);
  assert.ok(scoreToVisibility(0.29) < DEFAULTS.scoring.visibility_floor);
  assert.equal(scoreToVisibility(0.9), 1);
  assert.equal(scoreToVisibility(0), 0);
  assert.equal(scoreToVisibility(undefined), 0);
});

test("score becomes visibility, clamped to 0..1; bad or missing keypoints are invisible", () => {
  const kp = pose();
  kp[3].score = 0.95;
  kp[4].score = -0.2;
  kp[5].score = NaN;
  kp[6] = null;
  kp[11].x = NaN;
  const lm = movenetToLandmarks(kp, W, H);
  assert.equal(lm[LEFT_EAR].visibility, 1);
  assert.equal(lm[RIGHT_EAR].visibility, 0);
  assert.equal(lm[LEFT_SHOULDER].visibility, 0);
  assert.equal(lm[RIGHT_SHOULDER].visibility, 0);
  assert.equal(lm[LEFT_HIP].visibility, 0);
});

test("no pose or unusable input gives null", () => {
  assert.equal(movenetToLandmarks(undefined, W, H), null);
  assert.equal(movenetToLandmarks([], W, H), null);
  assert.equal(movenetToLandmarks(pose(), 0, H), null);
  assert.equal(movenetToLandmarks(pose(), W, NaN), null);
});

test("low-score ears make the core report low visibility, not a posture score", () => {
  const kp = pose();
  kp[3].score = 0.15;
  const r = scorePose(movenetToLandmarks(kp, W, H), DEFAULTS.scoring);
  assert.equal(r.kind, "unreliable");
  assert.equal(r.reason, "low_visibility");
});

test("core scores upright vs leaning mapped poses; hidden hips degrade instead of failing", () => {
  const upright = scorePose(movenetToLandmarks(pose(), W, H), DEFAULTS.scoring);
  const leaning = scorePose(movenetToLandmarks(pose({ headDx: 60 }), W, H), DEFAULTS.scoring);
  assert.equal(upright.kind, "scored");
  assert.ok(Math.abs(upright.head_forward_deg) < DEFAULTS.scoring.head_forward_deg);
  assert.ok(Math.abs(leaning.head_forward_deg) > DEFAULTS.scoring.head_forward_deg);
  const noHips = scorePose(movenetToLandmarks(pose({ hipScore: 0.05 }), W, H), DEFAULTS.scoring);
  assert.equal(noHips.kind, "scored");
  assert.equal(noHips.trunk_lean_available, false);
});

test("engine reaches good when upright and bad after a sustained lean", () => {
  const engine = new PostureEngine();
  const upright = movenetToLandmarks(pose(), W, H);
  const leaning = movenetToLandmarks(pose({ headDx: 60 }), W, H);
  let out;
  let t = 0;
  for (; t < 5; t += 0.1) out = engine.process(upright, t);
  assert.equal(out.transition.state, State.GOOD);
  for (; t < 10; t += 0.1) out = engine.process(leaning, t);
  assert.ok([State.BAD_CHIME, State.BAD_VOICE].includes(out.transition.state), out.transition.state);
  assert.ok(Number.isFinite(out.needle));
});

const kp = () => Array.from({ length: 17 }, () => ({ x: 320, y: 240, score: 0.9 }));
const video = { videoWidth: 640, videoHeight: 480 };
const tick = () => new Promise((r) => setTimeout(r, 0));

test("createMoveNetDetector returns the latest finished result and never overlaps inferences", async () => {
  let calls = 0;
  let release;
  const detector = {
    estimatePoses: () => {
      calls++;
      return new Promise((r) => {
        release = () => r([{ keypoints: kp() }]);
      });
    },
  };
  const d = createMoveNetDetector(detector);
  assert.deepEqual(d.detectForVideo(video).landmarks, []);
  await tick();
  d.detectForVideo(video);
  d.detectForVideo(video);
  assert.equal(calls, 1);
  release();
  await tick();
  const res = d.detectForVideo(video);
  assert.equal(res.landmarks.length, 1);
  assert.equal(res.landmarks[0].length, LANDMARK_COUNT);
  await tick();
  assert.equal(calls, 2);
});

test("createMoveNetDetector does not start before the video has a size", async () => {
  let calls = 0;
  const d = createMoveNetDetector({
    estimatePoses: async () => {
      calls++;
      return [];
    },
  });
  d.detectForVideo({ videoWidth: 0, videoHeight: 0 });
  await tick();
  assert.equal(calls, 0);
});

test("createMoveNetDetector rethrows an inference error on later calls", async () => {
  const boom = new Error("boom");
  const d = createMoveNetDetector({
    estimatePoses: async () => {
      throw boom;
    },
  });
  d.detectForVideo(video);
  await tick();
  await tick();
  assert.throws(() => d.detectForVideo(video), boom);
  assert.throws(() => d.detectForVideo(video), boom);
});

test("createMoveNetDetector reports no landmarks when no pose is found", async () => {
  const d = createMoveNetDetector({ estimatePoses: async () => [] });
  d.detectForVideo(video);
  await tick();
  assert.deepEqual(d.detectForVideo(video).landmarks, []);
});
