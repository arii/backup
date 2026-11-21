// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// The "Take a break" menu: short guided demos (stretch, stand and move, drink
// water) and the local water count. Pure (no DOM, no clock): the caller passes
// elapsed seconds and the date key. No camera is used, nothing scores form, and
// the count stays in this browser (store.water[YYYY-MM-DD]). Tests in
// tests/js/wellness.test.mjs. Spec: .kiro/specs/progressive-loading Requirement 7.

import { DEMO_LINES } from "./voice-lines.js";

/** Each demo is 10 to 20 seconds of timed steps. `pose` picks the small outline animation. */
const DEMOS = Object.freeze({
  stretch: [
    { s: 6, pose: "neck", line: DEMO_LINES.stretchNeck },
    { s: 5, pose: "roll", line: DEMO_LINES.stretchRoll },
    { s: 5, pose: "chest", line: DEMO_LINES.stretchChest },
  ],
  move: [
    { s: 4, pose: "stand", line: DEMO_LINES.moveStand },
    { s: 8, pose: "walk", line: DEMO_LINES.moveWalk },
    { s: 4, pose: "reach", line: DEMO_LINES.moveReach },
  ],
  water: [
    { s: 3, pose: "cup", line: DEMO_LINES.waterPick },
    { s: 5, pose: "sip", line: DEMO_LINES.waterSip },
    { s: 4, pose: "cup", line: DEMO_LINES.waterPut },
  ],
});

export const DEMO_DONE = Object.freeze({
  stretch: DEMO_LINES.stretchDone,
  move: DEMO_LINES.moveDone,
});

export function demoLength(kind) {
  return DEMOS[kind].reduce((a, step) => a + step.s, 0);
}

/** The step at `t` seconds: { index, line, pose, done }. done is true once the last step has run. */
export function demoAt(kind, t) {
  const steps = DEMOS[kind];
  let end = 0;
  for (let index = 0; index < steps.length; index++) {
    end += steps[index].s;
    if (t < end) return { index, line: steps[index].line, pose: steps[index].pose, done: false };
  }
  const last = steps[steps.length - 1];
  return { index: steps.length - 1, line: last.line, pose: last.pose, done: true };
}

/** All steps at once, one per line, for people who ask for reduced motion. */
export function demoStaticText(kind) {
  return DEMOS[kind].map((step, i) => `${i + 1}. ${step.line}`).join("\n");
}

const KEEP_DAYS = 60;

/** Add one drink to the day's count (store.water). Returns the new count. Keeps the last 60 days. */
export function addWater(store, dayKey) {
  const old = store.water && typeof store.water === "object" ? store.water : {};
  const water = {};
  for (const key of Object.keys(old).sort().slice(-KEEP_DAYS)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(old[key]) && old[key] > 0) water[key] = Math.floor(old[key]);
  }
  water[dayKey] = (water[dayKey] || 0) + 1;
  store.water = water;
  return water[dayKey];
}
