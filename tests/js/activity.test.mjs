// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// activity.js: one state machine decides what the app may do during a break.

import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVITY, ActivityMachine, OwedReminder } from "../../docs/app/activity.js";

const A = ACTIVITY;
const FIELDS = [
  "frames",
  "engine",
  "reminders",
  "praise",
  "speak",
  "score",
  "prompts",
  "setupCards",
  "leaveCancels",
  "label",
  "graceAfter_s",
];
const SUPPRESSING = [A.EYE_BREAK, A.DEMO, A.BREATHE_GUIDE];

test("starts in TRACKING with everything on", () => {
  const m = new ActivityMachine();
  assert.equal(m.current, A.TRACKING);
  const p = m.policy(0);
  assert.equal(p.reminders, true);
  assert.equal(p.praise, true);
  assert.equal(p.score, "day");
  assert.equal(p.engine, "track");
  assert.equal(m.label(0), "");
});

test("every state defines every policy field and the tables are frozen", () => {
  for (const state of Object.values(A)) {
    const m = new ActivityMachine();
    if (state !== A.TRACKING) assert.equal(m.start(state, 0), true, state);
    const p = m.policy(0);
    assert.ok(Object.isFrozen(p), state);
    assert.deepEqual(Object.keys(p).sort(), [...FIELDS].sort(), state);
    for (const f of FIELDS) assert.notEqual(p[f], undefined, `${state}.${f}`);
  }
});

test("eye break stops cues, reminders, praise and slouch tallies but keeps its own speech", () => {
  const m = new ActivityMachine();
  assert.equal(m.start(A.EYE_BREAK, 10), true);
  const p = m.policy(11);
  assert.equal(p.reminders, false);
  assert.equal(p.praise, false);
  assert.equal(p.score, "none");
  assert.equal(p.engine, "hold");
  assert.equal(p.prompts, false);
  assert.equal(p.speak, true);
  assert.equal(p.leaveCancels, true);
  assert.equal(m.label(11), "Eye break, posture paused");
});

test("demo and guide labels", () => {
  const m = new ActivityMachine();
  m.start(A.DEMO, 0);
  assert.equal(m.label(1), "Break, posture paused");
  m.stop(A.DEMO, 2, "cancelled");
  m.start(A.BREATHE_GUIDE, 20);
  assert.equal(m.label(21), "Breathing, posture paused");
});

test("paused turns off frames; silent test counts to the test; practice scores nothing", () => {
  const m = new ActivityMachine();
  m.start(A.PAUSED, 0);
  assert.equal(m.policy(0).frames, false);
  assert.equal(m.policy(0).speak, false);
  m.stop(A.PAUSED, 1);
  m.start(A.SILENT_TEST, 2);
  assert.equal(m.policy(2).score, "test");
  assert.equal(m.policy(2).reminders, false);
  assert.equal(m.policy(2).speak, false);
  m.stop(A.SILENT_TEST, 3);
  m.start(A.PRACTICE, 4);
  assert.equal(m.policy(4).score, "none");
  assert.equal(m.policy(4).engine, "track");
  assert.equal(m.policy(4).speak, false);
});

test("breath check keeps today's scoring but no reminders or praise, and no grace", () => {
  const m = new ActivityMachine();
  m.start(A.BREATH_CHECK, 0);
  assert.equal(m.policy(1).reminders, false);
  assert.equal(m.policy(1).praise, false);
  assert.equal(m.policy(1).score, "day");
  m.stop(A.BREATH_CHECK, 30, "completed");
  assert.equal(m.inGrace(31), false);
  assert.equal(m.policy(31).reminders, true);
});

test("getting started tracks and shows its card, but never reminds, praises or prompts, and has no grace", () => {
  const m = new ActivityMachine();
  assert.equal(m.start(A.SETUP, 0), true);
  const p = m.policy(0);
  assert.equal(p.engine, "track", "the gauge and Save my posture need live scoring");
  assert.equal(p.setupCards, true);
  for (const f of ["reminders", "praise", "prompts", "speak"]) assert.equal(p[f], false, f);
  assert.equal(p.score, "none", "setup time is not coached time");
  assert.equal(m.start(A.EYE_BREAK, 1), false, "no break starts on top of getting started");
  const s = new ActivityMachine();
  s.start(A.SETUP, 0);
  assert.equal(s.start(A.PAUSED, 1), true, "a pause still wins and ends it (app.js reopens the card after)");
  assert.equal(s.isActive(A.SETUP), false);
  s.stop(A.PAUSED, 2);
  assert.equal(s.inGrace(2), false, "no grace after getting started");
  const done = new ActivityMachine();
  done.start(A.SETUP, 0);
  done.stop(A.SETUP, 3, "completed");
  assert.equal(done.policy(3).reminders, true, "coaching starts as soon as setup ends");
});

