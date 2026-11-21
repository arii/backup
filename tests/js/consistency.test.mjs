// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// consistency.js: weekly score with the 90% good cap (spec P7).

import assert from "node:assert/strict";
import test from "node:test";
import { CONSISTENCY, consistencyScore } from "../../docs/app/consistency.js";

const MIN = 60;
const day = (trackedMin, goodPct, extra = {}) => ({
  tracked_s: trackedMin * MIN,
  good_s: (trackedMin * MIN * goodPct) / 100,
  ...extra,
});
const week = (n, d) => ({ days: Array.from({ length: n }, () => ({ ...d })) });

test("weights add to 1 and a perfect week scores 100", () => {
  const w = CONSISTENCY.weights;
  assert.ok(Math.abs(w.days + w.good + w.relax + w.breaks - 1) < 1e-9);
  const perfect = week(5, day(60, 100, { relaxed_s: 60 * MIN, breaks: 3 }));
  assert.equal(consistencyScore(perfect), 100);
});

test("P7: good % of 90 and 100 give the same score", () => {
  const at = (pct) => consistencyScore(week(5, day(60, pct, { relaxed_s: 1200, breaks: 2 })));
  assert.equal(at(90), at(100));
  assert.ok(at(60) < at(90), "below the cap more good posture still helps");
});

test("untracked time scores zero and short days do not count as active", () => {
  assert.equal(consistencyScore({ days: [] }), 0);
  assert.equal(consistencyScore(undefined), 0);
  assert.equal(consistencyScore(week(7, day(19, 100, { breaks: 3 }))), 0, "19 minutes is below 20");
  assert.ok(consistencyScore(week(1, day(20, 80))) > 0);
});

test("active days are capped at 5 per week", () => {
  const five = consistencyScore(week(5, day(30, 80, { breaks: 3 })));
  const seven = consistencyScore(week(7, day(30, 80, { breaks: 3 })));
  assert.equal(five, seven);
});

test("a day's tracked time counts at most 10 hours", () => {
  const ten = consistencyScore(week(5, day(600, 80, { relaxed_s: 100 * MIN, breaks: 3 })));
  const twenty = consistencyScore(week(5, day(1200, 80, { relaxed_s: 200 * MIN, breaks: 3 })));
  assert.equal(ten, twenty);
});

test("relaxed shoulders and breaks raise the score; good % alone cannot reach it", () => {
  const rigid = consistencyScore(week(5, day(60, 100)));
  const relaxed = consistencyScore(week(5, day(60, 70, { relaxed_s: 50 * MIN, breaks: 3 })));
  assert.ok(relaxed > rigid);
  assert.ok(rigid <= 60, "no relaxed time and no breaks tops out at days plus good bands");
});

test("bounded 0..100 and tolerant of bad numbers", () => {
  const w = {
    days: [{ tracked_s: Number.NaN, good_s: -4 }, null, { tracked_s: 1e9, good_s: 1e12, relaxed_s: 1e12, breaks: 1e9 }],
  };
  const s = consistencyScore(w);
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 100);
});
