// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// tests/eval/schema.mjs: what a labeled session may look like.

import assert from "node:assert/strict";
import test from "node:test";
import { validateSession } from "../eval/schema.mjs";
import { makeSession } from "./eval-support.mjs";

const bad = (patch) => validateSession({ ...makeSession(), ...patch });

test("a well-formed session has no problems", () => {
  assert.deepEqual(validateSession(makeSession()), []);
});

test("rejects non-objects and wrong versions", () => {
  assert.ok(validateSession(null).length);
  assert.ok(bad({ schema_version: 2 }).length);
  assert.ok(bad({ path: "kinect" }).length);
  assert.ok(bad({ id: "has space" }).length);
});

test("movenet sessions need a frame size", () => {
  assert.ok(bad({ path: "movenet" }).length);
  assert.deepEqual(bad({ path: "movenet", frame_size: { width: 640, height: 480 } }), []);
});

test("recorded sessions need consent", () => {
  assert.ok(bad({ synthetic: false }).length);
  assert.ok(bad({ synthetic: false, consent: { given: false, participant: "P1", date: "2026-01-01" } }).length);
  assert.deepEqual(bad({ synthetic: false, consent: { given: true, participant: "P1", date: "2026-01-01" } }), []);
});

test("labels must be sorted, non-overlapping and use engine metric names", () => {
  assert.ok(bad({ labels: [] }).length);
  assert.ok(
    bad({
      labels: [
        { start_s: 5, end_s: 9, label: "good" },
        { start_s: 0, end_s: 4, label: "good" },
      ],
    }).length,
  );
  assert.ok(bad({ labels: [{ start_s: 0, end_s: 4, label: "slouch", metrics: ["posture"] }] }).length);
  assert.ok(bad({ labels: [{ start_s: 0, end_s: 4, label: "slouch" }] }).length);
  assert.ok(bad({ labels: [{ start_s: 0, end_s: 4, label: "good", metrics: ["head_tilt"] }] }).length);
  assert.ok(bad({ labels: [{ start_s: 4, end_s: 4, label: "good" }] }).length);
});

test("calibration needs a known leg", () => {
  assert.deepEqual(bad({ calibration: { kind: "good", start_s: 0, leg: "mid_movement" } }), []);
  assert.ok(bad({ calibration: { kind: "good", start_s: 0, leg: "sloppy" } }).length);
  assert.ok(bad({ calibration: { kind: "bad", start_s: 0, leg: "comfortable" } }).length);
});

test("frames: increasing time, 18 values, null for glitches, confidence in 0..1", () => {
  const ok = makeSession().frames[0][1];
  assert.ok(
    bad({
      frames: [
        [1, ok],
        [1, ok],
      ],
    }).length,
  );
  assert.ok(bad({ frames: [[0, ok.slice(0, 17)]] }).length);
  assert.ok(bad({ frames: [[0, ok.map((v, i) => (i === 2 ? 1.5 : v))]] }).length);
  assert.ok(bad({ frames: [[0, ok.map((v, i) => (i === 2 ? null : v))]] }).length);
  assert.deepEqual(
    bad({
      frames: [
        [0, null],
        [0.5, ok.map((v, i) => (i === 0 ? null : v))],
      ],
    }),
    [],
  );
  assert.ok(bad({ frames: [[0, ok.map((v, i) => (i === 0 ? "x" : v))]] }).length);
});
