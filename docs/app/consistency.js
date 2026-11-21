// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Weekly consistency score for the opt-in share link. Pure, no DOM, no network.
// Deliberately not dominated by good %: it needs active days, a relaxed-shoulder
// share and breaks, and good % counts at most 90 so rigid posture earns nothing
// extra. Untracked time scores zero. See .kiro/specs/progress-review/design.md.

export const CONSISTENCY = Object.freeze({
  active_day_s: 20 * 60, // a day counts as active from 20 tracked minutes
  max_active_days: 5,
  good_cap_pct: 90, // 90% and 100% score the same
  breaks_per_day: 3,
  max_tracked_per_day_s: 10 * 3600, // a day's tracked time counts at most 10 h
  weights: Object.freeze({ days: 0.35, good: 0.25, relax: 0.2, breaks: 0.2 }),
});

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

/** @param {{days: {tracked_s:number, good_s:number, relaxed_s?:number, breaks?:number}[]}} week
 *  Returns a whole number 0..100. */
export function consistencyScore(week, cfg = CONSISTENCY) {
  const list = Array.isArray(week?.days) ? week.days : [];
  let tracked = 0;
  let good = 0;
  let relaxed = 0;
  let breaks = 0;
  let active = 0;
  for (const d of list) {
    const t = Math.min(num(d?.tracked_s), cfg.max_tracked_per_day_s);
    if (t <= 0) continue;
    const scale = t / num(d.tracked_s);
    tracked += t;
    good += Math.min(num(d.good_s), num(d.tracked_s)) * scale;
    relaxed += Math.min(num(d.relaxed_s), num(d.good_s)) * scale;
    breaks += Math.floor(num(d.breaks));
    if (t >= cfg.active_day_s) active++;
  }
  const activeDays = Math.min(active, cfg.max_active_days);
  if (activeDays === 0 || tracked <= 0) return 0;
  const w = cfg.weights;
  const goodBand = Math.min((100 * good) / tracked, cfg.good_cap_pct) / cfg.good_cap_pct;
  const relaxBand = Math.min(1, relaxed / tracked);
  const breakBand = Math.min(breaks, cfg.breaks_per_day * activeDays) / (cfg.breaks_per_day * activeDays);
  const score =
    100 *
    (w.days * (activeDays / cfg.max_active_days) + w.good * goodBand + w.relax * relaxBand + w.breaks * breakBand);
  return Math.round(Math.min(100, Math.max(0, score)));
}
