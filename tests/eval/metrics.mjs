// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Confusion counts and precision/recall for the accuracy eval. "Positive" is slouching.

import { CUE_METRICS } from "../../docs/app/posture-core.js";

/** One row per metric, then the whole-frame verdicts:
 *  overall       any cue named on the frame
 *  overall_alert the engine's state is a bad state (after its dwell time) */
export const ROWS = [...CUE_METRICS, "overall", "overall_alert"];

export const emptyTally = () => ({ tp: 0, fp: 0, fn: 0, tn: 0 });

export function addOutcome(tally, truth, predicted) {
  if (truth && predicted) tally.tp += 1;
  else if (!truth && predicted) tally.fp += 1;
  else if (truth && !predicted) tally.fn += 1;
  else tally.tn += 1;
}

export function mergeTally(into, other) {
  for (const k of ["tp", "fp", "fn", "tn"]) into[k] += other[k];
  return into;
}

/** null when the ratio is undefined (nothing predicted, or nothing to find). */
export function precisionRecall(t) {
  return {
    precision: t.tp + t.fp > 0 ? t.tp / (t.tp + t.fp) : null,
    recall: t.tp + t.fn > 0 ? t.tp / (t.tp + t.fn) : null,
  };
}

export const emptyRows = () => Object.fromEntries(ROWS.map((r) => [r, emptyTally()]));

/** rows: {row: tally} -> {row: {tp, fp, fn, tn, precision, recall}} */
export function summarizeRows(rows) {
  return Object.fromEntries(ROWS.map((r) => [r, { ...rows[r], ...precisionRecall(rows[r]) }]));
}
