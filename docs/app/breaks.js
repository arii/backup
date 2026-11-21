// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Screen-time breaks from what the webcam already knows: is someone at the
// desk (any state except NO_PERSON). Counts continuous seated time, says when
// an eye break (20-20-20) or a move break is due, and treats 2+ minutes away
// as a break taken. Pure (no DOM); tests/js/breaks.test.mjs. Breaks never
// touch the posture score.

export const BREAKS = Object.freeze({
  eye_after_s: 20 * 60, // 20-20-20: every 20 min of continuous presence...
  eye_look_s: 20, // ...look 20 feet away for 20 seconds
  away_reset_s: 120, // leaving the frame for 2 min counts as a break
  move_default_min: 60,
});

/** Settings choices for the move break; 0 = off. */
export const MOVE_BREAK_OPTIONS = Object.freeze([0, 30, 45, 60, 90]);

export function normalizeMoveMinutes(v) {
  const n = Number(v);
  return MOVE_BREAK_OPTIONS.includes(n) ? n : BREAKS.move_default_min;
}

/** Stretch and water reminders: same choices as the move break, but off unless chosen. */
export function normalizeReminderMinutes(v) {
  const n = Number(v);
  return MOVE_BREAK_OPTIONS.includes(n) ? n : 0;
}

export class BreakTracker {
  constructor({
    eyeBreaks = true,
    moveBreakMinutes = BREAKS.move_default_min,
    stretchMinutes = 0,
    waterMinutes = 0,
    cfg = BREAKS,
  } = {}) {
    this.cfg = cfg;
    this.eyeBreaks = eyeBreaks;
    this.moveMinutes = normalizeMoveMinutes(moveBreakMinutes);
    this.stretchMinutes = normalizeReminderMinutes(stretchMinutes);
    this.waterMinutes = normalizeReminderMinutes(waterMinutes);
    this.reset();
  }

  reset() {
    this.seated = 0; // continuous seated seconds
    this.eyeBase = 0; // seated time when the last eye break was taken or reset
    this.moveBase = 0;
    this.stretchBase = 0;
    this.waterBase = 0;
    this.away = 0; // seconds away in the current absence
    this.awayCounted = false;
    this.lastT = null;
  }

  setMoveMinutes(v) {
    this.moveMinutes = normalizeMoveMinutes(v);
  }
  setStretchMinutes(v) {
    this.stretchMinutes = normalizeReminderMinutes(v);
  }
  setWaterMinutes(v) {
    this.waterMinutes = normalizeReminderMinutes(v);
  }
  setEyeBreaks(on) {
    this.eyeBreaks = !!on;
  }

  /** present: someone is in view. now: seconds on a clock the caller keeps
   *  bounded (no huge jumps). Returns true once when an absence turns into a
   *  break taken (2+ min away). */
  update(present, now) {
    const dt = this.lastT === null ? 0 : Math.max(0, now - this.lastT);
    this.lastT = now;
    if (present) {
      this.away = 0;
      this.awayCounted = false;
      this.seated += dt;
      return false;
    }
    this.away += dt;
    if (!this.awayCounted && this.away >= this.cfg.away_reset_s) {
      this.awayCounted = true;
      this.seated = this.eyeBase = this.moveBase = this.stretchBase = this.waterBase = 0;
      return true;
    }
    return false;
  }

  /** Break kinds due right now ("eye", "move", "stretch", "water"). Nothing while away. */
  due(present = true) {
    if (!present || this.away > 0) return [];
    const out = [];
    if (this.eyeBreaks && this.seated - this.eyeBase >= this.cfg.eye_after_s) out.push("eye");
    if (this.moveMinutes > 0 && this.seated - this.moveBase >= this.moveMinutes * 60) out.push("move");
    if (this.stretchMinutes > 0 && this.seated - this.stretchBase >= this.stretchMinutes * 60) out.push("stretch");
    if (this.waterMinutes > 0 && this.seated - this.waterBase >= this.waterMinutes * 60) out.push("water");
    return out;
  }

  /** The user took the break (finished the countdown or pressed Done). */
  taken(kind) {
    if (kind === "eye") this.eyeBase = this.seated;
    if (kind === "move") this.moveBase = this.seated;
    if (kind === "stretch") this.stretchBase = this.seated;
    if (kind === "water") this.waterBase = this.seated;
  }
}
