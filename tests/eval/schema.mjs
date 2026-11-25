// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Labeled-session schema for the accuracy eval (tests/eval/README.md). validateSession
// returns a list of problems, empty when the session is usable. Pure, no I/O.

import { CUE_METRICS } from "../../docs/app/posture-core.js";

export const SCHEMA_VERSION = 1;
const PATHS = ["mediapipe", "movenet"];
const LEGS = ["comfortable", "mid_movement"];
const LABELS = ["good", "slouch", "ignore"];
/** Six tracked points, in this order, each as x, y, confidence: 18 numbers per frame. */
const POINT_ORDER = ["left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_hip", "right_hip"];
const VALUES_PER_FRAME = POINT_ORDER.length * 3;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function checkCalibration(cal, problems) {
  if (cal === null) return;
  if (typeof cal !== "object" || Array.isArray(cal)) return problems.push("calibration must be null or an object");
  if (cal.kind !== "good") problems.push('calibration.kind must be "good"');
  if (!isNum(cal.start_s)) problems.push("calibration.start_s must be a number");
  if (!LEGS.includes(cal.leg)) problems.push(`calibration.leg must be one of ${LEGS.join(", ")}`);
}

function checkLabels(labels, problems) {
  if (!Array.isArray(labels) || labels.length === 0) return problems.push("labels must be a non-empty array");
  let prevEnd = -Infinity;
  for (let i = 0; i < labels.length; i++) {
    const seg = labels[i];
    const at = `labels[${i}]`;
    if (!seg || !isNum(seg.start_s) || !isNum(seg.end_s) || !(seg.end_s > seg.start_s)) {
      return problems.push(`${at}: start_s and end_s must be numbers with end_s > start_s`);
    }
    if (seg.start_s < prevEnd) problems.push(`${at}: segments must be sorted and must not overlap`);
    prevEnd = seg.end_s;
    if (!LABELS.includes(seg.label)) return problems.push(`${at}: label must be one of ${LABELS.join(", ")}`);
    const metrics = seg.metrics ?? [];
    if (!Array.isArray(metrics) || !metrics.every((m) => CUE_METRICS.includes(m))) {
      return problems.push(`${at}: metrics must list names from ${CUE_METRICS.join(", ")}`);
    }
    if (seg.label === "slouch" && metrics.length === 0) problems.push(`${at}: a slouch segment names its metrics`);
    if (seg.label !== "slouch" && metrics.length > 0) problems.push(`${at}: only slouch segments carry metrics`);
  }
}

function checkFrames(frames, problems) {
  if (!Array.isArray(frames) || frames.length === 0) return problems.push("frames must be a non-empty array");
  let prevT = -Infinity;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!Array.isArray(f) || f.length !== 2 || !isNum(f[0])) {
      return problems.push(`frames[${i}] must be [t, points]`);
    }
    if (!(f[0] > prevT)) return problems.push(`frames[${i}]: t must increase strictly`);
    prevT = f[0];
    const p = f[1];
    if (p === null) continue;
    if (!Array.isArray(p) || p.length !== VALUES_PER_FRAME) {
      return problems.push(`frames[${i}]: points must be null or ${VALUES_PER_FRAME} numbers`);
    }
    for (let k = 0; k < p.length; k++) {
      const confidence = k % 3 === 2;
      // null marks a non-finite coordinate (a NaN glitch); confidence is always a number.
      const ok = confidence ? isNum(p[k]) && p[k] >= 0 && p[k] <= 1 : p[k] === null || isNum(p[k]);
      if (!ok) return problems.push(`frames[${i}].points[${k}] is not valid`);
    }
  }
}

export function validateSession(s) {
  const problems = [];
  if (!s || typeof s !== "object" || Array.isArray(s)) return ["session must be an object"];
  if (s.schema_version !== SCHEMA_VERSION) problems.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (typeof s.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(s.id)) problems.push("id must be a file-safe string");
  if (typeof s.synthetic !== "boolean") problems.push("synthetic must be true or false");
  if (!PATHS.includes(s.path)) problems.push(`path must be one of ${PATHS.join(", ")}`);
  if (s.path === "movenet") {
    const fs = s.frame_size;
    if (!fs || !(fs.width > 0) || !(fs.height > 0))
      problems.push("movenet sessions need frame_size {width, height} in pixels");
  }
  if (s.synthetic === false) {
    // Recorded people only enter the repo with their consent (issue #113 privacy rules).
    const c = s.consent;
    if (c?.given !== true || typeof c.participant !== "string" || typeof c.date !== "string") {
      problems.push("recorded sessions need consent {given: true, participant, date}");
    }
  }
  checkCalibration(s.calibration === undefined ? null : s.calibration, problems);
  checkLabels(s.labels, problems);
  checkFrames(s.frames, problems);
  return problems;
}
