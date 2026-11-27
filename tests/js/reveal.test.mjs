// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { REVEAL, RevealStages, STAGES } from "../../docs/app/reveal.js";

const OK = { scored: true, present: true };
const WAIT = { scored: true, present: false }; // "settling in"
const NONE = { scored: false, present: false };

/** Feed `frame` every `dt` seconds from t0 for `secs`; return the clock after. */
function run(r, frame, t0, secs, dt = 0.5) {
  let t = t0;
  for (; t < t0 + secs; t += dt) r.update(frame, t);
  return t;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("starts idle and moves to tracking on the first scored frame", () => {
  const r = new RevealStages();
  assert.equal(r.update(NONE, 0).stage, STAGES.idle);
  const u = r.update(WAIT, 1);
  assert.equal(u.stage, STAGES.tracking);
  assert.equal(u.changed, true);
  assert.equal(r.update(WAIT, 1.5).changed, false);
});

test("R3: settles after settle_s of good frames, not before", () => {
  const r = new RevealStages();
  run(r, OK, 0, REVEAL.settle_s - 1);
  assert.equal(r.stage, STAGES.tracking);
  run(r, OK, REVEAL.settle_s - 1, 2);
  assert.equal(r.stage, STAGES.settled);
});

test("R3: a gap longer than gap_s restarts the hold but keeps the stage", () => {
  const r = new RevealStages();
  run(r, OK, 0, 6);
  run(r, NONE, 6, REVEAL.gap_s + 1);
  const t = run(r, OK, 6 + REVEAL.gap_s + 1, 6);
  assert.equal(r.stage, STAGES.tracking, "6 s before and 6 s after do not add up");
  run(r, OK, t, 6);
  assert.equal(r.stage, STAGES.settled);
  run(r, NONE, 40, 30);
  assert.equal(r.stage, STAGES.settled, "an unscored spell never lowers the stage");
});

test("R3: a short flicker (under gap_s) does not reset the hold", () => {
  const r = new RevealStages();
  run(r, OK, 0, 5);
  run(r, WAIT, 5, 2);
  run(r, OK, 7, 4);
  assert.equal(r.stage, STAGES.settled);
});

test("later stages follow tracked time", () => {
  const r = new RevealStages();
  run(r, OK, 0, REVEAL.config_s - 1);
  assert.equal(r.stage, STAGES.settled);
  run(r, OK, REVEAL.config_s - 1, 2);
  assert.equal(r.stage, STAGES.configured);
  run(r, OK, REVEAL.config_s + 1, REVEAL.comfortable_s);
  assert.equal(r.stage, STAGES.comfortable);
});

test("R1: the stage never decreases, whatever the frames do", () => {
  const rand = rng(7);
  const r = new RevealStages();
  let t = 0;
  let prev = 0;
  for (let i = 0; i < 4000; i++) {
    t += rand() * 2;
    const k = rand();
    const frame = {
      scored: k > 0.2,
      present: k > 0.3,
      paused: rand() < 0.05,
      silentTest: rand() < 0.03,
      practice: rand() < 0.03,
    };
    const { stage, changed } = r.update(frame, t);
    assert.ok(stage >= prev);
    assert.equal(changed, stage !== prev);
    prev = stage;
  }
});

test("R2: no advance and no time counted while paused, in a silent test or in practice", () => {
  for (const flag of ["paused", "silentTest", "practice"]) {
    const r = new RevealStages();
    run(r, OK, 0, 5);
    run(r, { ...OK, [flag]: true }, 5, 600);
    assert.equal(r.stage, STAGES.tracking, `${flag}: no settle`);
    run(r, OK, 605, 4);
    assert.equal(r.stage, STAGES.tracking, `${flag}: 5 s before plus 4 s after is under settle_s`);
    run(r, OK, 609, 3);
    assert.equal(r.stage, STAGES.settled, `${flag}: settles once 10 s of running time add up`);
  }
});

test("R2: time spent paused does not count toward stage 3", () => {
  const r = new RevealStages();
  run(r, OK, 0, 20);
  run(r, { ...OK, paused: true }, 20, 1000);
  run(r, OK, 1020, 5);
  assert.equal(r.stage, STAGES.settled);
});

test("R4: revealAll and forceAll give stage 5 and stay there", () => {
  assert.equal(new RevealStages({ revealAll: true }).stage, STAGES.all);
  const r = new RevealStages();
  assert.equal(r.forceAll().changed, true);
  assert.equal(r.forceAll().changed, false);
  run(r, NONE, 0, 10);
  assert.equal(r.stage, STAGES.all);
});

test("R5: a scaled clock (clockScale 600) reaches stage 4 in a few real seconds", () => {
  const r = new RevealStages();
  const scale = 600;
  let real = 0;
  while (r.stage < STAGES.comfortable && real < 5) {
    real += 0.1;
    r.update(OK, real * scale);
  }
  assert.equal(r.stage, STAGES.comfortable);
  assert.ok(real <= 1, `took ${real} real seconds`);
});

test("R5: back-to-back good frames settle even when each step is larger than gap_s", () => {
  const r = new RevealStages();
  r.update(OK, 0);
  r.update(OK, 30);
  r.update(OK, 60);
  assert.equal(r.stage, STAGES.settled);
});

// -- Settings unlocks (#96) --
import {
  nextUnlockCard,
  trackedDays,
  trackedSecondsFromDays,
  unlockLevel,
  visibleRows,
} from "../../docs/app/reveal.js";

test("unlocks: 5 rows on day one, then 6, 7 and 8 at 2 min, 5 min and a second day", () => {
  const counts = [
    unlockLevel({ trackedS: 0, days: 1 }),
    unlockLevel({ trackedS: REVEAL.config_s, days: 1 }),
    unlockLevel({ trackedS: REVEAL.comfortable_s, days: 1 }),
    unlockLevel({ trackedS: 10, days: 2 }),
  ].map((l) => visibleRows(l).length);
  assert.deepEqual(counts, [5, 6, 7, 8]);
  assert.deepEqual(visibleRows(0), ["chime", "sayfix", "posture", "breaknow", "help"]);
  assert.ok(visibleRows(1).includes("breaks") && !visibleRows(1).includes("shoulders"));
  assert.equal(visibleRows(0, true).length, 8, "revealAll shows every row");
});

test("property: the level never drops as tracked time or days grow, and never exceeds 8 rows", () => {
  const rand = rng(96);
  for (let i = 0; i < 500; i++) {
    const t = rand() * 1000;
    const d = Math.floor(rand() * 4);
    const a = unlockLevel({ trackedS: t, days: d });
    assert.ok(unlockLevel({ trackedS: t + rand() * 100, days: d }) >= a);
    assert.ok(unlockLevel({ trackedS: t, days: d + 1 }) >= a);
    assert.ok(visibleRows(a).length <= 8);
  }
});

test("unlock cards queue in order, and a done card never comes back", () => {
  assert.equal(nextUnlockCard(0, []), null);
  assert.equal(nextUnlockCard(1, []), "breaks");
  assert.equal(nextUnlockCard(3, []), "breaks", "one at a time, in order");
  assert.equal(nextUnlockCard(3, ["breaks"]), "shoulders");
  assert.equal(nextUnlockCard(3, ["breaks", "shoulders"]), "week");
  assert.equal(nextUnlockCard(3, ["breaks", "shoulders", "week"]), null);
});

test("a returning user's tracked time and days come from store.days", () => {
  const days = {
    "2026-11-20": { good: 100, bad: 50 },
    "2026-11-21": { good: 0, bad: 0 },
    x: null,
    y: { good: "junk" },
  };
  assert.equal(trackedSecondsFromDays(days), 150);
  assert.equal(trackedDays(days), 1);
  assert.equal(trackedSecondsFromDays(undefined), 0);
});

test("settleNow skips the settle hold so a scripted demo shows the gauge at once", () => {
  const r = new RevealStages();
  assert.equal(r.stage, STAGES.idle);
  const out = r.settleNow();
  assert.equal(out.stage, STAGES.settled);
  assert.equal(out.changed, true);
  assert.equal(r.settleNow().changed, false);
  r.update(OK, 0);
  r.update(OK, 0.5);
  assert.equal(r.stage, STAGES.settled);
});

test("reset forgets the session so a second demo or camera start begins from idle", () => {
  const r = new RevealStages();
  r.settleNow();
  run(r, OK, 0, 20);
  assert.ok(r.tracked > 0);
  r.reset();
  assert.equal(r.stage, STAGES.idle);
  assert.equal(r.tracked, 0);
  assert.equal(r.settled, false);
  run(r, OK, 100, 5);
  assert.equal(r.stage, STAGES.tracking);
});
