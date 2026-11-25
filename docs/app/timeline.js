// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Today's session as coloured runs for the Today panel's timeline (storyboard v3 frame 04,
// #98): green good, amber drifting, red slouching, blue breaks, grey nobody scored. Pure and in
// memory only: nothing here is stored. Time comes from the caller.

export const ZONES = Object.freeze(["good", "drift", "bad", "break", "none"]);

export class SessionTimeline {
  constructor() {
    this.runs = []; // [{ zone, start, end }]
  }

  /** Extend the timeline to `now` in `zone`. Gaps over `gap_s` (a sleeping tab) count as "none". */
  add(zone, now, gap_s = 5) {
    if (!ZONES.includes(zone) || !Number.isFinite(now)) return;
    const last = this.runs[this.runs.length - 1];
    if (last && now < last.end) return; // time never runs backwards
    if (last && now - last.end > gap_s) this.runs.push({ zone: "none", start: last.end, end: now });
    const tail = this.runs[this.runs.length - 1];
    if (tail && tail.zone === zone) tail.end = now;
    else this.runs.push({ zone, start: tail ? tail.end : now, end: now });
  }

  get start() {
    return this.runs.length ? this.runs[0].start : null;
  }

  /** Runs as fractions of the whole session. Runs shorter than `minFraction` merge into their
   *  neighbour, so the bar stays readable after hours of tracking. */
  segments(minFraction = 0.004) {
    const total = this.runs.length ? this.runs[this.runs.length - 1].end - this.runs[0].start : 0;
    if (!(total > 0)) return [];
    const out = [];
    for (const r of this.runs) {
      const f = (r.end - r.start) / total;
      const prev = out[out.length - 1];
      if (prev && (prev.zone === r.zone || f < minFraction)) prev.fraction += f;
      else out.push({ zone: r.zone, fraction: f });
    }
    return out;
  }
}
