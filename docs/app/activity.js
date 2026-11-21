// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// One explicit activity state machine. It replaces the scattered flags in app.js
// (paused, test, practice, breath.active, guide.active, card) with a single answer
// to "what is the user doing, and what may the app do right now?". While the user
// looks away for the 20-20-20 eye break (or stretches, or follows a breathing
// guide) there are no posture reminders, cues, praise or slouch tallies.
// Pure (no DOM, no clock): every call takes `now` in seconds. Tested in
// tests/js/activity.test.mjs. Design: .kiro/specs/activity-states/design.md.

import { DEFAULTS } from "./posture-core.js";

export const ACTIVITY = Object.freeze({
  TRACKING: "tracking",
  PAUSED: "paused",
  SILENT_TEST: "silent_test",
  PRACTICE: "practice",
  BREATH_CHECK: "breath_check",
  BREATHE_GUIDE: "breathe_guide",
  EYE_BREAK: "eye_break",
  DEMO: "demo",
});

// After a suppressing activity ends, reminders, cue and praise stay off for this
// long while scoring resumes, so nothing can appear the instant a break ends.
const GRACE_S = 10;

const REASONS = Object.freeze(["completed", "cancelled", "timeout", "left_frame", "mode"]);

const MODES = Object.freeze([ACTIVITY.PAUSED, ACTIVITY.SILENT_TEST, ACTIVITY.PRACTICE]); // highest priority first
const FOREGROUND = Object.freeze([ACTIVITY.BREATH_CHECK, ACTIVITY.BREATHE_GUIDE, ACTIVITY.EYE_BREAK, ACTIVITY.DEMO]);

const OFF = {
  frames: true,
  engine: "track",
  reminders: false,
  praise: false,
  speak: false,
  score: "none",
  prompts: false,
  setupCards: false,
  leaveCancels: false,
  label: "",
  graceAfter_s: 0,
};

function row(over) {
  return Object.freeze({ ...OFF, ...over });
}

const TABLE = Object.freeze({
  [ACTIVITY.TRACKING]: row({
    reminders: true,
    praise: true,
    speak: true,
    score: "day",
    prompts: true,
    setupCards: true,
  }),
  [ACTIVITY.PAUSED]: row({ frames: false, label: "Paused" }),
  [ACTIVITY.SILENT_TEST]: row({ score: "test", label: "Silent test" }),
  [ACTIVITY.PRACTICE]: row({ label: "Learn the cues" }),
  [ACTIVITY.BREATH_CHECK]: row({ speak: true, score: "day", label: "Breath check" }),
  [ACTIVITY.BREATHE_GUIDE]: row({
    engine: "hold",
    speak: true,
    label: "Breathing, posture paused",
    graceAfter_s: GRACE_S,
  }),
  [ACTIVITY.EYE_BREAK]: row({
    engine: "hold",
    speak: true,
    leaveCancels: true,
    label: "Eye break, posture paused",
    graceAfter_s: GRACE_S,
  }),
  [ACTIVITY.DEMO]: row({
    engine: "hold",
    speak: true,
    leaveCancels: true,
    label: "Stretch, posture paused",
    graceAfter_s: GRACE_S,
  }),
});

// Tracking again, scoring resumed, but nothing that reminds or praises yet.
const GRACE = row({ speak: true, score: "day", setupCards: true });

export class ActivityMachine {
  /** @param {{leave_s?: number, grace_s?: number}} [cfg] */
  constructor(cfg = {}) {
    this.leave_s = cfg.leave_s ?? DEFAULTS.state.no_person_timeout_s;
    this.grace_s = cfg.grace_s ?? GRACE_S;
    this.modes = new Set();
    this.fg = null;
    this.graceUntil = -Infinity;
    this.absentSince = null;
    /** How the most recent activity ended, for the UI and tests: { state, reason } or null. */
    this.lastEnd = null;
  }

  /** The state that governs right now: a mode, else the foreground activity, else TRACKING. */
  get current() {
    for (const m of MODES) if (this.modes.has(m)) return m;
    return this.fg ?? ACTIVITY.TRACKING;
  }

  /** True while `state` is running (a paused test is both PAUSED and SILENT_TEST). */
  isActive(state) {
    return this.modes.has(state) || this.fg === state;
  }

  /** @returns {boolean} whether the start was accepted */
  start(state, now) {
    if (MODES.includes(state)) return this.#startMode(state, now);
    if (!FOREGROUND.includes(state) || this.modes.size > 0) return false;
    const fg = this.fg;
    if (fg === state) return false;
    const replaceable = state === ACTIVITY.EYE_BREAK || state === ACTIVITY.DEMO;
    if (fg === ACTIVITY.EYE_BREAK || fg === ACTIVITY.DEMO) {
      if (!replaceable) return false;
    } else if (fg === ACTIVITY.BREATHE_GUIDE && state === ACTIVITY.BREATH_CHECK) {
      // the guide hands off to the breath check
    } else if (fg !== null) {
      return false;
    }
    if (fg !== null) this.#end(fg, now, "mode", false);
    this.fg = state;
    this.absentSince = null;
    return true;
  }

  /** @returns {boolean} whether `state` was running */
  stop(state, now, reason = "completed") {
    if (!REASONS.includes(reason)) throw new TypeError(`unknown stop reason: ${reason}`);
    if (!this.isActive(state)) return false;
    this.#end(state, now, reason, true);
    return true;
  }

  /** Feed one presence sample. Returns true once when an eye break or demo ends because the user left the frame. */
  observePresence(present, now) {
    if (present) {
      this.absentSince = null;
      return false;
    }
    if (this.absentSince === null) this.absentSince = now;
    const fg = this.fg;
    if (!fg || this.modes.size > 0 || !TABLE[fg].leaveCancels) return false;
    if (now - this.absentSince < this.leave_s) return false;
    this.#end(fg, now, "left_frame", true);
    return true;
  }

  /** Whether the post-activity grace phase is running (only while tracking). */
  inGrace(now) {
    return this.current === ACTIVITY.TRACKING && now < this.graceUntil;
  }

  /** The merged policy for `now`: a frozen object with every field of the policy table. */
  policy(now) {
    const cur = this.current;
    if (cur === ACTIVITY.TRACKING && now < this.graceUntil) return GRACE;
    return TABLE[cur];
  }

  /** Gentle UI text for the current state, "" when there is nothing to say. */
  label(now) {
    return this.policy(now).label;
  }

  #startMode(state, now) {
    if (this.modes.has(state)) return false;
    // A pause can interrupt a test or practice, but a test and practice exclude each other
    // and neither can begin while paused.
    if (state !== ACTIVITY.PAUSED) {
      if (this.modes.has(ACTIVITY.PAUSED)) return false;
      if (this.modes.has(ACTIVITY.SILENT_TEST) || this.modes.has(ACTIVITY.PRACTICE)) return false;
    }
    if (this.fg !== null) this.#end(this.fg, now, "mode", true);
    this.modes.add(state);
    this.absentSince = null;
    return true;
  }

  #end(state, now, reason, withGrace) {
    if (this.modes.has(state)) {
      this.modes.delete(state);
    } else {
      this.fg = null;
    }
    this.absentSince = null;
    this.lastEnd = { state, reason };
    const g = TABLE[state].graceAfter_s ? this.grace_s : 0;
    if (withGrace && g > 0) this.graceUntil = now + g;
  }
}
