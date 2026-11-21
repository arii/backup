// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Staged reveal of panels and settings (spec: progressive-loading, requirement 4).
// Pure: no DOM, time comes from the caller. The app passes the prompt clock, which
// already stops while paused, in a silent test or in practice and which `?clockScale`
// speeds up, so the reveal timers follow the prompt timers.

/** Stage numbers. Higher stages show more panels; a stage never goes back down. */
export const STAGES = Object.freeze({
  idle: 0, // before tracking: stage, Start buttons, walkthrough, Help
  tracking: 1, // first scored frame: "This session"
  settled: 2, // posture is good or slouch for settle_s: needle, tiles
  configured: 3, // config_s of tracking: reminders and calibration
  comfortable: 4, // comfortable_s of tracking (the prompt quiet period): breaks, relax, test
  returning: 5, // everything: a later session, or "Show all settings"
});

export const REVEAL = Object.freeze({
  settle_s: 10, // seconds of scored good or slouch frames before stage 2
  gap_s: 3, // unscored time that restarts the settle hold (not the stage)
  config_s: 120, // tracked seconds before stage 3
  comfortable_s: 300, // tracked seconds before stage 4
});

export class RevealStages {
  /**
   * @param {{returning?: boolean, seasoned?: boolean, revealAll?: boolean, cfg?: object}} [opts]
   *   returning: this user finished a first run before, so settle jumps to stage 4.
   *   seasoned: returning and at least two earlier sessions, so settle jumps to stage 5.
   */
  constructor({ returning = false, seasoned = false, revealAll = false, cfg = REVEAL } = {}) {
    this.cfg = cfg;
    this.returning = returning;
    this.seasoned = seasoned;
    this.stage = revealAll ? STAGES.returning : STAGES.idle;
    this.tracked = 0; // seconds of running tracking since the first scored frame
    this.settled = false;
    this._holdStart = null;
    this._lastOk = null;
    this._missed = false;
    this._lastT = null;
    this._suspendedAt = null;
    this._skew = 0;
  }

  /**
   * frame: { scored, present, paused, silentTest, practice }. present means a scored
   * frame with a person (not the NO_PERSON start state). now: seconds, monotonic.
   * Returns { stage, changed }.
   */
  update(frame, now) {
    const before = this.stage;
    if (frame.paused || frame.silentTest || frame.practice) {
      if (this._suspendedAt === null) this._suspendedAt = now;
      return { stage: this.stage, changed: false };
    }
    if (this._suspendedAt !== null) {
      this._skew += now - this._suspendedAt; // time spent suspended counts for nothing
      this._suspendedAt = null;
    }
    const t = now - this._skew;
    const dt = this._lastT === null ? 0 : Math.max(0, t - this._lastT);
    this._lastT = t;
    if (this.stage >= STAGES.tracking || frame.scored) this.tracked += dt;
    if (frame.scored && this.stage < STAGES.tracking) this.stage = STAGES.tracking;
    if (!this.settled) this._hold(frame, t);
    if (this.settled) this.stage = Math.max(this.stage, this._target());
    return { stage: this.stage, changed: this.stage !== before };
  }

  /** "Show all settings": everything, now. */
  forceAll() {
    const changed = this.stage !== STAGES.returning;
    this.stage = STAGES.returning;
    return { stage: this.stage, changed };
  }

  _hold(frame, now) {
    if (frame.scored && frame.present) {
      // A long gap only counts when frames in between were not good or slouch.
      // Back-to-back good frames never reset, even when a scaled clock makes dt large.
      const stale = this._missed && now - this._lastOk > this.cfg.gap_s;
      if (this._holdStart === null || stale) this._holdStart = now;
      this._lastOk = now;
      this._missed = false;
      if (now - this._holdStart >= this.cfg.settle_s) this.settled = true;
    } else {
      this._missed = true;
      if (this._lastOk !== null && now - this._lastOk > this.cfg.gap_s) this._holdStart = null;
    }
  }

  _target() {
    if (this.seasoned) return STAGES.returning;
    let t = STAGES.settled;
    if (this.tracked >= this.cfg.comfortable_s) t = STAGES.comfortable;
    else if (this.tracked >= this.cfg.config_s) t = STAGES.configured;
    return this.returning ? Math.max(t, STAGES.comfortable) : t;
  }
}
