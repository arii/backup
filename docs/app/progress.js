// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Personal progress review: pure functions over the stored daily totals
// (store.days, seconds keyed by date), silent-test results (store.tests) and
// the water count (store.water). Day keys are UTC dates in schema 1 and local
// dates in schema 2 (see migrateStore). No DOM, no network, no streak counter:
// a missed day is just a day with no data. See .kiro/specs/progress-review.

export const PROGRESS = Object.freeze({
  min_tracked_s: 60, // a day with less tracked time shows "no data", not a percentage
  window_days: 7,
  max_tests: 10,
  board_min_tracked_s: 20 * 60, // a day needs 20 tracked minutes to rank on the personal best-days board
  board_size: 3,
  good_run_s: 60, // a good run is a sustained stretch of good posture, not a single frame
});

export const SCHEMA = 2; // 1: UTC day keys. 2: local day keys from store.dayKeyCutover.
export const IMPORT_MAX_BYTES = 1024 * 1024;
const MAX_TESTS_STORED = 50;
const MAX_IMPORT_DAYS = 3660;
const DAY_MS = 86400000;
const DAY_EXTRAS = Object.freeze([
  "relaxed_s",
  "shoulder_s",
  "best",
  "brace_events",
  "breaks",
  "slouch_events",
  "good_runs",
]);
const DAY_MAX_S = 86400; // a day has 86400 seconds; no seconds field may exceed it
const SECONDS_FIELDS = Object.freeze(["good", "bad", "relaxed_s", "shoulder_s", "best"]);

/** Seconds of good posture with a shoulder reading, the denominator for the relaxed share.
 *  Days saved before shoulder_s existed only have relaxed_s, so they fall back to tracked time. */
