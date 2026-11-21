// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// progress.js tasks 4 to 7 of .kiro/specs/progress-review: schema and import,
// local day keys, daily relaxed counters, weekly view.

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyImport,
  dayKeyFor,
  exportJson,
  IMPORT_MAX_BYTES,
  isoWeek,
  localDateKey,
  migrateStore,
  parseImport,
  previewImport,
  readSchema,
  SCHEMA,
  summarize,
  summarizeWeeks,
  tallyDay,
} from "../../docs/app/progress.js";

const NOW = new Date(2026, 3, 10, 12).getTime(); // 2026-04-10 noon, device time zone
const local = (daysAgo) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  return localDateKey(d);
};

// -- task 4: schema and import ------------------------------------------------------

test("readSchema: missing or invalid is 1, integers pass", () => {
  for (const s of [undefined, null, {}, { schema: "x" }, { schema: 0 }, { schema: 1.5 }])
    assert.equal(readSchema(s), 1);
  assert.equal(readSchema({ schema: 2 }), 2);
  assert.equal(readSchema({ schema: 3, future: true }), 3);
});

test("parseImport accepts an export round trip", () => {
  const store = {
    schema: 2,
    days: { "2026-04-09": { good: 100, bad: 20, relaxed_s: 50, best: 40 } },
    tests: [{ at: "2026-04-09T10:00:00.000Z", minutes: 5, good: 200, bad: 50 }],
    water: { "2026-04-09": 3 },
    sounds: "data:audio/wav;base64,AAAA",
  };
  const r = parseImport(exportJson(store, NOW));
  assert.equal(r.ok, true);
  assert.deepEqual(r.days["2026-04-09"], { good: 100, bad: 20, relaxed_s: 50, best: 40 });
  assert.equal(r.tests.length, 1);
  assert.deepEqual(r.water, { "2026-04-09": 3 });
  assert.deepEqual(previewImport(r), { days: 1, tests: 1, good_s: 100, first: "2026-04-09", last: "2026-04-09" });
});

test("parseImport rejects bad files whole", () => {
  const ok = { good: 1, bad: 1 };
  const cases = {
    "not json": "{nope",
    "array root": "[]",
    "null root": "null",
    string: '"x"',
    "negative seconds": JSON.stringify({ days: { "2026-04-09": { good: -1, bad: 0 } } }),
    "NaN-like string": JSON.stringify({ days: { "2026-04-09": { good: "5", bad: 0 } } }),
    "missing bad": JSON.stringify({ days: { "2026-04-09": { good: 5 } } }),
    "bad date shape": JSON.stringify({ days: { "04/09/2026": ok } }),
    "impossible date": JSON.stringify({ days: { "2026-02-31": ok } }),
    "bad extra": JSON.stringify({ days: { "2026-04-09": { good: 1, bad: 1, relaxed_s: -2 } } }),
    "test without date": JSON.stringify({ tests: [{ minutes: 1, good: 1, bad: 1 }] }),
    "test bad date": JSON.stringify({ tests: [{ at: "nope", minutes: 1, good: 1, bad: 1 }] }),
    "test negative": JSON.stringify({ tests: [{ at: "2026-04-09T10:00:00Z", minutes: 1, good: -1, bad: 1 }] }),
    "water negative": JSON.stringify({ water: { "2026-04-09": -1 } }),
    "days is array": JSON.stringify({ days: [] }),
  };
  for (const [name, text] of Object.entries(cases)) {
    const r = parseImport(text);
    assert.equal(r.ok, false, name);
    assert.equal(typeof r.error, "string", name);
  }
});

test("parseImport rejects files above 1 MB by bytes, not characters", () => {
  assert.equal(IMPORT_MAX_BYTES, 1024 * 1024);
  const big = `{"days":{},"pad":"${"x".repeat(IMPORT_MAX_BYTES)}"}`;
  assert.equal(parseImport(big).ok, false);
  const wide = `{"days":{},"pad":"${"\u00e9".repeat(IMPORT_MAX_BYTES / 2 + 100)}"}`;
  assert.ok(wide.length < IMPORT_MAX_BYTES);
  assert.equal(parseImport(wide).ok, false, "two-byte characters count as bytes");
  assert.equal(parseImport(undefined).ok, false);
});

