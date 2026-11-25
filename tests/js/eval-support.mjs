// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Shared builders for the eval tests: tiny hand-made sessions the engine can score.

// Six tracked points for a given head-forward angle (deg); everything else upright and level.
export function pointsFor(headForwardDeg = 0, { conf = 0.95, hips = true } = {}) {
  const neck = 0.18;
  const a = (headForwardDeg * Math.PI) / 180;
  const ex = 0.5 + neck * Math.sin(a);
  const ey = 0.5 - neck * Math.cos(a);
  const hipConf = hips ? conf : 0.1;
  return [
    ex - 0.05,
    ey,
    conf,
    ex + 0.05,
    ey,
    conf,
    0.4,
    0.5,
    conf,
    0.6,
    0.5,
    conf,
    0.42,
    0.9,
    hipConf,
    0.58,
    0.9,
    hipConf,
  ];
}

export function makeSession(overrides = {}) {
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push([i * 0.5, pointsFor(0)]);
  for (let i = 20; i < 40; i++) frames.push([i * 0.5, pointsFor(25)]);
  return {
    schema_version: 1,
    id: "unit-session",
    synthetic: true,
    path: "mediapipe",
    calibration: null,
    labels: [
      { start_s: 0, end_s: 10, label: "good" },
      { start_s: 10, end_s: 20, label: "slouch", metrics: ["head_forward"] },
    ],
    frames,
    ...overrides,
  };
}