test("TRACKING cannot be started and unknown states are refused", () => {
  const m = new ActivityMachine();
  assert.equal(m.start(A.TRACKING, 0), false);
  assert.equal(m.start("nope", 0), false);
});

test("foreground activities are mutually exclusive, with today's exceptions", () => {
  const m = new ActivityMachine();
  assert.equal(m.start(A.BREATH_CHECK, 0), true);
  assert.equal(m.start(A.EYE_BREAK, 1), false);
  assert.equal(m.start(A.BREATHE_GUIDE, 1), false);
  assert.equal(m.start(A.DEMO, 1), false);
  assert.equal(m.start(A.BREATH_CHECK, 1), false);
  m.stop(A.BREATH_CHECK, 2);

  assert.equal(m.start(A.EYE_BREAK, 3), true);
  assert.equal(m.start(A.BREATH_CHECK, 4), false);
  assert.equal(m.start(A.BREATHE_GUIDE, 4), false);
  assert.equal(m.start(A.EYE_BREAK, 4), false);
  assert.equal(m.start(A.DEMO, 4), true, "a demo replaces an open eye card");
  assert.equal(m.current, A.DEMO);
  assert.equal(m.start(A.EYE_BREAK, 5), true, "an eye break replaces an open demo");
  m.stop(A.EYE_BREAK, 6);

  assert.equal(m.start(A.BREATHE_GUIDE, 7), true);
  assert.equal(m.start(A.EYE_BREAK, 8), false);
  assert.equal(m.start(A.BREATH_CHECK, 9), true, "the guide hands off to the breath check");
  assert.equal(m.current, A.BREATH_CHECK);
  assert.equal(m.inGrace(10), false, "a hand-off is not an end");
});

test("replacing one activity with another starts no grace between them", () => {
  const m = new ActivityMachine();
  m.start(A.EYE_BREAK, 0);
  m.start(A.DEMO, 5);
  assert.equal(m.current, A.DEMO);
  assert.equal(m.policy(6).reminders, false);
  m.stop(A.DEMO, 20, "completed");
  assert.equal(m.inGrace(21), true);
});

test("modes block starting a foreground activity and a pause cancels the running one", () => {
  const m = new ActivityMachine();
  m.start(A.PRACTICE, 0);
  for (const s of FOREGROUND_ALL()) assert.equal(m.start(s, 1), false, s);
  m.stop(A.PRACTICE, 2);

  m.start(A.EYE_BREAK, 3);
  assert.equal(m.start(A.PAUSED, 4), true);
  assert.equal(m.current, A.PAUSED);
  assert.deepEqual(m.lastEnd, { state: A.EYE_BREAK, reason: "mode" });
  assert.equal(m.isActive(A.EYE_BREAK), false);
  assert.equal(m.start(A.DEMO, 5), false);
});

function FOREGROUND_ALL() {
  return [A.BREATH_CHECK, A.BREATHE_GUIDE, A.EYE_BREAK, A.DEMO];
}

test("pause can be pressed during a silent test and the test resumes after", () => {
  const m = new ActivityMachine();
  assert.equal(m.start(A.SILENT_TEST, 0), true);
  assert.equal(m.start(A.PAUSED, 1), true);
  assert.equal(m.current, A.PAUSED);
  assert.equal(m.policy(1).frames, false);
  assert.equal(m.isActive(A.SILENT_TEST), true);
  assert.equal(m.stop(A.PAUSED, 2), true);
  assert.equal(m.current, A.SILENT_TEST);
  assert.equal(m.policy(2).score, "test");
});

test("test and practice exclude each other and neither starts while paused", () => {
  const m = new ActivityMachine();
  m.start(A.SILENT_TEST, 0);
  assert.equal(m.start(A.PRACTICE, 1), false);
  assert.equal(m.start(A.SILENT_TEST, 1), false);
  m.stop(A.SILENT_TEST, 2);
  m.start(A.PAUSED, 3);
  assert.equal(m.start(A.SILENT_TEST, 4), false);
  assert.equal(m.start(A.PRACTICE, 4), false);
  assert.equal(m.start(A.PAUSED, 4), false);
});