test("applyImport merge sums seconds, de-duplicates tests and keeps settings", () => {
  const store = {
    mode: "silent",
    days: { "2026-04-09": { good: 100, bad: 10, best: 30 } },
    tests: [{ at: "2026-04-08T10:00:00.000Z", minutes: 5, good: 10, bad: 10 }],
    water: { "2026-04-09": 4 },
  };
  const parsed = parseImport(
    JSON.stringify({
      days: { "2026-04-09": { good: 50, bad: 5, best: 80 }, "2026-04-08": { good: 7, bad: 1 } },
      tests: [
        { at: "2026-04-08T10:00:00.000Z", minutes: 5, good: 10, bad: 10 },
        { at: "2026-04-07T10:00:00.000Z", minutes: 5, good: 20, bad: 5 },
      ],
      water: { "2026-04-09": 2 },
    }),
  );
  applyImport(store, parsed, "merge");
  assert.deepEqual(store.days["2026-04-09"], { good: 150, bad: 15, best: 80 });
  assert.deepEqual(store.days["2026-04-08"], { good: 7, bad: 1 });
  assert.equal(store.tests.length, 2);
  assert.equal(store.tests[0].at, "2026-04-07T10:00:00.000Z", "sorted by date");
  assert.equal(store.water["2026-04-09"], 4, "water takes the larger count");
  assert.equal(store.mode, "silent");
});

test("applyImport replace swaps days, tests and water only", () => {
  const store = {
    mode: "silent",
    days: { "2026-01-01": { good: 9, bad: 9 } },
    tests: [{ at: "2026-01-01T00:00:00Z" }],
    water: { "2026-01-01": 1 },
  };
  applyImport(store, parseImport(JSON.stringify({ days: { "2026-04-09": { good: 5, bad: 5 } } })), "replace");
  assert.deepEqual(Object.keys(store.days), ["2026-04-09"]);
  assert.deepEqual(store.tests, []);
  assert.deepEqual(store.water, {});
  assert.equal(store.mode, "silent");
});

test("applyImport keeps at most 50 tests", () => {
  const tests = Array.from({ length: 60 }, (_, i) => ({
    at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    minutes: 1,
    good: 1,
    bad: 1,
  }));
  const store = {};
  applyImport(store, parseImport(JSON.stringify({ tests })), "merge");
  assert.equal(store.tests.length, 50);
  assert.equal(store.tests[49].at, tests[59].at);
});

// -- task 5: local day keys and migration ------------------------------------------

test("migrateStore writes schema 2 and the cut-over date, once, and keeps old keys", () => {
  const store = { days: { "2026-04-01": { good: 5, bad: 5 } } };
  migrateStore(store, NOW);
  assert.equal(store.schema, SCHEMA);
  assert.equal(store.dayKeyCutover, localDateKey(NOW));
  assert.deepEqual(Object.keys(store.days), ["2026-04-01"]);
  migrateStore(store, NOW + 5 * 86400000);
  assert.equal(store.dayKeyCutover, localDateKey(NOW), "a second run changes nothing");
});

test("dayKeyFor uses UTC for schema 1 and local dates for schema 2", () => {
  const late = new Date(2026, 3, 10, 23, 30).getTime();
  assert.equal(dayKeyFor({ schema: 2 }, late), "2026-04-10");
  assert.equal(dayKeyFor({}, late), new Date(late).toISOString().slice(0, 10));
});

test("summarize window follows the schema and has no gaps across a month end", () => {
  const store = { schema: 2, days: { [local(0)]: { good: 300, bad: 100 } } };
  const s = summarize(store, NOW);
  assert.equal(s.days[6].date, local(0));
  assert.equal(s.days[6].pct, 75);
  const dates = s.days.map((d) => d.date);
  assert.equal(new Set(dates).size, 7);
  const march = new Date(2026, 2, 3, 12).getTime();
  assert.deepEqual(
    summarize({ schema: 2 }, march).days.map((d) => d.date.slice(5)),
    ["02-25", "02-26", "02-27", "02-28", "03-01", "03-02", "03-03"],
  );
});

test("exportJson carries schema and the cut-over date for a migrated store", () => {
  const out = JSON.parse(exportJson({ schema: 2, dayKeyCutover: "2026-04-01", days: {} }, NOW));
  assert.equal(out.schema, 2);
  assert.equal(out.dayKeyCutover, "2026-04-01");
});

