// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// The scripted "Try the demo" poses: 20 s of good posture, then 20 s with the head
// forward, repeating. Pure, so tests can replay exactly what the demo shows.

export const DEMO_CYCLE_S = 20;

/** Landmarks (33, MediaPipe order) for demo time `t` in seconds. */
export function demoPose(t) {
  const slouch = Math.floor(t / DEMO_CYCLE_S) % 2 === 1;
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const wobble = Math.sin(t * 1.7) * 0.003;
  lm[11] = { x: 0.6 + wobble, y: 0.62, visibility: 0.99 }; // unmirrored: left shoulder on the right
  lm[12] = { x: 0.4 + wobble, y: 0.62, visibility: 0.99 };
  lm[23] = { x: 0.56, y: 0.92, visibility: 0.9 }; // #109: off the bottom edge, so the hip dots are never clipped
  lm[24] = { x: 0.44, y: 0.92, visibility: 0.9 };
  const ex = slouch ? -0.02 : 0;
  const ey = slouch ? 0.116 : 0;
  // Ear spacing and ear-to-shoulder gap follow the demo avatar's own proportions (head width
  // about 0.69 of shoulder width, ears about 0.70 shoulder widths above the shoulders).
  lm[7] = { x: 0.5 + 0.065 + ex + wobble, y: 0.435 + ey, visibility: 0.99 };
  lm[8] = { x: 0.5 - 0.065 + ex + wobble, y: 0.435 + ey, visibility: 0.99 };
  return lm;
}

/**
 * The demo's pose for a Learn the cues step (#103): upright for the first step, then the
 * one fault the step teaches, so the skeleton and the tiles show what the card says.
 * metric: null | "head_forward" | "head_tilt" | "shoulder_level" | "trunk_lean".
 */
export function practicePose(metric, t) {
  const lm = demoPose(DEMO_CYCLE_S * 2 * Math.floor(t / (DEMO_CYCLE_S * 2)) + (t % DEMO_CYCLE_S)); // always the good half
  if (metric === "head_forward") {
    for (const i of [7, 8]) lm[i] = { ...lm[i], x: lm[i].x - 0.02, y: lm[i].y + 0.116 };
  } else if (metric === "head_tilt") {
    lm[7] = { ...lm[7], y: lm[7].y - 0.019 };
    lm[8] = { ...lm[8], y: lm[8].y + 0.019 };
  } else if (metric === "shoulder_level") {
    lm[11] = { ...lm[11], y: lm[11].y - 0.03 };
    lm[7] = { ...lm[7], y: lm[7].y - 0.012 }; // the head goes with the shoulders: no tilt cue
  } else if (metric === "trunk_lean") {
    for (const i of [7, 8, 11, 12]) lm[i] = { ...lm[i], x: lm[i].x + 0.06 };
  }
  return lm;
}
