// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// The PR gate: compares eval numbers with the committed baseline, and says which changed
// files should trigger an eval run.

export const FLOAT_NOISE = 1e-9;

/** Changes to these paths (a trailing / means a whole folder) must run the eval.
 *  posture-core.js has no imports; movenet-adapter.js shapes the landmarks the MoveNet
 *  path feeds it. The rest is the eval itself: code, data, baseline, CI wiring. */
export const EVAL_TRIGGER_PATHS = [
  "docs/app/posture-core.js",
  "docs/app/movenet-adapter.js",
  "tests/eval/",
  "scripts/eval-accuracy.mjs",
  "scripts/gen-eval-data.mjs",
  ".github/workflows/ci.yml",
];

export function evalTriggered(changed) {
  return changed.some((f) => EVAL_TRIGGER_PATHS.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)));
}

/** summary -> Map "dataset/path/leg/row/(precision|recall)" -> number | null */
export function flatten(summary) {
  const out = new Map();
  for (const [dataset, paths] of Object.entries(summary)) {
    for (const [path, legs] of Object.entries(paths)) {
      for (const [leg, group] of Object.entries(legs)) {
        for (const [row, v] of Object.entries(group.rows)) {
          out.set(`${dataset}/${path}/${leg}/${row}/precision`, v.precision);
          out.set(`${dataset}/${path}/${leg}/${row}/recall`, v.recall);
        }
      }
    }
  }
  return out;
}

/** Fails (regressions) when any baseline number drops by more than float noise, or is gone.
 *  A number that is undefined now but was defined in the baseline counts as a drop. */
export function compare(baseline, current, tolerance = FLOAT_NOISE) {
  const base = flatten(baseline);
  const now = flatten(current);
  const regressions = [];
  const improvements = [];
  for (const [key, was] of base) {
    if (was === null) continue;
    if (!now.has(key)) {
      regressions.push({ key, baseline: was, current: null, reason: "missing" });
      continue;
    }
    const is = now.get(key);
    if (is === null || is < was - tolerance) regressions.push({ key, baseline: was, current: is, reason: "dropped" });
    else if (is > was + tolerance) improvements.push({ key, baseline: was, current: is });
  }
  return { regressions, improvements };
}