// -- task 6: relaxed counters and trend ----------------------------------------------

test("tallyDay counts good, bad, relaxed seconds and the best run", () => {
  const day = { good: 0, bad: 0 };
  tallyDay(day, "good", 10, { relaxed: true, streak: 10 });
  tallyDay(day, "good", 5, { relaxed: false, streak: 15 });
  tallyDay(day, "good", 5, { relaxed: null, streak: 20 });
  tallyDay(day, "bad", 7);
  tallyDay(day, "good", 2, { relaxed: true, streak: 3 });
  tallyDay(day, "good", Number.NaN, { relaxed: true });
  assert.deepEqual(day, { good: 22, bad: 7, relaxed_s: 12, best: 20 });
});

test("summarize reports relaxed %, best run and bracing events, bounded and null when absent", () => {
  const store = {
    schema: 2,
    days: {
      [local(0)]: { good: 300, bad: 100, relaxed_s: 150, best: 120, brace_events: 2 },
      [local(1)]: { good: 300, bad: 100 },
      [local(2)]: { good: 100, bad: 0, relaxed_s: 9999, best: 9999 },
    },
  };
  const s = summarize(store, NOW);
  assert.equal(s.days[6].relaxed_pct, 38, "150 of 400 tracked seconds");
  assert.equal(s.days[6].best_s, 120);
  assert.equal(s.days[6].brace_events, 2);
  assert.equal(s.days[5].relaxed_pct, null, "no counter, no number");
  assert.equal(s.days[4].relaxed_pct, 100, "relaxed seconds are capped at good seconds");
  assert.equal(s.days[4].best_s, 100, "best run is capped at good seconds");
});

// -- task 7: weekly view --------------------------------------------------------------

test("isoWeek handles year ends and Mondays", () => {
  assert.deepEqual(isoWeek("2026-01-01"), { week: "2026-W01", monday: "2025-12-29" });
  assert.deepEqual(isoWeek("2021-01-03"), { week: "2020-W53", monday: "2020-12-28" });
  assert.deepEqual(isoWeek("2026-04-13"), { week: "2026-W16", monday: "2026-04-13" });
  assert.deepEqual(isoWeek("2026-04-12"), { week: "2026-W15", monday: "2026-04-06" });
});

test("summarizeWeeks: 8 weeks oldest first, coached and silent per week, relaxed share", () => {
  const store = {
    schema: 2,
    days: {
      "2026-04-06": { good: 600, bad: 200, relaxed_s: 400, breaks: 2 },
      "2026-04-10": { good: 100, bad: 100, breaks: 1 },
      "2026-03-31": { good: 30, bad: 10 },
    },
    tests: [
      { at: new Date(2026, 3, 8, 10).toISOString(), minutes: 5, good: 90, bad: 10 },
      { at: new Date(2026, 3, 9, 10).toISOString(), minutes: 5, good: 70, bad: 30 },
      { at: new Date(2026, 2, 31, 10).toISOString(), minutes: 5, good: 50, bad: 50 },
    ],
  };
  const w = summarizeWeeks(store, NOW);
  assert.equal(w.length, 8);
  assert.equal(w[7].week, "2026-W15");
  assert.equal(w[0].week, "2026-W08");
  assert.equal(w[7].coached_pct, 70, "700 of 1000 tracked seconds");
  assert.equal(w[7].silent_pct, 80, "mean of 90 and 70");
  assert.equal(w[7].relaxed_pct, 40, "400 of 1000 tracked seconds");
  assert.equal(w[7].breaks, 3);
  assert.equal(w[6].coached_pct, null, "40 s tracked is too little to score");
  assert.equal(w[6].silent_pct, 50);
  assert.equal(w[0].coached_pct, null);
  assert.equal(w[7].days.length, 2);
});

test("summarizeWeeks never throws on odd stores", () => {
  for (const store of [
    undefined,
    null,
    {},
    { days: 5, tests: "x" },
    { days: { bad: null, "2026-04-09": 5 }, tests: [null, { at: 5 }] },
  ]) {
    assert.equal(summarizeWeeks(store, NOW).length, 8);
  }
});
