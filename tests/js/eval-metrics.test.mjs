// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// tests/eval/metrics.mjs: confusion counts, precision and recall.

import assert from "node:assert/strict";
import test from "node:test";
import {
  addOutcome,
  emptyRows,
  emptyTally,
  mergeTally,
  precisionRecall,
  ROWS,
  summarizeRows,
} from "../eval/metrics.mjs";
import { CUE_METRICS } from "../../docs/app/posture-core.js";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("rows use the engine's metric names, then the two overall rows", () => {
  assert.deepEqual(ROWS, [...CUE_METRICS, "overall", "overall_alert"]);
});

test("addOutcome fills the four cells", () => {
  const t = emptyTally();
  addOutcome(t, true, true);
  addOutcome(t, false, true);
  addOutcome(t, true, false);
  addOutcome(t, false, false);
  addOutcome(t, false, false);
  assert.deepEqual(t, { tp: 1, fp: 1, fn: 1, tn: 2 });
});

test("precision and recall of a worked example", () => {
  assert.deepEqual(precisionRecall({ tp: 6, fp: 2, fn: 3, tn: 50 }), { precision: 0.75, recall: 6 / 9 });
});

test("undefined ratios are null, not 0 or NaN", () => {
  assert.deepEqual(precisionRecall({ tp: 0, fp: 0, fn: 4, tn: 1 }), { precision: null, recall: 0 });
  assert.deepEqual(precisionRecall({ tp: 0, fp: 3, fn: 0, tn: 1 }), { precision: 0, recall: null });
});

test("property: random outcomes keep precision and recall in 0..1 and merge to the sum", () => {
  const next = rng(113);
  for (let n = 0; n < 200; n++) {
    const a = emptyTally();
    const b = emptyTally();
    const all = emptyTally();
    for (let i = 0; i < 60; i++) {
      const truth = next() < 0.4;
      const pred = next() < 0.5;
      addOutcome(i % 2 ? a : b, truth, pred);
      addOutcome(all, truth, pred);
    }
    const merged = mergeTally(emptyTally(), a);
    mergeTally(merged, b);
    assert.deepEqual(merged, all);
    const { precision, recall } = precisionRecall(all);
    for (const v of [precision, recall]) assert.ok(v === null || (v >= 0 && v <= 1));
  }
});

test("summarizeRows adds precision and recall to every row", () => {
  const rows = emptyRows();
  addOutcome(rows.head_tilt, true, true);
  const s = summarizeRows(rows);
  assert.equal(s.head_tilt.precision, 1);
  assert.equal(s.head_tilt.recall, 1);
  assert.equal(s.trunk_lean.precision, null);
  assert.deepEqual(Object.keys(s), ROWS);
});
