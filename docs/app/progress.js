// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// Personal progress review: pure functions over the stored daily totals
// (store.days, seconds keyed by UTC date) and silent-test results
// (store.tests). No DOM, no network, no streak counter: a missed day is just a
// day with no data. See .kiro/specs/progress-review.

export const PROGRESS = Object.freeze({
  min_tracked_s: 60, // a day with less tracked time shows "no data", not a percentage
  window_days: 7,
  max_tests: 10,
});

export const EXPORT_SCHEMA = 1;
const DAY_MS = 86400000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const secs = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const pctOf = (good, bad) => {
  const total = good + bad;
  return total > 0 ? Math.min(100, Math.max(0, Math.round((100 * good) / total))) : null;
};
const toMs = (now) => (now instanceof Date ? now.getTime() : Number.isFinite(now) ? now : Date.now());
const dateKey = (ms) => new Date(ms).toISOString().slice(0, 10);

function validTests(store) {
  const list = Array.isArray(store?.tests) ? store.tests : [];
  return list
    .filter((t) => t && typeof t === "object")
    .map((t) => ({ at: typeof t.at === "string" ? t.at : "", minutes: secs(t.minutes), good: secs(t.good), bad: secs(t.bad) }))
    .filter((t) => t.good + t.bad > 0);
}

/** @param {object} store parsed posture-guard:v1. @param {number|Date} now */
export function summarize(store, now = Date.now(), cfg = PROGRESS) {
  const end = toMs(now);
  const stored = store?.days && typeof store.days === "object" ? store.days : {};
  const days = [];
  for (let i = cfg.window_days - 1; i >= 0; i--) {
    const date = dateKey(end - i * DAY_MS);
    const d = stored[date] && typeof stored[date] === "object" ? stored[date] : {};
    const good = secs(d.good), bad = secs(d.bad);
    const tracked = good + bad;
    days.push({
      date, tracked_s: tracked, good_s: good,
      pct: tracked >= cfg.min_tracked_s ? pctOf(good, bad) : null,
    });
  }
  let cumulative = 0;
  for (const [key, d] of Object.entries(stored)) {
    if (DATE_KEY.test(key) && d && typeof d === "object") cumulative += secs(d.good);
  }
  const withData = days.filter((d) => d.pct !== null);
  const coached = withData.length
    ? pctOf(withData.reduce((a, d) => a + d.good_s, 0), withData.reduce((a, d) => a + (d.tracked_s - d.good_s), 0))
    : null;
  const tests = validTests(store).slice(-cfg.max_tests).map((t) => ({
    at: t.at, minutes: t.minutes, pct: pctOf(t.good, t.bad),
  }));
  const latest = tests[tests.length - 1];
  return {
    days,
    cumulative_good_s: cumulative,
    tests,
    coached_pct_7d: coached,
    try_light: Boolean(latest && coached !== null && withData.length >= 2 && latest.pct >= coached),
    empty: withData.length === 0 && tests.length === 0 && cumulative === 0,
  };
}

/** JSON of the whitelisted fields only (no sounds, calibration or settings). */
export function exportJson(store, now = Date.now()) {
  const stored = store?.days && typeof store.days === "object" ? store.days : {};
  const days = {};
  for (const [key, d] of Object.entries(stored)) {
    if (DATE_KEY.test(key) && d && typeof d === "object") {
      days[key] = { good: Math.round(secs(d.good)), bad: Math.round(secs(d.bad)) };
    }
  }
  const tests = validTests(store).map((t) => ({
    at: t.at, minutes: t.minutes, good: Math.round(t.good), bad: Math.round(t.bad),
  }));
  return JSON.stringify({ schema: EXPORT_SCHEMA, exportedAt: new Date(toMs(now)).toISOString(), days, tests }, null, 2);
}
