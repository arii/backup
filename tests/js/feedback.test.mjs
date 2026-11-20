// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// feedback.js: coaching level, hourly cap and milestone praise.

import assert from "node:assert/strict";
import test from "node:test";
import { FEEDBACK, FeedbackPolicy, MILESTONE_TEXT, normalizeLevel } from "../../docs/app/feedback.js";

/** Replay slouch episodes: each is a chime then a voice reminder 10 s later, `gap` s apart. */
function replay(level, episodes, gap = 120) {
  const p = new FeedbackPolicy(level);
  const out = { reminders: 0, voices: 0 };
  for (let e = 0; e < episodes; e++) {
    const t = e * gap;
    for (const [dt, wantVoice] of [[0, false], [10, true]]) {
      const r = p.onReminder(t + dt, { episodeId: e + 1, voice: wantVoice });
      if (r.allow) out.reminders += 1;
      if (r.allow && r.voice) out.voices += 1;
    }
  }
  return out;
}

test("level defaults to standard and rejects unknown values", () => {
  assert.equal(new FeedbackPolicy().level, "standard");
  assert.equal(normalizeLevel("loud"), "standard");
  assert.equal(normalizeLevel(undefined), "standard");
  assert.equal(normalizeLevel("light"), "light");
});

test("standard allows every reminder and voice the engine asks for", () => {
  assert.deepEqual(replay("standard", 4), { reminders: 8, voices: 4 });
});

test("light never produces more reminders, voice lines or praise than standard", () => {
  for (const episodes of [1, 2, 3, 6, 12]) {
    for (const gap of [30, 120, 900]) {
      const s = replay("standard", episodes, gap), l = replay("light", episodes, gap);
      assert.ok(l.reminders <= s.reminders, `reminders ${episodes}/${gap}`);
      assert.ok(l.voices <= s.voices, `voices ${episodes}/${gap}`);
    }
  }
  for (const kind of ["timed", "recovery", "milestone"]) {
    const std = new FeedbackPolicy("standard").onPraise(kind);
    const lt = new FeedbackPolicy("light").onPraise(kind);
    assert.ok(Number(lt) <= Number(std), kind);
  }
});

test("light drops voice on the first episode, allows it on a close second, not on a distant one", () => {
  const p = new FeedbackPolicy("light");
  assert.equal(p.onReminder(0, { episodeId: 1, voice: false }).voice, false);
  assert.equal(p.onReminder(10, { episodeId: 1, voice: true }).voice, false);
  assert.equal(p.onReminder(100, { episodeId: 2, voice: true }).voice, true);
  const far = new FeedbackPolicy("light");
  far.onReminder(0, { episodeId: 1, voice: true });
  assert.equal(far.onReminder(FEEDBACK.light_episode_window_s + 100, { episodeId: 2, voice: true }).voice, false);
});

test("light keeps recovery and milestone praise but drops timed praise", () => {
  const p = new FeedbackPolicy("light");
  assert.equal(p.onPraise("timed"), false);
  assert.equal(p.onPraise("recovery"), true);
  assert.equal(p.onPraise("milestone"), true);
  assert.equal(new FeedbackPolicy("standard").onPraise("timed"), true);
});

test("the hourly cap is enforced, flagged as capped, and slides", () => {
  const p = new FeedbackPolicy("standard", { ...FEEDBACK, max_reminders_per_hour: 5 });
  const results = Array.from({ length: 8 }, (_, i) => p.onReminder(i * 60, { episodeId: i }));
  assert.equal(results.filter((r) => r.allow).length, 5);
  assert.ok(results.slice(5).every((r) => r.capped && !r.allow && !r.voice));
  assert.equal(p.isCapped(8 * 60), true);
  assert.equal(p.isCapped(3600 + 5), false, "the oldest grants have aged out");
  assert.equal(p.onReminder(3600 + 5, { episodeId: 9 }).allow, true);
});

test("the default cap is high enough that a normal demo never hits it", () => {
  const p = new FeedbackPolicy();
  const allowed = Array.from({ length: 20 }, (_, i) => p.onReminder(i * 30, { episodeId: i }).allow);
  assert.ok(allowed.every(Boolean));
});

/** Accrue `seconds` of good time at 1 s steps from t0. Returns fired milestones. */
function accrue(p, t0, seconds) {
  const fired = [];
  for (let i = 1; i <= seconds; i++) {
    const m = p.onGood(t0 + i, 1);
    if (m !== null) fired.push(m);
  }
  return fired;
}

test("each milestone fires exactly once per continuous good streak, in order", () => {
  const p = new FeedbackPolicy();
  assert.deepEqual(accrue(p, 0, 61 * 60), [5, 15, 30, 60]);
  assert.deepEqual(accrue(p, 61 * 60, 10 * 60), [], "nothing repeats in the same streak");
  assert.ok(MILESTONE_TEXT[5] && MILESTONE_TEXT[60]);
});

test("bad posture restarts the ladder", () => {
  const p = new FeedbackPolicy();
  assert.deepEqual(accrue(p, 0, 6 * 60), [5]);
  p.onBad();
  assert.deepEqual(accrue(p, 400, 4 * 60), [], "4 minutes is not 5");
  assert.deepEqual(accrue(p, 640, 2 * 60), [5]);
});

test("absence is not a streak: a gap above 5 s resets the count", () => {
  const p = new FeedbackPolicy();
  assert.deepEqual(accrue(p, 0, 4 * 60), []);
  assert.deepEqual(accrue(p, 4 * 60 + 30, 4 * 60), [], "4 + 4 minutes with a gap between is not 5");
  assert.deepEqual(accrue(p, 4 * 60 + 30 + 4 * 60, 90), [5], "the streak after the gap reaches 5 on its own");
});
