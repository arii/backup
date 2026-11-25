// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// tests/eval/harness.mjs: replays sessions through the real PostureEngine.

import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS } from "../../docs/app/posture-core.js";
import { calibrationCost, evaluate, frameToLandmarks, runSession } from "../eval/harness.mjs";
import { makeSession, pointsFor } from "./eval-support.mjs";

test("a clear slouch is found and good frames are left alone", () => {
  const r = runSession(makeSession());
  assert.equal(r.rows.head_forward.fp, 0);
  assert.equal(r.rows.head_forward.fn, 0);
  assert.ok(r.rows.head_forward.tp > 10);
  assert.ok(r.rows.head_forward.tn > 10);
  assert.equal(r.rows.head_tilt.tp, 0);
  assert.equal(r.frames.unlabeled, 0);
});

test("the overall alert follows the engine's dwell, so it lags the per-frame cue", () => {
  const r = runSession(makeSession());
  assert.ok(r.rows.overall_alert.tp > 0);
  assert.ok(r.rows.overall_alert.fn > 0);
  assert.equal(r.rows.overall.fn, 0);
});

test("thresholds come from the config handed in, not from the harness", () => {
  const lax = { ...DEFAULTS, scoring: { ...DEFAULTS.scoring, head_forward_deg: 80 } };
  const r = runSession(makeSession(), lax);
  assert.equal(r.rows.head_forward.tp, 0);
  assert.ok(r.rows.head_forward.fn > 0);
});

test("ignore segments and unlabeled frames are not scored", () => {
  const s = makeSession({
    labels: [
      { start_s: 0, end_s: 5, label: "ignore" },
      { start_s: 5, end_s: 10, label: "good" },
    ],
  });
  const r = runSession(s);
  assert.equal(r.frames.scored, 10);
  assert.equal(r.frames.unlabeled, 30);
});

test("null frames mean no pose; a null coordinate is a NaN glitch", () => {
  const s = makeSession();
  assert.equal(frameToLandmarks(s, null), null);
  const p = pointsFor(0);
  p[0] = null;
  assert.ok(Number.isNaN(frameToLandmarks(s, p)[7].x));
});

test("movenet points go through the real adapter: pixels normalized, score scaled to visibility", () => {
  const s = makeSession({ path: "movenet", frame_size: { width: 640, height: 480 } });
  const lm = frameToLandmarks(s, [320, 240, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(lm.length, 33);
  assert.equal(lm[7].x, 0.5);
  assert.equal(lm[7].y, 0.5);
  assert.ok(Math.abs(lm[7].visibility - 0.5) < 1e-12);
});

test("calibration starts at start_s and the saved posture is reported", () => {
  const frames = [];
  for (let i = 0; i < 24; i++) frames.push([i * 0.5, pointsFor(0)]);
  const s = makeSession({
    frames,
    calibration: { kind: "good", start_s: 0, leg: "comfortable" },
    labels: [{ start_s: 5, end_s: 12, label: "good" }],
  });
  const r = runSession(s);
  assert.equal(r.leg, "comfortable");
  assert.equal(r.calibration_saved, true);
  assert.equal(runSession(makeSession()).calibration_saved, null);
});

test("evaluate groups by dataset, path and leg, and 'all' sums the legs", () => {
  const base = { dataset: "unit", session: makeSession() };
  const cal = (leg) => ({
    dataset: "unit",
    session: makeSession({ calibration: { kind: "good", start_s: 0, leg } }),
  });
  const { summary } = evaluate([base, cal("comfortable"), cal("mid_movement")]);
  const legs = summary.unit.mediapipe;
  assert.deepEqual(Object.keys(legs).sort(), ["all", "comfortable", "mid_movement", "none"]);
  assert.equal(legs.all.sessions, 3);
  assert.equal(
    legs.all.rows.head_forward.tp,
    legs.none.rows.head_forward.tp + legs.comfortable.rows.head_forward.tp + legs.mid_movement.rows.head_forward.tp,
  );
});

test("calibrationCost is mid_movement minus comfortable, null where undefined", () => {
  const row = (precision, recall) => ({ precision, recall });
  const rows = (p, r) =>
    Object.fromEntries(
      ["head_forward", "head_tilt", "shoulder_level", "trunk_lean", "overall", "overall_alert"].map((k) => [
        k,
        row(p, r),
      ]),
    );
  const summary = {
    unit: {
      mediapipe: { comfortable: { rows: rows(0.9, 0.8) }, mid_movement: { rows: rows(0.6, null) } },
      movenet: { all: { rows: rows(1, 1) } },
    },
  };
  const cost = calibrationCost(summary);
  assert.ok(Math.abs(cost.unit.mediapipe.overall.precision + 0.3) < 1e-12);
  assert.equal(cost.unit.mediapipe.overall.recall, null);
  assert.equal(cost.unit.movenet, undefined);
});
