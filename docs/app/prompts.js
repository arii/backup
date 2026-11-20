// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// One scheduler for every prompt that is not a posture reminder, so the app
// cannot nag: prompts never stack, never interrupt a reminder, and never show
// during a silent test, a pause or a breath check. Pure (no DOM, no clock of
// its own): every call takes `now` in seconds, tested in tests/js/prompts.test.mjs.
//
// Priority: posture reminder > breath check > break > breathing message > share/sponsor.
// Global rule: none in the first 5 minutes of a session, then at most one
// non-posture prompt every 10 minutes. Each prompt also has its own cooldown.

export const PRIORITY = Object.freeze(["posture", "breath", "break", "breathing", "share"]);

export const PROMPTS = Object.freeze({
  first_quiet_s: 300,    // nothing in the first 5 minutes of a session
  global_gap_s: 600,     // then at most one non-posture prompt per 10 minutes
  snooze_s: 600,         // "Snooze 10 min" and "Not now" both wait this long
  posture_hold_s: 10,    // a posture reminder owns the screen for this long
  queue_ttl_s: 120,      // a queued prompt nobody could show for 2 min is stale
});

/** id -> { type, cooldown_s }. The id is also the key for enabled/dismissed flags. */
export const PROMPT_DEFS = Object.freeze({
  breath: { type: "breath", cooldown_s: 1200 },
  eye: { type: "break", cooldown_s: 600 },
  move: { type: "break", cooldown_s: 600 },
  breathing: { type: "breathing", cooldown_s: 1800 }, // breathing moments: at most every 30 min
  offer: { type: "breathing", cooldown_s: 600 },      // "Breathe with me" after a shoulder-creep reminder
  share: { type: "share", cooldown_s: 3600 },
});

export class PromptScheduler {
  /** @param {{isEnabled?: (id: string) => boolean, cfg?: object}} opts
   *  isEnabled: the per-prompt on/off setting and "don't show again" flag. */
  constructor({ isEnabled = () => true, cfg = PROMPTS } = {}) {
    this.cfg = cfg;
    this.isEnabled = isEnabled;
    this.queue = [];
    this.active = null;       // { id, type, payload, at } while a prompt is on screen
    this.sessionStart = null;
    this.lastNonPosture = null;
    this.postureUntil = -Infinity;
    this.lastShown = {};      // id -> time
    this.snoozedUntil = {};   // id -> time
  }

  startSession(now) {
    this.sessionStart = now;
    this.queue = [];
    this.active = null;
  }

  /** A posture reminder is on screen: every other prompt waits. */
  notePosture(now) { this.postureUntil = now + this.cfg.posture_hold_s; }

  /** Ask to show prompt `id`. Re-enqueueing replaces the earlier request. */
  enqueue(id, now, payload = null) {
    const def = PROMPT_DEFS[id];
    if (!def || !this.isEnabled(id)) return false;
    const prev = this.queue.find((q) => q.id === id);
    const queuedAt = prev && now - prev.queuedAt <= this.cfg.queue_ttl_s ? prev.queuedAt : now;
    const item = { id, type: def.type, payload, queuedAt };
    this.queue = this.queue.filter((q) => q.id !== id);
    this.queue.push(item);
    return true;
  }

  /** ctx: { paused, test, breathCheck }, any truthy value suppresses.
   *  Returns the prompt to show now (and marks it active), or null. */
  poll(now, ctx = {}) {
    if (this.sessionStart === null) this.sessionStart = now;
    this.queue = this.queue.filter((q) => now - q.queuedAt <= this.cfg.queue_ttl_s && this.isEnabled(q.id));
    if (this.active) return null; // never two at once
    if (ctx.paused || ctx.test || ctx.breathCheck) return null;
    if (now < this.postureUntil) return null;
    if (now - this.sessionStart < this.cfg.first_quiet_s) return null;
    if (this.lastNonPosture !== null && now - this.lastNonPosture < this.cfg.global_gap_s) return null;
    // Priority first; within a type the prompt shown longest ago goes first, so one cannot starve another.
    const shownAt = (q) => this.lastShown[q.id] ?? -Infinity;
    const ordered = this.queue.slice().sort((a, b) =>
      PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type) || shownAt(a) - shownAt(b));
    for (const item of ordered) {
      const last = this.lastShown[item.id];
      if (last !== undefined && now - last < PROMPT_DEFS[item.id].cooldown_s) continue;
      if ((this.snoozedUntil[item.id] ?? -Infinity) > now) continue;
      this.queue = this.queue.filter((q) => q !== item);
      this.lastShown[item.id] = now;
      this.lastNonPosture = now;
      this.active = { id: item.id, type: item.type, payload: item.payload, at: now };
      return this.active;
    }
    return null;
  }

  /** The active prompt is gone. how: "done" | "snooze" | "notnow" | "never".
   *  Snooze and Not now (which is also what ignoring a prompt counts as) keep
   *  it away for snooze_s. "never" is for the caller to persist as a flag.
   *  Returns the id that was active, or null. */
  dismiss(now, how = "done") {
    const a = this.active;
    this.active = null;
    if (!a) return null;
    if (how === "snooze" || how === "notnow") this.snoozedUntil[a.id] = now + this.cfg.snooze_s;
    return a.id;
  }
}
