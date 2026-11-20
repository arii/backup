// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// When (and whether) to show the sponsor card. Pure: the store and the clock
// are passed in, tested with a fake clock in tests/js/sponsor.test.mjs.
//
// Counts live only in the browser's localStorage store (no analytics):
//   store.usage   = { firstSeen: "YYYY-MM-DD", sessions: n }
//   store.days    = { "YYYY-MM-DD": { good, bad } }  (already kept for progress)
//   store.sponsor = { shown: n, never: bool, laterOn: "YYYY-MM-DD" | null }
// The card is never spoken and goes through the PromptScheduler as the lowest
// priority prompt ("share").

export const SPONSOR_URL = "https://github.com/sponsors/arii";

export const SPONSOR = Object.freeze({
  min_sessions: 5,
  min_days: 3,
  min_tracked_s: 2 * 3600,
  first_week_days: 7,
  max_shown: 3,
  later_days: 30,
  good_streak_s: 60, // in GOOD state this long, so not right after a reminder
});

const DAY_MS = 86400000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (key) => Date.parse(`${key}T00:00:00Z`);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/** Call when a tracking session starts (webcam or demo). Records the first-seen day. */
export function recordSession(store, nowMs) {
  if (!(store.usage && typeof store.usage === "object")) store.usage = {};
  const u = store.usage;
  if (!DATE_KEY.test(u.firstSeen || "")) u.firstSeen = dayKey(nowMs);
  u.sessions = num(u.sessions) + 1;
  return store;
}

/** Totals used by the gate: sessions, distinct days with tracked time, tracked seconds. */
export function usageTotals(store) {
  let days = 0;
  let seconds = 0;
  for (const [key, d] of Object.entries((store?.days) || {})) {
    if (!DATE_KEY.test(key) || !d || typeof d !== "object") continue;
    const s = num(d.good) + num(d.bad);
    seconds += s;
    if (s > 0) days += 1;
  }
  return { sessions: num(store?.usage?.sessions), days, seconds };
}

/** Text for the card, with the tracked hours rounded to a whole number (at least 2). */
export function sponsorText(store) {
  const h = Math.max(2, Math.round(usageTotals(store).seconds / 3600));
  return `You've tracked about ${h} hours with BackUp. It's free and built by one person. If it's helping, you can sponsor on GitHub. \u2665`;
}

/** True when the sponsor card may be offered now.
 *  ctx: { nowMs, good: in GOOD state long enough, silent: paused / silent test / practice }. */
export function shouldOfferSponsor(store, ctx, cfg = SPONSOR) {
  const { nowMs, good = false, silent = false } = ctx;
  if (!good || silent) return false;
  const sp = (store?.sponsor) || {};
  if (sp.never === true) return false;
  if (num(sp.shown) >= cfg.max_shown) return false;
  const t = usageTotals(store);
  if (t.sessions < cfg.min_sessions || t.days < cfg.min_days || t.seconds < cfg.min_tracked_s) return false;
  const first = store.usage?.firstSeen;
  if (!DATE_KEY.test(first || "") || nowMs - dayMs(first) < cfg.first_week_days * DAY_MS) return false;
  if (DATE_KEY.test(sp.laterOn || "") && nowMs - dayMs(sp.laterOn) < cfg.later_days * DAY_MS) return false;
  return true;
}

/** The card went on screen: counts toward the lifetime maximum. */
export function markSponsorShown(store) {
  if (!(store.sponsor && typeof store.sponsor === "object")) store.sponsor = {};
  const sp = store.sponsor;
  sp.shown = num(sp.shown) + 1;
  return store;
}

/** The card was hidden before the user could answer (they left the frame): give the show back. */
export function refundSponsorShown(store) {
  if (!(store.sponsor && typeof store.sponsor === "object")) store.sponsor = {};
  const sp = store.sponsor;
  sp.shown = Math.max(0, num(sp.shown) - 1);
  return store;
}

/** The user's answer: "later" (comes back after later_days), "never" (permanent). */
export function answerSponsor(store, how, nowMs) {
  if (!(store.sponsor && typeof store.sponsor === "object")) store.sponsor = {};
  const sp = store.sponsor;
  if (how === "never") sp.never = true;
  else if (how === "later") sp.laterOn = dayKey(nowMs);
  return store;
}
