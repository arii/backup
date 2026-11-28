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
  assert.deepEqual(out.water, {});
  assert.deepEqual(Object.keys(out).sort(), ["days", "exportedAt", "schema", "tests", "water"]);
  assert.deepEqual(out.days, { [key(0)]: { good: 100, bad: 50 } });
  assert.deepEqual(Object.keys(out.tests[0]).sort(), ["at", "bad", "good", "minutes"]);
  assert.equal(out.exportedAt, new Date(NOW).toISOString());
});

// -- weekly bad time, episodes and the personal best-days board ---------------------------
import { bestDays as bestDaysFn, summarize as summarizeFn } from "../../docs/app/progress.js";

test("best days: needs 20 tracked minutes, highest good share first, personal only", () => {
  const store = {
    schema: 2,
    days: {
      "2026-11-20": { good: 1100, bad: 100 }, // 92%
      "2026-11-21": { good: 1800, bad: 600 }, // 75%
      "2026-11-22": { good: 100, bad: 0 }, // 100% but too little tracked: does not rank
      "2026-11-23": { good: 3000, bad: 200 }, // 94%
      "2026-11-24": { good: 1300, bad: 300 }, // 81%
    },
  };
  const b = bestDaysFn(store, new Date(2026, 10, 24, 12).getTime());
  assert.deepEqual(
    b.top.map((r) => r.date),
    ["2026-11-23", "2026-11-20", "2026-11-24"],
  );
  assert.equal(b.ranked_days, 4);
  assert.equal(b.today_rank, 3);
  assert.equal(b.top[2].today, true);
});

test("weekly summary: bad time is totalled, unknown episode counts stay null, not zero", () => {
  const now = new Date(2026, 10, 24, 12).getTime();
  const old = { schema: 2, days: { "2026-11-23": { good: 600, bad: 300 } } };
  const s = summarizeFn(old, now);
  assert.equal(s.bad_s_7d, 300);
  assert.equal(s.slouch_events_7d, null);
  assert.equal(s.good_runs_7d, null);
  const fresh = {
    schema: 2,
    days: {
      "2026-11-23": { good: 600, bad: 300 },
      "2026-11-24": { good: 600, bad: 60, slouch_events: 4, good_runs: 5 },
    },
  };
  const t = summarizeFn(fresh, now);
  assert.equal(t.slouch_events_7d, 4); // the old day is unknown, so only known days add up
  assert.equal(t.good_runs_7d, 5);
  assert.equal(t.bad_s_7d, 360);
  assert.equal(t.count_days_known, 1); // 1 of 2 tracked days has counts, so the UI says "1 of 2 days counted"
});

test("export and import keep the episode counts", async () => {
  const { exportJson, parseImport } = await import("../../docs/app/progress.js");
  const store = { schema: 2, days: { "2026-11-24": { good: 600, bad: 60, slouch_events: 4, good_runs: 5 } } };
  const parsed = parseImport(exportJson(store));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.days["2026-11-24"].slouch_events, 4);
  assert.equal(parsed.days["2026-11-24"].good_runs, 5);
});

import { countEpisodes } from "../../docs/app/progress.js";

test("episodes: a slouch counts once per run, and again after a good stretch", () => {
  const f = { dayKey: null, inBadRun: false, goodRunCounted: false };
  const d = {};
  for (let i = 0; i < 5; i++) countEpisodes(f, d, "2026-11-28", "bad", 0);
  countEpisodes(f, d, "2026-11-28", "good", 3);
  for (let i = 0; i < 3; i++) countEpisodes(f, d, "2026-11-28", "bad", 0);
  assert.equal(d.slouch_events, 2);
});

test("episodes: a good run counts once at the threshold, not per frame", () => {
  const f = { dayKey: null, inBadRun: false, goodRunCounted: false };
  const d = {};
  for (let s = 1; s <= 200; s++) countEpisodes(f, d, "2026-11-28", "good", s);
  assert.equal(d.good_runs, 1);
});

test("episodes: a slouch still under way at midnight counts on the new day", () => {
  const f = { dayKey: null, inBadRun: false, goodRunCounted: false };
  const mon = {};
  const tue = {};
  countEpisodes(f, mon, "2026-11-28", "bad", 0);
  countEpisodes(f, tue, "2026-11-29", "bad", 0);
  countEpisodes(f, tue, "2026-11-29", "bad", 0);
  assert.equal(mon.slouch_events, 1);
  assert.equal(tue.slouch_events, 1);
});

test("episodes: a good streak across midnight counts one run on each day", () => {
  const f = { dayKey: null, inBadRun: false, goodRunCounted: false };
  const mon = {};
  const tue = {};
  countEpisodes(f, mon, "2026-11-28", "good", 70);
  countEpisodes(f, tue, "2026-11-29", "good", 75);
  countEpisodes(f, tue, "2026-11-29", "good", 80);
  assert.equal(mon.good_runs, 1);
  assert.equal(tue.good_runs, 1);
});
