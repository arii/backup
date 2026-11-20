// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// breathing.js: breathing moments and the "Breathe with me" guide.

import assert from "node:assert/strict";
import test from "node:test";
import { BreatheGuide, BreathingMoments, GUIDE, GUIDE_SAFETY, MOMENTS } from "../../docs/app/breathing.js";
import { ALL_LINES, BREATHE_LINES, BREATHING_MOMENTS, BREAK_LINES } from "../../docs/app/voice-lines.js";

test("a moment needs a long good streak", () => {
  const m = new BreathingMoments();
  assert.equal(m.due(MOMENTS.min_streak_s - 1, 0), false);
  assert.equal(m.due(MOMENTS.min_streak_s, 0), true);
});

test("at most one moment every 30 minutes", () => {
  const m = new BreathingMoments();
  m.take(1000);
  assert.equal(m.due(3600, 1000 + 30 * 60 - 1), false);
  assert.equal(m.due(3600, 1000 + 30 * 60), true);
});

test("lines rotate and do not repeat back to back", () => {
  const m = new BreathingMoments();
  const seen = [];
  for (let i = 0; i < BREATHING_MOMENTS.length + 1; i++) seen.push(m.take(i));
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1]);
  assert.equal(seen[0], seen[BREATHING_MOMENTS.length]);
});

test("the guide runs one minute at about 4 s in and 6 s out, then finishes", () => {
  assert.equal(GUIDE.in_s + GUIDE.out_s, 10);
  assert.equal(GUIDE.total_s, 60);
  const g = new BreatheGuide();
  assert.equal(g.update(0), null);
  g.start(100);
  assert.equal(g.active, true);
  let r = g.update(100);
  assert.equal(r.phase, "in");
  assert.equal(r.phaseStart, true);
  assert.equal(g.update(100.5).phaseStart, false);
  r = g.update(102);
  assert.equal(r.phase, "in");
  assert.ok(Math.abs(r.fill - 0.5) < 1e-9);
  r = g.update(104);
  assert.equal(r.phase, "out");
  assert.equal(r.phaseStart, true);
  assert.ok(Math.abs(r.fill - 1) < 1e-9);
  r = g.update(107);
  assert.ok(Math.abs(r.fill - 0.5) < 1e-9);
  r = g.update(110);
  assert.equal(r.phase, "in");
  assert.equal(r.cycle, 1);
  r = g.update(160);
  assert.equal(r.phase, "done");
  assert.equal(g.active, false);
  assert.equal(g.update(161), null);
});

test("the guide can be cancelled", () => {
  const g = new BreatheGuide();
  g.start(0);
  g.cancel();
  assert.equal(g.update(1), null);
});

test("new spoken lines are in ALL_LINES and use wellness wording only", () => {
  const lines = [...Object.values(BREAK_LINES), ...BREATHING_MOMENTS, ...Object.values(BREATHE_LINES)];
  for (const l of lines) {
    assert.ok(ALL_LINES.includes(l), l);
    assert.doesNotMatch(l, /stress|blood pressure|anxiety|cure|treat|prevent|pain|heal/i, l);
  }
  assert.match(BREATHE_LINES.intro, /Stop if you feel dizzy/);
  assert.match(GUIDE_SAFETY, /dizzy/);
});
