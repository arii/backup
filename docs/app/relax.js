// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Anti-bracing: "good" posture held by squeezing (shoulders hiked toward the
// ears, chest held rigid) passes the angle checks yet leaves the upper traps
// sore. The tell the webcam can see is neck length: the vertical gap from the
// ears down to the shoulders, divided by shoulder width so distance to the
// camera cancels out. Shoulders that creep up shorten it.
//
// - BracingMonitor learns your relaxed neck length (a high quantile of recent
//   good-posture frames, or the exhale-and-drop step of a breath check) and
//   flags a sustained drop below it while posture is otherwise good.
// - BreathCheck runs the "take a deep breath" test: if the shoulders rise on
//   the inhale, or drop when told to let go, you were bracing.
//
// Browser-only and UI-facing: it reads landmarks and never changes the
// posture state machine, so posture-core.js parity is unaffected.

import { LEFT_EAR, LEFT_SHOULDER, RIGHT_EAR, RIGHT_SHOULDER } from "./posture-core.js";

export const RELAX = Object.freeze({
  visibility_floor: 0.5,
  smoothing_tau_s: 0.4, // EMA on the neck ratio (landmark jitter)
  reference_window_s: 600, // relaxed reference: last 10 min of good posture...
  reference_quantile: 0.8, // ...its 80th percentile (shoulders at their lowest, not the noise peak)
  min_reference_s: 45, // good-posture seconds needed before flagging anything
  bracing_drop: 0.12, // flag when the neck ratio is 12% below relaxed...
  bracing_sustain_s: 20, // ...for 20 s straight (not a stretch or a shrug)
  bracing_cooldown_s: 300, // at most one "drop your shoulders" every 5 min
  breath_rise: 0.07, // inhale shortening the neck ratio by 7%+ = shoulders hiked
  breath_settle: 0.07, // exhale lengthening it by 7%+ = they were held up before
});

/** Ears-above-shoulders gap / shoulder width, or null when not visible.
 *  Image y grows downward, so a relaxed person gives a clearly positive value. */
export function neckRatio(lm, floor = RELAX.visibility_floor) {
  if (!lm) return null;
  const pts = [lm[LEFT_EAR], lm[RIGHT_EAR], lm[LEFT_SHOULDER], lm[RIGHT_SHOULDER]];
  if (pts.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.visibility ?? 1) < floor)) return null;
  const width = Math.hypot(lm[RIGHT_SHOULDER].x - lm[LEFT_SHOULDER].x, lm[RIGHT_SHOULDER].y - lm[LEFT_SHOULDER].y);
  if (width < 1e-6) return null;
  const earY = (lm[LEFT_EAR].y + lm[RIGHT_EAR].y) / 2;
  const shoulderY = (lm[LEFT_SHOULDER].y + lm[RIGHT_SHOULDER].y) / 2;
  return (shoulderY - earY) / width;
}

function quantile(values, q) {
  const s = values.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i];
}

export class BracingMonitor {
  constructor(cfg = RELAX) {
    this.cfg = cfg;
    this.ema = null;
    this.lastT = null;
    this.samples = []; // [t, ratio] once per second of good posture
    this.lastSampleT = -Infinity;
    this.pinned = null; // relaxed ratio from an exhale-and-drop, preferred when set
    this.belowSince = null;
    this.firedAt = null;
  }

  /** Smoothed ratio, for the breath check and display. */
  get value() {
    return this.ema;
  }

  get reference() {
    if (this.pinned !== null) return this.pinned;
    if (this.samples.length < this.cfg.min_reference_s) return null;
    return quantile(
      this.samples.map(([, r]) => r),
      this.cfg.reference_quantile,
    );
  }

  /** The user just exhaled and dropped their shoulders: trust this ratio. */
  pinRelaxed(ratio) {
    if (ratio !== null && ratio > 0) {
      this.pinned = ratio;
      this.belowSince = null;
    }
  }