const shoulderBase = (d, good, tracked, relaxed) => {
  const m = Math.min(secs(d.shoulder_s), good);
  if (m > 0) return Math.max(m, relaxed);
  return relaxed > 0 ? tracked : 0;
};
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const secs = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const pctOf = (good, bad) => {
  const total = good + bad;
  return total > 0 ? Math.min(100, Math.max(0, Math.round((100 * good) / total))) : null;
};
const toMs = (now) => (now instanceof Date ? now.getTime() : Number.isFinite(now) ? now : Date.now());
const utcKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, "0");
/** YYYY-MM-DD in the device's own time zone. */
export function localDateKey(now = Date.now()) {
  const d = new Date(toMs(now));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Stored schema: missing or invalid counts as 1. Unknown fields are ignored. */
export function readSchema(store) {
  const v = Number(store?.schema);
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

/** Day key for "now" under the store's schema. */
export function dayKeyFor(store, now = Date.now()) {
  return readSchema(store) >= 2 ? localDateKey(now) : utcKey(toMs(now));
}

/** Move a store to schema 2. Old UTC keys are kept as they are (a day's seconds cannot be
 *  re-split); local dates are written from the cut-over, recorded in store.dayKeyCutover. */
export function migrateStore(store, now = Date.now()) {
  if (readSchema(store) >= SCHEMA) return store;
  store.schema = SCHEMA;
  store.dayKeyCutover = localDateKey(now);
  return store;
}

/** Add `dt` seconds to a day record. kind "good" or "bad"; `relaxed` is true when the
 *  shoulders were not braced, false when braced, null when they were not measured (no
 *  consent or no reference yet). Measured seconds (true or false) also go to `shoulder_s`,
 *  the denominator of the relaxed share. `streak` is the current good run. */
export function tallyDay(day, kind, dt, { relaxed = null, streak = 0 } = {}) {
  const t = secs(dt);
  if (kind === "good") {
    day.good = secs(day.good) + t;
    if (relaxed === true) day.relaxed_s = secs(day.relaxed_s) + t;
    if (relaxed === true || relaxed === false) day.shoulder_s = secs(day.shoulder_s) + t;
    if (Number.isFinite(streak) && streak > secs(day.best)) day.best = streak;
  } else if (kind === "bad") {
    day.bad = secs(day.bad) + t;
  }
  return day;
}

function validTests(store) {
  const list = Array.isArray(store?.tests) ? store.tests : [];
  return list
    .filter((t) => t && typeof t === "object")
    .map((t) => ({
      at: typeof t.at === "string" ? t.at : "",
      minutes: secs(t.minutes),
      good: secs(t.good),
      bad: secs(t.bad),
    }))
    .filter((t) => t.good + t.bad > 0);
}

/** @param {object} store parsed posture-guard:v1. @param {number|Date} now */
export function summarize(store, now = Date.now(), cfg = PROGRESS) {
  const end = toMs(now);
  const local = readSchema(store) >= 2;
  const dateKey = (daysBack) => {
    if (!local) return utcKey(end - daysBack * DAY_MS);
    const d = new Date(end);
    d.setDate(d.getDate() - daysBack); // calendar days, so DST shifts cannot skip or repeat a date
    return localDateKey(d);
  };
  const stored = store?.days && typeof store.days === "object" ? store.days : {};
  const days = [];
  for (let i = cfg.window_days - 1; i >= 0; i--) {
    const date = dateKey(i);
    const d = stored[date] && typeof stored[date] === "object" ? stored[date] : {};
    const good = secs(d.good),
      bad = secs(d.bad);
    const tracked = good + bad;
    const enough = tracked >= cfg.min_tracked_s;
    const relaxed = Math.min(secs(d.relaxed_s), good);
    const base = shoulderBase(d, good, tracked, relaxed);
    days.push({
      date,
      tracked_s: tracked,
      good_s: good,
      pct: enough ? pctOf(good, bad) : null,
      relaxed_s: relaxed,
      relaxed_pct: enough && base > 0 ? pctOf(relaxed, base - relaxed) : null,
      best_s: Math.min(secs(d.best), good),
      brace_events: Math.floor(secs(d.brace_events)),
      bad_s: bad,
      // Days saved before episodes were counted have no field: unknown (null), never an invented zero.
      slouch_events: Number.isFinite(d.slouch_events) ? Math.floor(secs(d.slouch_events)) : null,
      good_runs: Number.isFinite(d.good_runs) ? Math.floor(secs(d.good_runs)) : null,
    });
  }
  let cumulative = 0;
  for (const [key, d] of Object.entries(stored)) {
    if (DATE_KEY.test(key) && d && typeof d === "object") cumulative += secs(d.good);
  }
  const withData = days.filter((d) => d.pct !== null);
  const coached = withData.length
    ? pctOf(
        withData.reduce((a, d) => a + d.good_s, 0),
        withData.reduce((a, d) => a + (d.tracked_s - d.good_s), 0),
      )
    : null;
  const tests = validTests(store)
    .slice(-cfg.max_tests)
    .map((t) => ({
      at: t.at,
      minutes: t.minutes,
      pct: pctOf(t.good, t.bad),
    }));
  const latest = tests[tests.length - 1];
  const water = store?.water && typeof store.water === "object" ? store.water : {};
  const waterOf = (date) => Math.floor(secs(water[date]));
  const counted = (key) => {
    const known = days.filter((d) => d[key] !== null);
    return known.length ? known.reduce((a, d) => a + d[key], 0) : null;
  };
  return {
    count_days_known: days.filter((d) => d.tracked_s > 0 && d.slouch_events !== null).length,
    slouch_events_7d: counted("slouch_events"),
    good_runs_7d: counted("good_runs"),
    bad_s_7d: days.reduce((a, d) => a + d.bad_s, 0),
    board: bestDays(store, now, cfg),
    water_today: waterOf(days[days.length - 1].date),
    water_7d: days.reduce((a, d) => a + waterOf(d.date), 0),
    days,
    cumulative_good_s: cumulative,
    tests,
    coached_pct_7d: coached,
    try_light: Boolean(latest && coached !== null && withData.length >= 2 && latest.pct >= coached),
    empty: withData.length === 0 && tests.length === 0 && cumulative === 0,
  };
}

/** Personal best days, highest good-posture share first (ties: more good time). Only days with
 *  enough tracked time rank, so one lucky minute cannot top the board. Purely this device's own
 *  history: no names, no sharing, no ranking against other people. `today` marks today's row. */
export function bestDays(store, now = Date.now(), cfg = PROGRESS) {
  const stored = store?.days && typeof store.days === "object" ? store.days : {};
  const today = dayKeyFor(store, now);
  const rows = [];
  for (const [key, d] of Object.entries(stored)) {
    if (!DATE_KEY.test(key) || !d || typeof d !== "object") continue;
    const good = secs(d.good);
    const bad = secs(d.bad);
    if (good + bad < cfg.board_min_tracked_s) continue;
    rows.push({ date: key, pct: pctOf(good, bad), good_s: good, tracked_s: good + bad, today: key === today });
  }
  rows.sort((a, b) => b.pct - a.pct || b.good_s - a.good_s || (a.date < b.date ? 1 : -1));
  const top = rows.slice(0, cfg.board_size);
  const rank = rows.findIndex((r) => r.today);
  return { top, ranked_days: rows.length, today_rank: rank === -1 ? null : rank + 1 };
}

/** JSON of the whitelisted fields only (no sounds, calibration or settings). */
export function exportJson(store, now = Date.now()) {
  const stored = store?.days && typeof store.days === "object" ? store.days : {};
  const days = {};
  for (const [key, d] of Object.entries(stored)) {
    if (DATE_KEY.test(key) && d && typeof d === "object") {
      days[key] = { good: Math.round(secs(d.good)), bad: Math.round(secs(d.bad)) };
      for (const f of DAY_EXTRAS) if (secs(d[f]) > 0) days[key][f] = Math.round(secs(d[f]));
    }
  }
  const tests = validTests(store).map((t) => ({
    at: t.at,
    minutes: t.minutes,
    good: Math.round(t.good),
    bad: Math.round(t.bad),
  }));
  const water = {};
  for (const [key, n] of Object.entries(store?.water && typeof store.water === "object" ? store.water : {})) {
    if (DATE_KEY.test(key) && secs(n) > 0) water[key] = Math.floor(secs(n));
  }
  const out = { schema: readSchema(store), exportedAt: new Date(toMs(now)).toISOString(), days, tests, water };
  if (typeof store?.dayKeyCutover === "string" && DATE_KEY.test(store.dayKeyCutover)) {
    out.dayKeyCutover = store.dayKeyCutover;
  }
  return JSON.stringify(out, null, 2);
}

// -- import -----------------------------------------------------------------------------

const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isRealDate = (key) => DATE_KEY.test(key) && utcKey(Date.parse(`${key}T00:00:00Z`)) === key;
const reject = (error) => ({ ok: false, error });

/** Validate an exported file. Whole-file reject on any problem: size over 1 MB, bad JSON, a
 *  date that does not exist, or a value that is not a finite non-negative number. */
export function parseImport(text, maxBytes = IMPORT_MAX_BYTES) {
  if (typeof text !== "string") return reject("The file could not be read.");
  if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) {
    return reject("The file is larger than 1 MB.");
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return reject("The file is not valid JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return reject("This is not a BackUp progress export.");
  const rawDays = data.days ?? {};
  const rawTests = data.tests ?? [];
  const rawWater = data.water ?? {};
  if (typeof rawDays !== "object" || Array.isArray(rawDays) || !Array.isArray(rawTests)) {
    return reject("This is not a BackUp progress export.");
  }
  if (typeof rawWater !== "object" || Array.isArray(rawWater) || rawWater === null || rawDays === null) {
    return reject("This is not a BackUp progress export.");
  }
  const days = {};
  const keys = Object.keys(rawDays);
  if (keys.length > MAX_IMPORT_DAYS) return reject("Too many days in the file.");
  for (const key of keys) {
    const d = rawDays[key];
    if (!isRealDate(key) || !d || typeof d !== "object") return reject(`Day ${key} is not valid.`);
    if (!isNum(d.good) || !isNum(d.bad)) return reject(`Day ${key} has a value that is not a number of seconds.`);
    days[key] = { good: d.good, bad: d.bad };
    if (d.good + d.bad > DAY_MAX_S) return reject(`Day ${key} has more than 24 hours of tracked time.`);
    for (const f of DAY_EXTRAS) {
      if (d[f] === undefined) continue;
      if (!isNum(d[f])) return reject(`Day ${key} has a value that is not a number of seconds.`);
      days[key][f] = d[f];
    }
    for (const f of SECONDS_FIELDS) {
      if (days[key][f] > DAY_MAX_S) return reject(`Day ${key} has more than 24 hours in one value.`);
    }
  }
  if (rawTests.length > MAX_IMPORT_DAYS) return reject("Too many tests in the file.");
  const tests = [];
  for (const t of rawTests) {
    if (!t || typeof t !== "object" || typeof t.at !== "string" || Number.isNaN(Date.parse(t.at))) {
      return reject("A silent test has no valid date.");
    }
    if (!isNum(t.minutes) || !isNum(t.good) || !isNum(t.bad)) return reject("A silent test has an invalid number.");
    tests.push({ at: t.at, minutes: t.minutes, good: t.good, bad: t.bad });
  }
  const water = {};
  for (const [key, n] of Object.entries(rawWater)) {
    if (!isRealDate(key) || !isNum(n)) return reject(`Water entry ${key} is not valid.`);
    water[key] = Math.floor(n);
  }
  return { ok: true, days, tests, water };
}

/** Counts and totals for the preview dialog. */
export function previewImport(parsed) {
  const dayKeys = Object.keys(parsed.days).sort();
  return {
    days: dayKeys.length,
    tests: parsed.tests.length,
    good_s: Object.values(parsed.days).reduce((a, d) => a + d.good, 0),
    first: dayKeys[0] ?? null,
    last: dayKeys[dayKeys.length - 1] ?? null,
  };
}

/** Apply a parsed import. "merge" keeps the larger value per date and field (a day seen on
 *  two devices is not summed, so importing the same file twice changes nothing; seconds stay
 *  within 86400 a day) and adds tests not already present (same `at`); water also takes the
 *  larger count per date.
 *  "replace" swaps days, tests and water. Settings, calibration and consent are never touched. */
export function applyImport(store, parsed, mode) {
  store.days = store.days && typeof store.days === "object" ? store.days : {};
  store.tests = Array.isArray(store.tests) ? store.tests : [];
  store.water = store.water && typeof store.water === "object" ? store.water : {};
  if (mode === "replace") {
    store.days = {};
    store.tests = [];
    store.water = {};
  }
  for (const [key, d] of Object.entries(parsed.days)) {
    const cur = store.days[key] && typeof store.days[key] === "object" ? store.days[key] : {};
    const good = Math.min(DAY_MAX_S, Math.max(secs(cur.good), d.good));
    const bad = Math.min(DAY_MAX_S - good, Math.max(secs(cur.bad), d.bad));
    const next = { good, bad };
    for (const f of DAY_EXTRAS) {
      let v = Math.max(secs(cur[f]), d[f] ?? 0);
      if (SECONDS_FIELDS.includes(f)) v = Math.min(v, good); // relaxed, shoulder and best are parts of good
      if (v > 0) next[f] = v;
    }
    store.days[key] = next;
  }
  const seen = new Set(store.tests.map((t) => t?.at));
  for (const t of parsed.tests) {
    if (!seen.has(t.at)) {
      seen.add(t.at);
      store.tests.push(t);
    }
  }
  store.tests.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  store.tests = store.tests.slice(-MAX_TESTS_STORED);
  for (const [key, n] of Object.entries(parsed.water))
    store.water[key] = Math.max(Math.floor(secs(store.water[key])), n);
  return store;
}

// -- weekly view ------------------------------------------------------------------------

/** ISO 8601 week of a calendar date key: { week: "2026-W03", monday: "2026-01-12" }. */
export function isoWeek(key) {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  const monday = t - dow * DAY_MS;
  const thursday = monday + 3 * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const n = Math.floor((thursday - jan1) / (7 * DAY_MS)) + 1;
  return { week: `${year}-W${pad(n)}`, monday: utcKey(monday) };
}

/** Per ISO week, oldest first, for the last `weeks` weeks ending with the current one:
 *  coached % (store.days), silent-test % (mean of that week's tests, by local date) and the
 *  relaxed-shoulders share of the time the shoulders were measured. A week with too little tracked time has null pct. */
export function summarizeWeeks(store, now = Date.now(), weeks = 8, cfg = PROGRESS) {
  const today = dayKeyFor(store, now);
  const first = isoWeek(today).monday;
  const rows = [];
  const byWeek = new Map();
  for (let i = weeks - 1; i >= 0; i--) {
    const [y, m, d] = first.split("-").map(Number);
    const monday = utcKey(Date.UTC(y, m - 1, d) - i * 7 * DAY_MS);
    const row = {
      week: isoWeek(monday).week,
      start: monday,
      tracked_s: 0,
      good_s: 0,
      relaxed_s: 0,
      breaks: 0,
      days: [],
      coached_pct: null,
      silent_pct: null,
      relaxed_pct: null,
      _shoulder: 0,
      _silent: [],
    };
    rows.push(row);
    byWeek.set(row.week, row);
  }
  const stored = store?.days && typeof store.days === "object" ? store.days : {};
  for (const [key, d] of Object.entries(stored)) {
    if (!isRealDate(key) || !d || typeof d !== "object") continue;
    const row = byWeek.get(isoWeek(key).week);
    if (!row) continue;
    const good = secs(d.good);
    const tracked = good + secs(d.bad);
    row.tracked_s += tracked;
    row.good_s += good;
    const relaxed = Math.min(secs(d.relaxed_s), good);
    row.relaxed_s += relaxed;
    row._shoulder += shoulderBase(d, good, tracked, relaxed);
    row.breaks += Math.floor(secs(d.breaks));
    row.days.push({
      date: key,
      tracked_s: tracked,
      good_s: good,
      relaxed_s: Math.min(secs(d.relaxed_s), good),
      breaks: Math.floor(secs(d.breaks)),
    });
  }
  const useLocal = readSchema(store) >= 2;
  for (const t of validTests(store)) {
    const ms = Date.parse(t.at);
    if (Number.isNaN(ms)) continue;
    const row = byWeek.get(isoWeek(useLocal ? localDateKey(ms) : utcKey(ms)).week);
    if (row) row._silent.push(pctOf(t.good, t.bad));
  }
  for (const row of rows) {
    if (row.tracked_s >= cfg.min_tracked_s) {
      row.coached_pct = pctOf(row.good_s, row.tracked_s - row.good_s);
      if (row._shoulder > 0) row.relaxed_pct = pctOf(row.relaxed_s, row._shoulder - row.relaxed_s);
    }
    if (row._silent.length) row.silent_pct = Math.round(row._silent.reduce((a, b) => a + b, 0) / row._silent.length);
    delete row._silent;
    delete row._shoulder;
  }
  return rows;
}

/** Counts sustained episodes into `day` (one day's record). `flags` holds {dayKey, inBadRun,
 *  goodRunCounted} between calls. A slouch counts once when a bad state begins; a good run counts
 *  once when the streak first reaches cfg.good_run_s. When the day changes the flags reset, so an
 *  episode already under way at midnight still counts on the new day, never silently dropped. */
export function countEpisodes(flags, day, dayKey, kind, streak, cfg = PROGRESS) {
  if (flags.dayKey !== dayKey) {
    flags.dayKey = dayKey;
    flags.inBadRun = false;
    flags.goodRunCounted = false;
  }
  if (kind === "good") {
    flags.inBadRun = false;
    if (!flags.goodRunCounted && streak >= cfg.good_run_s) {
      flags.goodRunCounted = true;
      day.good_runs = (day.good_runs || 0) + 1;
    }
  } else if (kind === "bad") {
    if (!flags.inBadRun) {
      flags.inBadRun = true;
      day.slouch_events = (day.slouch_events || 0) + 1;
    }
    flags.goodRunCounted = false;
  }
}