test("stop returns false for an activity that is not running and rejects unknown reasons", () => {
  const m = new ActivityMachine();
  assert.equal(m.stop(A.EYE_BREAK, 0, "cancelled"), false);
  m.start(A.EYE_BREAK, 0);
  assert.throws(() => m.stop(A.EYE_BREAK, 1, "whatever"), TypeError);
  assert.equal(m.current, A.EYE_BREAK);
});

test("every stop reason ends a suppressing activity and starts grace", () => {
  for (const reason of ["completed", "cancelled", "timeout", "left_frame", "mode"]) {
    for (const s of SUPPRESSING) {
      const m = new ActivityMachine();
      m.start(s, 100);
      assert.equal(m.stop(s, 120, reason), true);
      assert.equal(m.current, A.TRACKING);
      assert.deepEqual(m.lastEnd, { state: s, reason });
      assert.equal(m.inGrace(120), true, `${s} ${reason}`);
    }
  }
});

test("grace: no reminder, cue or praise for 10 s, scoring resumes, then everything is back", () => {
  const m = new ActivityMachine();
  m.start(A.EYE_BREAK, 0);
  m.stop(A.EYE_BREAK, 50, "completed");
  for (const t of [50, 55, 59.9]) {
    const p = m.policy(t);
    assert.equal(p.reminders, false, String(t));
    assert.equal(p.praise, false, String(t));
    assert.equal(p.engine, "track");
    assert.equal(p.score, "day");
    assert.equal(p.prompts, false);
    assert.equal(m.inGrace(t), true);
  }
  assert.equal(m.inGrace(60), false);
  assert.equal(m.policy(60).reminders, true);
  assert.equal(m.policy(60).praise, true);
  assert.equal(m.label(55), "");
});

test("grace length is configurable and a new activity cancels a running grace", () => {
  const m = new ActivityMachine({ grace_s: 3 });
  m.start(A.DEMO, 0);
  m.stop(A.DEMO, 10, "cancelled");
  assert.equal(m.inGrace(12.9), true);
  assert.equal(m.inGrace(13), false);
  m.stop(A.DEMO, 11, "cancelled");
  m.start(A.EYE_BREAK, 11);
  assert.equal(m.inGrace(11), false, "not TRACKING any more");
  assert.equal(m.policy(11).engine, "hold");
});

test("resuming from pause does not need grace and tracks normally", () => {
  const m = new ActivityMachine();
  m.start(A.PAUSED, 0);
  m.stop(A.PAUSED, 100);
  assert.equal(m.policy(100).reminders, true);
});

test("observePresence ends an eye break after leave_s out of frame, once", () => {
  const m = new ActivityMachine();
  m.start(A.EYE_BREAK, 0);
  assert.equal(m.observePresence(true, 1), false);
  assert.equal(m.observePresence(false, 2), false);
  assert.equal(m.observePresence(false, 3.9), false);
  assert.equal(m.observePresence(false, 4), true);
  assert.equal(m.current, A.TRACKING);
  assert.deepEqual(m.lastEnd, { state: A.EYE_BREAK, reason: "left_frame" });
  assert.equal(m.inGrace(4), true);
  assert.equal(m.observePresence(false, 5), false);
});

test("a short glance away resets the leave timer", () => {
  const m = new ActivityMachine();
  m.start(A.DEMO, 0);
  m.observePresence(false, 1);
  m.observePresence(true, 2);
  assert.equal(m.observePresence(false, 3), false);
  assert.equal(m.observePresence(false, 4.5), false);
  assert.equal(m.observePresence(false, 5), true);
});

test("being absent before the activity starts does not end it at once", () => {
  const m = new ActivityMachine();
  m.observePresence(false, 0);
  m.observePresence(false, 50);
  m.start(A.EYE_BREAK, 50);
  assert.equal(m.observePresence(false, 50.5), false);
  assert.equal(m.observePresence(false, 52.5), true);
});

test("leaving the frame only cancels activities that say so, and never while paused", () => {
  for (const s of [A.BREATH_CHECK, A.BREATHE_GUIDE]) {
    const m = new ActivityMachine();
    m.start(s, 0);
    assert.equal(m.observePresence(false, 1), false);
    assert.equal(m.observePresence(false, 100), false);
    assert.equal(m.current, s);
  }
  const m = new ActivityMachine({ leave_s: 2 });
  m.start(A.EYE_BREAK, 0);
  m.start(A.PAUSED, 1);
  assert.equal(m.observePresence(false, 1), false);
  assert.equal(m.observePresence(false, 50), false);
});

