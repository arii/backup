// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// progress.js: 7-day summary, silent-test trend and export.

import assert from "node:assert/strict";
import test from "node:test";
import { exportJson, PROGRESS, summarize } from "../../docs/app/progress.js";

const NOW = Date.UTC(2026, 3, 10, 12); // 2026-04-10
const key = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString().slice(0, 10);

test("window is the last 7 UTC days, oldest first, with null for sparse days", () => {
  const store = {
    days: { [key(0)]: { good: 300, bad: 100 }, [key(1)]: { good: 10, bad: 10 }, [key(9)]: { good: 600, bad: 0 } },
  };
  const s = summarize(store, NOW);
  assert.equal(s.days.length, PROGRESS.window_days);
  assert.equal(s.days[6].date, key(0));
  assert.equal(s.days[0].date, key(6));
  assert.equal(s.days[6].pct, 75);
  assert.equal(s.days[5].pct, null, "20 s tracked is below min_tracked_s");
  assert.equal(s.days[0].pct, null);
  assert.equal(s.cumulative_good_s, 910, "cumulative covers every stored day, not just the window");
  assert.equal(s.empty, false);
});

test("empty store is empty and never throws", () => {
  for (const store of [undefined, null, {}, { days: 5, tests: "x" }]) {
    const s = summarize(store, NOW);
    assert.equal(s.empty, true);
    assert.equal(
      s.days.every((d) => d.pct === null),
      true,
    );
  }
});

test("bad values are skipped and percentages stay within 0..100", () => {
  const store = {
    days: {
      [key(0)]: { good: "x", bad: NaN },
      [key(1)]: { good: -50, bad: 100 },
      [key(2)]: { good: Infinity, bad: 70 },
      [key(3)]: null,
      "not-a-date": { good: 9999, bad: 0 },
    },
    tests: [null, 7, { good: NaN, bad: 0 }, { at: "t", minutes: 5, good: 90, bad: 10 }],
  };
  const s = summarize(store, NOW);
  for (const d of s.days) assert.ok(d.pct === null || (d.pct >= 0 && d.pct <= 100));
  assert.equal(s.cumulative_good_s, 0);
  assert.equal(s.tests.length, 1);
  assert.equal(s.tests[0].pct, 90);
});

test("tests keep only the most recent max_tests, in order", () => {
  const tests = Array.from({ length: 15 }, (_, i) => ({
    at: `2026-04-${String(i + 1).padStart(2, "0")}`,
    minutes: 5,
    good: i * 10 + 10,
    bad: 100,
  }));
  const s = summarize({ tests }, NOW);
  assert.equal(s.tests.length, PROGRESS.max_tests);
  assert.equal(s.tests[s.tests.length - 1].at, "2026-04-15");
});

test("try_light needs a test at least as good as the coached score over 2+ days", () => {
  const days = { [key(0)]: { good: 600, bad: 400 }, [key(1)]: { good: 600, bad: 400 } }; // 60%
  const test = (good, bad) => ({ at: "t", minutes: 10, good, bad });
  assert.equal(summarize({ days, tests: [test(70, 30)] }, NOW).try_light, true);
  assert.equal(summarize({ days, tests: [test(60, 40)] }, NOW).try_light, true);
  assert.equal(summarize({ days, tests: [test(50, 50)] }, NOW).try_light, false);
  assert.equal(summarize({ days, tests: [] }, NOW).try_light, false);
  assert.equal(
    summarize({ days: { [key(0)]: days[key(0)] }, tests: [test(90, 10)] }, NOW).try_light,
    false,
    "one day is not enough",
  );
});

test("summarize does not mutate the store", () => {
  const store = {
    days: { [key(0)]: { good: 100, bad: 50 } },
    tests: [{ at: "t", minutes: 5, good: 50, bad: 50 }],
    mode: "silent",
  };
  const copy = JSON.stringify(store);
  summarize(store, NOW);
  assert.equal(JSON.stringify(store), copy);
});

test("export contains only whitelisted keys and drops sounds and calibration", () => {
  const store = {
    days: { [key(0)]: { good: 100.4, bad: 50, extra: 1 }, junk: { good: 1 } },
    tests: [{ at: "2026-04-01T00:00:00Z", minutes: 5, good: 50, bad: 50, secret: 1 }],
    goodSound: "data:audio/mp3;base64,AAAA",
    calibration: { good: {} },
    voiceText: "hello",
  };
  const out = JSON.parse(exportJson(store, NOW));
  assert.deepEqual(Object.keys(out).sort(), ["days", "exportedAt", "schema", "tests"]);
  assert.deepEqual(out.days, { [key(0)]: { good: 100, bad: 50 } });
  assert.deepEqual(Object.keys(out.tests[0]).sort(), ["at", "bad", "good", "minutes"]);
  assert.equal(out.exportedAt, new Date(NOW).toISOString());
});
