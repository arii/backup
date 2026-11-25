// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// tests/eval/gate.mjs and report.mjs: the PR gate, its trigger paths, and the PR-body table.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compare, EVAL_TRIGGER_PATHS, evalTriggered, FLOAT_NOISE, flatten } from "../eval/gate.mjs";
import { formatBaselineDiff, formatCost, formatTable } from "../eval/report.mjs";
import { ROWS } from "../eval/metrics.mjs";

const rows = (precision, recall) =>
  Object.fromEntries(ROWS.map((r) => [r, { tp: 1, fp: 0, fn: 0, tn: 0, precision, recall }]));
const summary = (precision, recall) => ({
  synthetic: { mediapipe: { all: { sessions: 1, rows: rows(precision, recall) } } },
});

test("identical numbers pass", () => {
  const r = compare(summary(0.9, 0.8), summary(0.9, 0.8));
  assert.deepEqual(r, { regressions: [], improvements: [] });
});

test("a drop in any precision or recall fails, and names the number", () => {
  const r = compare(summary(0.9, 0.8), summary(0.9, 0.79));
  assert.equal(r.regressions.length, ROWS.length);
  assert.equal(r.regressions[0].key, "synthetic/mediapipe/all/" + ROWS[0] + "/recall");
});

test("float noise below 1e-9 is allowed, a drop above it is not", () => {
  assert.equal(compare(summary(0.9, 0.8), summary(0.9 - FLOAT_NOISE / 2, 0.8)).regressions.length, 0);
  assert.ok(compare(summary(0.9, 0.8), summary(0.9 - FLOAT_NOISE * 10, 0.8)).regressions.length > 0);
});

test("an improvement passes and is reported", () => {
  const r = compare(summary(0.9, 0.8), summary(0.95, 0.8));
  assert.equal(r.regressions.length, 0);
  assert.equal(r.improvements.length, ROWS.length);
});

test("a number that became undefined, or a group that vanished, fails", () => {
  assert.ok(compare(summary(0.9, 0.8), summary(null, 0.8)).regressions.length > 0);
  assert.equal(compare(summary(0.9, 0.8), {}).regressions[0].reason, "missing");
});

test("a baseline number that was undefined is not gated", () => {
  assert.equal(compare(summary(null, null), summary(0.1, 0.1)).regressions.length, 0);
});

test("flatten keys read dataset/path/leg/row/measure", () => {
  const f = flatten(summary(0.5, 0.25));
  assert.equal(f.get("synthetic/mediapipe/all/overall/precision"), 0.5);
  assert.equal(f.get("synthetic/mediapipe/all/overall/recall"), 0.25);
});

test("scoring, adapter, eval and CI files trigger the eval; unrelated files do not", () => {
  for (const f of [
    "docs/app/posture-core.js",
    "docs/app/movenet-adapter.js",
    "tests/eval/baseline.json",
    "tests/eval/data/synthetic/syn-mediapipe-00-comfortable.json",
    "tests/eval/harness.mjs",
    "scripts/eval-accuracy.mjs",
    ".github/workflows/ci.yml",
  ]) {
    assert.ok(evalTriggered([f]), f);
  }
  for (const f of [
    "README.md",
    "docs/app/app.js",
    "docs/app/relax.js",
    "tests/js/posture-core.test.mjs",
    "tests/evaluation.md",
  ]) {
    assert.ok(!evalTriggered([f]), f);
  }
  assert.ok(evalTriggered(["README.md", "docs/app/posture-core.js"]));
  assert.ok(!evalTriggered([]));
});

test("every trigger path exists in the repo", () => {
  for (const p of EVAL_TRIGGER_PATHS) {
    assert.doesNotThrow(
      () => readFileSync(new URL(`../../${p.endsWith("/") ? p + "README.md" : p}`, import.meta.url)),
      p,
    );
  }
});

test("the committed baseline has numbers for every row of every group it records", () => {
  const baseline = JSON.parse(readFileSync(new URL("../eval/baseline.json", import.meta.url), "utf8"));
  const f = flatten(baseline.summary);
  for (const path of ["mediapipe", "movenet"]) {
    for (const leg of ["comfortable", "mid_movement", "all"]) {
      for (const row of ROWS) assert.ok(f.has(`synthetic/${path}/${leg}/${row}/recall`), `${path}/${leg}/${row}`);
    }
  }
});

test("the before/after table lists only what changed", () => {
  assert.equal(formatBaselineDiff(summary(0.9, 0.8), summary(0.9, 0.8)), "No numbers changed.");
  const t = formatBaselineDiff(summary(0.9, 0.8), summary(0.95, 0.8));
  assert.match(t, /\| number \| before \| after \|/);
  assert.match(t, /overall\/precision \| 90.0% \| 95.0% \|/);
  assert.doesNotMatch(t, /overall\/recall/);
});

test("the console tables name every row", () => {
  const table = formatTable(summary(0.9, 0.8));
  for (const r of ROWS) assert.match(table, new RegExp(r));
  assert.match(table, /calibration: all/);
  assert.match(
    formatCost({ synthetic: { movenet: Object.fromEntries(ROWS.map((r) => [r, { precision: -0.1, recall: null }])) } }),
    /-10.0 pts/,
  );
});