test("leave_s defaults to the engine's no-person timeout", () => {
  assert.equal(new ActivityMachine().leave_s, 2);
});

// -- randomized properties (seeded) -------------------------------------------

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL = Object.values(A).filter((s) => s !== A.TRACKING);
const REASONS = ["completed", "cancelled", "timeout", "left_frame", "mode"];

test("property: reminders and praise are off in every suppressing state, in grace and while paused", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed);
    const m = new ActivityMachine();
    let now = 0;
    let lastSuppressEnd = -Infinity;
    for (let i = 0; i < 80; i++) {
      now += r() * 8;
      const roll = r();
      if (roll < 0.35) {
        m.start(ALL[Math.floor(r() * ALL.length)], now);
      } else if (roll < 0.65) {
        const s = ALL[Math.floor(r() * ALL.length)];
        const had = m.isActive(s);
        m.stop(s, now, REASONS[Math.floor(r() * REASONS.length)]);
        if (had && SUPPRESSING.includes(s) && m.current === A.TRACKING) lastSuppressEnd = now;
      } else if (roll < 0.85) {
        const ended = m.observePresence(r() < 0.4, now);
        if (ended) lastSuppressEnd = now;
      }
      const p = m.policy(now);
      const cur = m.current;
      if (cur !== A.TRACKING) {
        assert.equal(p.reminders, false, `seed ${seed} ${cur}`);
        assert.equal(p.praise, false, `seed ${seed} ${cur}`);
        assert.equal(p.prompts, false, `seed ${seed} ${cur}`);
      }
      if (m.isActive(A.PAUSED)) {
        assert.equal(cur, A.PAUSED, `seed ${seed}`);
        assert.equal(p.frames, false);
        assert.equal(p.score, "none");
      }
      if (SUPPRESSING.includes(cur)) assert.equal(p.score, "none", `seed ${seed} ${cur}`);
      if (cur === A.TRACKING && now - lastSuppressEnd < 10) {
        assert.equal(p.reminders, false, `seed ${seed} grace at ${now}`);
        assert.equal(p.praise, false, `seed ${seed} grace at ${now}`);
        assert.equal(m.inGrace(now), true);
      }
      if (m.inGrace(now)) assert.equal(p.reminders, false);
      // at most one foreground activity, and none beside a mode
      const fgCount = [A.BREATH_CHECK, A.BREATHE_GUIDE, A.EYE_BREAK, A.DEMO, A.SETUP].filter((s) =>
        m.isActive(s),
      ).length;
      assert.ok(fgCount <= 1, `seed ${seed}`);
      if (fgCount === 1) assert.equal(cur !== A.PAUSED && cur !== A.SILENT_TEST && cur !== A.PRACTICE, true);
    }
  }
});

test("property: reminders are only ever true when TRACKING outside grace", () => {
  for (let seed = 1000; seed < 1200; seed++) {
    const r = rng(seed);
    const m = new ActivityMachine();
    let now = 0;
    for (let i = 0; i < 60; i++) {
      now += r() * 15;
      if (r() < 0.5) m.start(ALL[Math.floor(r() * ALL.length)], now);
      else m.stop(ALL[Math.floor(r() * ALL.length)], now, "cancelled");
      if (m.policy(now).reminders) {
        assert.equal(m.current, A.TRACKING, `seed ${seed}`);
        assert.equal(m.inGrace(now), false, `seed ${seed}`);
      }
    }
  }
});

test("OwedReminder: delivers after grace only while still slouching, then forgets", () => {
  const o = new OwedReminder();
  o.defer("chime");
  o.defer("voice");
  assert.equal(o.take(true, true), null, "held back during grace");
  assert.equal(o.take(false, true), "chime", "first deferred reminder wins");
  assert.equal(o.take(false, true), null, "delivered once");
  o.defer("voice");
  assert.equal(o.take(false, false), null, "no longer slouching");
  assert.equal(o.take(false, true), null, "and forgotten");
});

test("OwedReminder: clear (pause, break, resume) drops a stale reminder", () => {
  const o = new OwedReminder();
  o.defer("voice");
  o.clear();
  assert.equal(o.take(false, true), null);
});
