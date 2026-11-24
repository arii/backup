// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// timeline.js: today's session as coloured runs (#98 frame 04).

import assert from "node:assert/strict";
import test from "node:test";
import { SessionTimeline, ZONES } from "../../docs/app/timeline.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("runs merge by zone and the fractions follow the time spent", () => {
  const t = new SessionTimeline();
  for (let s = 0; s <= 60; s++) t.add("good", s);
  for (let s = 61; s <= 80; s++) t.add("drift", s);
  for (let s = 81; s <= 100; s++) t.add("bad", s);
  const seg = t.segments();
  assert.deepEqual(
    seg.map((x) => x.zone),
    ["good", "drift", "bad"],
  );
  assert.ok(Math.abs(seg[0].fraction - 0.61) < 0.02, seg[0].fraction);
  assert.equal(t.start, 0);
});

test("a long gap counts as nobody scored, and time never runs backwards", () => {
  const t = new SessionTimeline();
  for (let s = 0; s <= 10; s++) t.add("good", s);
  for (let s = 100; s <= 110; s++) t.add("good", s); // the tab slept for 90 s
  t.add("bad", 50); // ignored
  assert.deepEqual(
    t.segments().map((x) => x.zone),
    ["good", "none", "good"],
  );
  t.add("nope", 120);
  assert.equal(t.runs[t.runs.length - 1].end, 110);
});

test("property: fractions sum to 1 and stay valid for random sessions at 2 to 30 fps", () => {
  const rand = rng(98);
  for (let k = 0; k < 50; k++) {
    const t = new SessionTimeline();
    let now = 0;
    for (let i = 0; i < 500; i++) {
      now += 1 / (2 + rand() * 28);
      t.add(ZONES[Math.floor(rand() * ZONES.length)], now);
    }
    const seg = t.segments();
    const sum = seg.reduce((a, x) => a + x.fraction, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, sum);
    assert.ok(seg.every((x) => ZONES.includes(x.zone) && x.fraction >= 0));
    for (let i = 1; i < seg.length; i++) assert.notEqual(seg[i].zone, seg[i - 1].zone);
  }
});

test("an empty or single-instant session has no segments", () => {
  const t = new SessionTimeline();
  assert.deepEqual(t.segments(), []);
  t.add("good", 5);
  assert.deepEqual(t.segments(), []);
});
