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
  lm[23] = { x: 0.56, y: 0.95, visibility: 0.9 };
  lm[24] = { x: 0.44, y: 0.95, visibility: 0.9 };
  const ex = slouch ? -0.02 : 0;
  const ey = slouch ? 0.09 : 0;
  lm[7] = { x: 0.54 + ex + wobble, y: 0.46 + ey, visibility: 0.99 };
  lm[8] = { x: 0.46 + ex + wobble, y: 0.46 + ey, visibility: 0.99 };
  return lm;
}
