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

test("R4: a returning user jumps to stage 4 at settle, not before", () => {
  const r = new RevealStages({ returning: true });
  run(r, WAIT, 0, 30);
  assert.equal(r.stage, STAGES.tracking);
  run(r, OK, 30, REVEAL.settle_s + 1);
  assert.equal(r.stage, STAGES.comfortable);
});

test("R4: a seasoned returning user sees everything at settle", () => {
  const r = new RevealStages({ returning: true, seasoned: true });
  run(r, OK, 0, REVEAL.settle_s + 1);
  assert.equal(r.stage, STAGES.returning);
});

test("R4: revealAll and forceAll give stage 5 and stay there", () => {
  assert.equal(new RevealStages({ revealAll: true }).stage, STAGES.returning);
  const r = new RevealStages();
  assert.equal(r.forceAll().changed, true);
  assert.equal(r.forceAll().changed, false);
  run(r, NONE, 0, 10);
  assert.equal(r.stage, STAGES.returning);
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