  reset() {
    this.ema = null;
    this.lastT = null;
    this.belowSince = null;
  }

  /** ratio: neckRatio() or null; good: posture state is GOOD.
   *  Returns true once when sustained bracing is detected. */
  update(ratio, now, good) {
    if (ratio === null) {
      this.belowSince = null;
      return false;
    }
    const dt = this.lastT === null ? 0 : Math.max(0, now - this.lastT);
    const alpha = this.ema === null ? 1 : 1 - Math.exp(-dt / this.cfg.smoothing_tau_s);
    this.ema = this.ema === null ? ratio : this.ema + alpha * (ratio - this.ema);
    this.lastT = now;
    if (!good) {
      this.belowSince = null;
      return false;
    }
    if (now - this.lastSampleT >= 1) {
      this.samples.push([now, this.ema]);
      this.lastSampleT = now;
      const cutoff = now - this.cfg.reference_window_s;
      while (this.samples.length && this.samples[0][0] < cutoff) this.samples.shift();
    }
    const ref = this.reference;
    if (ref === null || ref <= 0) return false;
    if (this.ema > ref * (1 - this.cfg.bracing_drop)) {
      this.belowSince = null;
      return false;
    }
    if (this.belowSince === null) this.belowSince = now;
    const cooled = this.firedAt === null || now - this.firedAt >= this.cfg.bracing_cooldown_s;
    if (now - this.belowSince >= this.cfg.bracing_sustain_s && cooled) {
      this.firedAt = now;
      this.belowSince = null;
      return true;
    }
    return false;
  }
}

/** Phases: before (2 s baseline already in the monitor) -> inhale (5 s) ->
 *  exhale (4 s, the last 3 s recorded as relaxed) -> done. */
const BREATH_PHASES = Object.freeze({ inhale_s: 5, exhale_s: 4, settle_record_s: 3 });

export class BreathCheck {
  constructor(cfg = RELAX) {
    this.cfg = cfg;
    this.phase = "idle";
  }

  get active() {
    return this.phase !== "idle";
  }

  /** base: the smoothed ratio just before the prompt. */
  start(now, base) {
    this.phase = "inhale";
    this.t0 = now;
    this.base = base;
    this.minInhale = Infinity;
    this.settle = [];
    this.result = null;
  }

  cancel() {
    this.phase = "idle";
  }

  /** Feed the smoothed ratio each frame. Returns "exhale" when it is time to
   *  say "breathe out", a result object when finished, else null. */
  update(ratio, now) {
    if (!this.active) return null;
    const t = now - this.t0;
    const { inhale_s, exhale_s, settle_record_s } = BREATH_PHASES;
    if (this.phase === "inhale") {
      if (ratio !== null) this.minInhale = Math.min(this.minInhale, ratio);
      if (t >= inhale_s) {
        this.phase = "exhale";
        return "exhale";
      }
      return null;
    }
    if (ratio !== null && t >= inhale_s + exhale_s - settle_record_s) this.settle.push(ratio);
    if (t < inhale_s + exhale_s) return null;
    this.phase = "idle";
    this.result = this.verdict();
    return this.result;
  }

  verdict() {
    const base = this.base;
    const relaxed = this.settle.length ? this.settle.reduce((a, b) => a + b, 0) / this.settle.length : null;
    if (base === null || base <= 0 || !Number.isFinite(this.minInhale) || relaxed === null) {
      return { kind: "unclear", relaxed };
    }
    const rise = (base - this.minInhale) / base; // shoulders up on the inhale
    const settle = (relaxed - base) / base; // shoulders lower after letting go
    if (rise >= this.cfg.breath_rise) return { kind: "rose", rise, settle, relaxed };
    if (settle >= this.cfg.breath_settle) return { kind: "held", rise, settle, relaxed };
    return { kind: "relaxed", rise, settle, relaxed };
  }
}
