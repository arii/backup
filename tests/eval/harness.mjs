// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Runs the real PostureEngine over labeled sessions and tallies precision/recall.
// The harness holds no thresholds: it uses the engine's DEFAULTS and reads only what the
// engine reports (the cue's metric name and the state machine's state). Time comes from
// each frame's own timestamp.

import { MOVENET_TO_BLAZEPOSE, movenetToLandmarks } from "../../docs/app/movenet-adapter.js";
import { CUE_METRICS, DEFAULTS, PostureEngine, State, TRACKED } from "../../docs/app/posture-core.js";
import { addOutcome, emptyRows, mergeTally, ROWS, summarizeRows } from "./metrics.mjs";

const LANDMARK_COUNT = 33;
const BAD_STATES = new Set([State.BAD_CHIME, State.BAD_VOICE]);
// Where each tracked point sits in MoveNet's 17-keypoint output.
const MOVENET_SLOT = TRACKED.map((blaze) => MOVENET_TO_BLAZEPOSE.indexOf(blaze));
const NAN_IF_NULL = (v) => (v === null ? Number.NaN : v);

/** One frame's 18 values -> the 33-landmark array the engine reads. null -> no pose. */
export function frameToLandmarks(session, points) {
  if (points === null) return null;
  if (session.path === "movenet") {
    const { width, height } = session.frame_size;
    const keypoints = Array.from({ length: MOVENET_TO_BLAZEPOSE.length }, () => ({ x: 0, y: 0, score: 0 }));
    MOVENET_SLOT.forEach((slot, i) => {
      keypoints[slot] = {
        x: NAN_IF_NULL(points[i * 3]),
        y: NAN_IF_NULL(points[i * 3 + 1]),
        score: points[i * 3 + 2],
      };
    });
    return movenetToLandmarks(keypoints, width, height);
  }
  const lm = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }));
  TRACKED.forEach((index, i) => {
    lm[index] = { x: NAN_IF_NULL(points[i * 3]), y: NAN_IF_NULL(points[i * 3 + 1]), visibility: points[i * 3 + 2] };
  });
  return lm;
}

/** The label segment covering t, or null. Segments are sorted, so one cursor walks them. */
function labelCursor(labels) {
  let i = 0;
  return (t) => {
    while (i < labels.length && t >= labels[i].end_s) i += 1;
    return i < labels.length && t >= labels[i].start_s ? labels[i] : null;
  };
}

/** Replay one session. Returns confusion counts per row and a few coverage numbers. */
export function runSession(session, config = DEFAULTS) {
  const engine = new PostureEngine(config);
  const rows = emptyRows();
  const labelAt = labelCursor(session.labels);
  const cal = session.calibration ?? null;
  let calibrationStarted = false;
  let scored = 0;
  let unlabeled = 0;
  for (const [t, points] of session.frames) {
    if (cal !== null && !calibrationStarted && t >= cal.start_s) {
      engine.calibration.start(cal.kind);
      calibrationStarted = true;
    }
    const out = engine.process(frameToLandmarks(session, points), t);
    const seg = labelAt(t);
    if (seg === null || seg.label === "ignore") {
      unlabeled += 1;
      continue;
    }
    scored += 1;
    const slouch = seg.label === "slouch";
    const named = out.cue === null ? null : out.cue.metric;
    for (const metric of CUE_METRICS)
      addOutcome(rows[metric], slouch && seg.metrics.includes(metric), named === metric);
    addOutcome(rows.overall, slouch, named !== null);
    addOutcome(rows.overall_alert, slouch, BAD_STATES.has(out.transition.state));
  }
  return {
    id: session.id,
    path: session.path,
    leg: cal === null ? "none" : cal.leg,
    rows,
    frames: { scored, unlabeled },
    // The saved posture is what the zero point comes from; a failed save would skew a leg.
    calibration_saved: cal === null ? null : engine.calibration.centroids.good !== null,
  };
}

/** sessions: [{dataset, session}]. Groups by dataset, path and calibration leg ("all" sums the legs). */
export function evaluate(sessions, config = DEFAULTS) {
  const groups = new Map();
  const perSession = [];
  for (const { dataset, session } of sessions) {
    const r = runSession(session, config);
    perSession.push({
      dataset,
      id: r.id,
      path: r.path,
      leg: r.leg,
      frames: r.frames,
      calibration_saved: r.calibration_saved,
    });
    for (const leg of [r.leg, "all"]) {
      const key = `${dataset}\u0000${r.path}\u0000${leg}`;
      if (!groups.has(key)) groups.set(key, { dataset, path: r.path, leg, sessions: 0, rows: emptyRows() });
      const g = groups.get(key);
      g.sessions += 1;
      for (const row of ROWS) mergeTally(g.rows[row], r.rows[row]);
    }
  }
  const summary = {};
  for (const g of groups.values()) {
    summary[g.dataset] ??= {};
    summary[g.dataset][g.path] ??= {};
    summary[g.dataset][g.path][g.leg] = { sessions: g.sessions, rows: summarizeRows(g.rows) };
  }
  return { summary, sessions: perSession };
}

/** How much a mid-movement calibration costs: its precision/recall minus the comfortable one's. */
export function calibrationCost(summary) {
  const out = {};
  for (const [dataset, paths] of Object.entries(summary)) {
    for (const [path, legs] of Object.entries(paths)) {
      const good = legs.comfortable;
      const bad = legs.mid_movement;
      if (!good || !bad) continue;
      out[dataset] ??= {};
      out[dataset][path] = Object.fromEntries(
        ROWS.map((row) => {
          const delta = (k) =>
            good.rows[row][k] === null || bad.rows[row][k] === null ? null : bad.rows[row][k] - good.rows[row][k];
          return [row, { precision: delta("precision"), recall: delta("recall") }];
        }),
      );
    }
  }
  return out;
}
