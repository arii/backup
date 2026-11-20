// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Breathing messages: they coach easy breathing and measure nothing.
// - BreathingMoments: an opt-in line during a long good-posture streak, a
//   different wording each time, at most every 30 minutes.
// - BreatheGuide: "Breathe with me", one minute of paced breathing (about 4 s
//   in, 6 s out). The caller ends it by running the existing BreathCheck.
// Wellness wording only: no health or medical claims. Pure (no DOM);
// tests/js/breathing.test.mjs.

import { BREATHING_MOMENTS } from "./voice-lines.js";

export const MOMENTS = Object.freeze({
  min_streak_s: 10 * 60, // only during a long good streak
  every_s: 30 * 60, // at most every 30 min
});

export const GUIDE = Object.freeze({ in_s: 4, out_s: 6, total_s: 60 });

export const GUIDE_SAFETY = "Stop if you feel dizzy.";

export class BreathingMoments {
  constructor(cfg = MOMENTS, lines = BREATHING_MOMENTS) {
    this.cfg = cfg;
    this.lines = lines;
    this.index = 0;
    this.last = null;
  }

  /** True when a moment may be offered: a long good streak and 30 min since the last one. */
  due(streakS, now) {
    if (streakS < this.cfg.min_streak_s) return false;
    return this.last === null || now - this.last >= this.cfg.every_s;
  }

  /** The next line (rotating), recording that a moment was shown at `now`. */
  take(now) {
    this.last = now;
    const line = this.lines[this.index % this.lines.length];
    this.index += 1;
    return line;
  }
}

export class BreatheGuide {
  constructor(cfg = GUIDE) {
    this.cfg = cfg;
    this.t0 = null;
  }

  get active() {
    return this.t0 !== null;
  }

  start(now) {
    this.t0 = now;
  }
  cancel() {
    this.t0 = null;
  }

  /** Returns null when idle, else { phase: "in"|"out"|"done", fill: 0..1, cycle, phaseStart }.
   *  fill rises over the inhale and falls over the exhale (the hold-bar style).
   *  phaseStart is true on the first call of each phase (for a voice cue).
   *  After "done" the guide is idle again. */
  update(now) {
    if (this.t0 === null) return null;
    const t = now - this.t0;
    const { in_s, out_s, total_s } = this.cfg;
    if (t >= total_s) {
      this.t0 = null;
      this.lastPhase = null;
      return { phase: "done", fill: 0, cycle: 0, phaseStart: true };
    }
    const len = in_s + out_s;
    const cycle = Math.floor(t / len);
    const p = t - cycle * len;
    const phase = p < in_s ? "in" : "out";
    const fill = phase === "in" ? p / in_s : 1 - (p - in_s) / out_s;
    const key = `${cycle}:${phase}`;
    const phaseStart = key !== this.lastPhase;
    this.lastPhase = key;
    return { phase, fill, cycle, phaseStart };
  }
}
