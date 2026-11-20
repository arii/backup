// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// Feedback policy: decides WHETHER a feedback action is allowed. app.js still
// plays the sounds and shows the banners. Pure, with injected time, so it is
// unit-tested in tests/js/feedback.test.mjs. Rules come from
// docs/research/feedback-and-habit-formation.md and .kiro/specs/feedback-design:
//
// - Standard: every reminder the engine emits, voice as the engine says.
// - Light: reduced-frequency feedback (guidance hypothesis). The first
//   reminder of an episode is chime and banner only; voice joins only when the
//   previous episode ended recently (a second consecutive episode). No timed
//   praise. Recovery and milestone praise stay.
// - An hourly cap on reminders limits alarm fatigue.
// - Milestone praise for effort: 5, 15, 30, 60 continuous good minutes, once
//   per streak. Absence (a gap in good samples) is not a streak.

export const FEEDBACK = Object.freeze({
  max_reminders_per_hour: 30,
  light_episode_window_s: 600,
  milestones_min: [5, 15, 30, 60],
  streak_gap_s: 5, // a longer gap between good samples ends the streak
});

export const LEVELS = Object.freeze(["standard", "light"]);
export const normalizeLevel = (v) => (LEVELS.includes(v) ? v : "standard");

export const MILESTONE_TEXT = Object.freeze({
  5: "5 minutes of steady posture",
  15: "15 minutes of steady posture",
  30: "30 minutes of steady posture. Remember to move soon.",
  60: "An hour of steady posture. Stand up and move for a minute.",
});

export class FeedbackPolicy {
  constructor(level = "standard", cfg = FEEDBACK) {
    this.cfg = cfg;
    this.level = normalizeLevel(level);
    this.reset();
  }

  setLevel(level) { this.level = normalizeLevel(level); }

  reset() {
    this.granted = []; // times of granted reminders, for the hourly cap
    this.episodeId = null;
    this.lastReminderT = null;
    this.prevEpisodeEnd = null; // last reminder time of the episode before the current one
    this.goodS = 0;
    this.lastGoodT = null;
    this.fired = new Set();
  }

  /** @returns {{allow: boolean, voice: boolean, capped: boolean}} voice is whether a spoken reminder is allowed. */
  onReminder(now, { episodeId = 0, voice = true } = {}) {
    this.granted = this.granted.filter((t) => now - t < 3600);
    if (this.granted.length >= this.cfg.max_reminders_per_hour) {
      return { allow: false, voice: false, capped: true };
    }
    if (episodeId !== this.episodeId) { // a new slouch episode begins
      this.prevEpisodeEnd = this.lastReminderT;
      this.episodeId = episodeId;
    }
    this.granted.push(now);
    this.lastReminderT = now;
    let say = voice;
    if (this.level === "light") {
      const recent = this.prevEpisodeEnd !== null && now - this.prevEpisodeEnd < this.cfg.light_episode_window_s;
      say = voice && recent;
    }
    return { allow: true, voice: say, capped: false };
  }

  /** True when the hourly cap is currently reached. */
  isCapped(now) {
    return this.granted.filter((t) => now - t < 3600).length >= this.cfg.max_reminders_per_hour;
  }

  /** Good time accrues. Returns a milestone minute once per streak, else null. */
  onGood(now, dt = 0) {
    if (this.lastGoodT !== null && now - this.lastGoodT > this.cfg.streak_gap_s) this.endStreak();
    this.lastGoodT = now;
    this.goodS += Math.max(0, dt);
    for (const m of this.cfg.milestones_min) {
      if (this.goodS >= m * 60 && !this.fired.has(m)) {
        this.fired.add(m);
        return m;
      }
    }
    return null;
  }

  onBad() { this.endStreak(); }

  endStreak() {
    this.goodS = 0;
    this.fired = new Set();
    this.lastGoodT = null;
  }

  /** @param {"timed"|"recovery"|"milestone"} kind */
  onPraise(kind) {
    if (this.level === "light") return kind !== "timed";
    return true;
  }
}
