// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// breaks.js: continuous presence, eye and move breaks, away reset.

import assert from "node:assert/strict";
import test from "node:test";
import {
  BREAKS,
  BreakTracker,
  JAW_OPTIONS,
  MOVE_BREAK_OPTIONS,
  normalizeJawMinutes,
  normalizeMoveMinutes,
} from "../../docs/app/breaks.js";

/** Feed `seconds` of presence (or absence) at 1 s steps from `t`. Returns the new t and breaks taken. */
function run(tr, t, seconds, present) {
  let taken = 0;
  if (tr.lastT === null) tr.update(present, t); // the first sample only starts the clock
  for (let i = 0; i < seconds; i++) {
    t += 1;
    if (tr.update(present, t)) taken += 1;
  }
  return { t, taken };
}

test("eye break is due after 20 minutes of continuous presence", () => {
  const tr = new BreakTracker();
  let { t } = run(tr, 0, 20 * 60 - 2, true);
  assert.deepEqual(tr.due(), []);
  ({ t } = run(tr, t, 3, true));
  assert.deepEqual(tr.due(), ["eye"]);
});

test("move break default is 60 minutes and taking a break restarts its clock", () => {
  const tr = new BreakTracker();
  let { t } = run(tr, 0, 60 * 60, true);
  assert.deepEqual(tr.due(), ["eye", "move"]);
  tr.taken("eye");
  tr.taken("move");
  assert.deepEqual(tr.due(), []);
  ({ t } = run(tr, t, 20 * 60 + 1, true));
  assert.deepEqual(tr.due(), ["eye"]);
});

test("move break settings: off, 30, 45, 60 and 90; bad values fall back to 60", () => {
  assert.deepEqual([...MOVE_BREAK_OPTIONS], [0, 30, 45, 60, 90]);
  assert.equal(normalizeMoveMinutes(undefined), 60);
  assert.equal(normalizeMoveMinutes(12), 60);
  for (const m of [30, 45, 60, 90]) {
    const tr = new BreakTracker({ eyeBreaks: false, moveBreakMinutes: m });
    const { t } = run(tr, 0, m * 60 - 1, true);
    assert.deepEqual(tr.due(), [], `${m} just before`);
    run(tr, t, 1, true);
    assert.deepEqual(tr.due(), ["move"], `${m} on time`);
  }
  const off = new BreakTracker({ eyeBreaks: false, moveBreakMinutes: 0 });
  run(off, 0, 4 * 3600, true);
  assert.deepEqual(off.due(), []);
});

test("eye breaks can be switched off", () => {
  const tr = new BreakTracker({ eyeBreaks: false, moveBreakMinutes: 0 });
  run(tr, 0, 3600, true);
  assert.deepEqual(tr.due(), []);
  tr.setEyeBreaks(true);
  assert.deepEqual(tr.due(), ["eye"]);
});

test("2 minutes with NO_PERSON counts as a break and restarts the timers", () => {
  const tr = new BreakTracker();
  let { t } = run(tr, 0, 25 * 60, true);
  assert.deepEqual(tr.due(), ["eye"]);
  let r = run(tr, t, 119, false);
  assert.equal(r.taken, 0);
  r = run(tr, r.t, 1, false);
  assert.equal(r.taken, 1);
  r = run(tr, r.t, 600, false); // still away: counted once only
  assert.equal(r.taken, 0);
  assert.equal(tr.seated, 0);
  ({ t } = run(tr, r.t, 1, true));
  assert.deepEqual(tr.due(), []);
  run(tr, t, 20 * 60, true);
  assert.deepEqual(tr.due(), ["eye"]);
});

test("a short absence is not a break: seated time carries on", () => {
  const tr = new BreakTracker();
  const { t } = run(tr, 0, 19 * 60, true);
  let r = run(tr, t, 60, false);
  assert.equal(r.taken, 0);
  r = run(tr, r.t, 61, true);
  assert.deepEqual(tr.due(), ["eye"]);
});

test("no prompt is due while away", () => {
  const tr = new BreakTracker();
  const { t } = run(tr, 0, 25 * 60, true);
  run(tr, t, 5, false);
  assert.deepEqual(tr.due(), []);
  assert.deepEqual(tr.due(false), []);
});

test("constants match the issue", () => {
  assert.equal(BREAKS.eye_after_s, 1200);
  assert.equal(BREAKS.eye_look_s, 20);
  assert.equal(BREAKS.away_reset_s, 120);
});

test("the jaw prompt is off by default and due after 30 or 45 minutes of presence", () => {
  assert.deepEqual([...JAW_OPTIONS], [0, 30, 45]);
  assert.equal(normalizeJawMinutes("60"), 0);
  assert.equal(normalizeJawMinutes("45"), 45);
  const off = new BreakTracker({ eyeBreaks: false, moveBreakMinutes: 0 });
  run(off, 0, 3 * 3600, true);
  assert.deepEqual(off.due(true), []);
  const tr = new BreakTracker({ eyeBreaks: false, moveBreakMinutes: 0, jawMinutes: 30 });
  let t = run(tr, 0, 30 * 60 - 5, true).t;
  assert.deepEqual(tr.due(true), []);
  t = run(tr, t, 10, true).t;
  assert.deepEqual(tr.due(true), ["jaw"]);
  tr.taken("jaw");
  assert.deepEqual(tr.due(true), []);
  tr.setJawMinutes(0);
  run(tr, t, 3600, true);
  assert.deepEqual(tr.due(true), []);
});

test("two minutes away restarts the jaw timer", () => {
  const tr = new BreakTracker({ eyeBreaks: false, moveBreakMinutes: 0, jawMinutes: 30 });
  let t = run(tr, 0, 29 * 60, true).t;
  t = run(tr, t, 125, false).t;
  run(tr, t, 2 * 60, true);
  assert.deepEqual(tr.due(true), []);
});

test("nextIn: the sooner of the eye and move breaks, null when both are off (#98 frame 04)", () => {
  const b = new BreakTracker({ eyeBreaks: true, moveBreakMinutes: 60 });
  b.update(true, 0);
  b.update(true, 600);
  const n = b.nextIn();
  assert.equal(n.seconds, BREAKS.eye_after_s - 600);
  assert.ok(Math.abs(n.fraction - (BREAKS.eye_after_s - 600) / BREAKS.eye_after_s) < 1e-9);
  b.taken("eye");
  assert.equal(b.nextIn().seconds, BREAKS.eye_after_s, "after the eye break, the next one is 20 min away");
  const off = new BreakTracker({ eyeBreaks: false, moveBreakMinutes: 0 });
  assert.equal(off.nextIn(), null);
});
