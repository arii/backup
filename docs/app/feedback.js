// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Feedback policy: decides WHETHER a feedback action is allowed. app.js still
// plays the sounds and shows the banners. Pure, with injected time, so it is
// unit-tested in tests/js/feedback.test.mjs. Rules come from
// docs/research/feedback-and-habit-formation.md and .kiro/specs/feedback-design:
//
// - Standard: every reminder the engine emits, voice as the engine says.
// - Light: lower-intensity feedback (guidance hypothesis), not fewer
//   reminders. The first reminder of an episode is chime and banner only; voice
//   joins only when the previous episode ended recently. No timed praise.
//   Recovery and milestone praise stay.
// - An hourly cap on reminders limits alarm fatigue.
// - Milestone praise for effort: 5, 15, 30, 60 continuous good minutes, once
//   per streak. Absence (a gap in good samples) is not a streak.

export const FEEDBACK = Object.freeze({
  max_reminders_per_hour: 30,
  light_episode_window_s: 600,
  milestones_min: [5, 15, 30, 60],
  streak_gap_s: 5, // a longer gap between good samples ends the streak
});

const LEVELS = Object.freeze(["standard", "light"]);
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
    if (episodeId !== this.episodeId) {
      // a new slouch episode begins
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

  onBad() {
    this.endStreak();
  }

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

// Suggest Light after repeated dismissals or mutes (requirement 7.4). Each
// explicit "Snooze", "Not now", "Don't show this again" or switch to a quieter
// reminder style is one annoyance event. A suggestion is only a suggestion:
// the person picks, and "Not now" keeps it away for two weeks.
export const LIGHT_SUGGEST = Object.freeze({
  count: 5, // this many events...
  window_s: 7 * 86400, // ...within a week
  keep: 20, // events kept in the store
  decline_s: 14 * 86400, // a declined suggestion stays away this long
});

/** Add an event at `nowMs`. Returns a new list: recent events only, newest last, capped. */
export function recordAnnoyance(log, nowMs, cfg = LIGHT_SUGGEST) {
  const old = Array.isArray(log) ? log : [];
  const kept = old.filter((t) => Number.isFinite(t) && nowMs - t < cfg.window_s * 1000 && t <= nowMs);
  return [...kept, nowMs].slice(-cfg.keep);
}

/** True when the Light suggestion should be offered now. */
export function shouldSuggestLight({ level, log, declinedAtMs = null, nowMs }, cfg = LIGHT_SUGGEST) {
  if (normalizeLevel(level) === "light") return false;
  if (Number.isFinite(declinedAtMs) && nowMs - declinedAtMs < cfg.decline_s * 1000) return false;
  const recent = (Array.isArray(log) ? log : []).filter((t) => Number.isFinite(t) && nowMs - t < cfg.window_s * 1000);
  return recent.length >= cfg.count;
}

const REMINDER_TAB_PREFIX = "\u26a0 Sit up \u00b7 ";

/** Tab title for the badge class: warning prefix only while a reminder is active. */
export function tabTitleFor(badgeClass, baseTitle) {
  const active = /\bbad_(chime|voice)\b/.test(String(badgeClass || ""));
  return active ? REMINDER_TAB_PREFIX + baseTitle : baseTitle;
}
