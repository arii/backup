// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// relax.js: neck-ratio geometry, bracing detection and the breath check.

import assert from "node:assert/strict";
import test from "node:test";
import { BracingMonitor, BreathCheck, neckRatio, RELAX } from "../../docs/app/relax.js";

/** Landmarks with ears `neck` above the shoulder line (image units). */
function pose({ neck = 0.12, width = 0.2, cx = 0.5, shoulderY = 0.6, vis = 0.99 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  lm[11] = { x: cx + width / 2, y: shoulderY, visibility: vis };
  lm[12] = { x: cx - width / 2, y: shoulderY, visibility: vis };
  lm[7] = { x: cx + 0.04, y: shoulderY - neck, visibility: vis };
  lm[8] = { x: cx - 0.04, y: shoulderY - neck, visibility: vis };
  return lm;
}

test("neck ratio: positive when relaxed, smaller when shoulders hike, scale-free", () => {
  const relaxed = neckRatio(pose());
  assert.ok(Math.abs(relaxed - 0.6) < 1e-9);
  assert.ok(neckRatio(pose({ neck: 0.09 })) < relaxed);
  assert.ok(Math.abs(neckRatio(pose({ neck: 0.24, width: 0.4 })) - relaxed) < 1e-9);
  assert.equal(neckRatio(pose({ vis: 0.2 })), null);
  assert.equal(neckRatio(null), null);
});

function run(monitor, ratio, t0, seconds, good = true, fps = 10) {
  let fired = 0;
  for (let i = 0; i < seconds * fps; i++) if (monitor.update(ratio, t0 + i / fps, good)) fired += 1;
  return fired;
}

test("bracing: sustained hike below the learned relaxed level fires once", () => {
  const m = new BracingMonitor();
  assert.equal(run(m, 0.6, 0, 60), 0);
  assert.ok(Math.abs(m.reference - 0.6) < 1e-6);
  assert.equal(run(m, 0.6 * 0.8, 60, RELAX.bracing_sustain_s + 5), 1);
  assert.equal(run(m, 0.6 * 0.8, 85, 60), 0, "cooldown holds further reminders");
});

test("bracing: small dips, short shrugs and slouches do not fire", () => {
  const m = new BracingMonitor();
  run(m, 0.6, 0, 60);
  assert.equal(run(m, 0.6 * 0.95, 60, 60), 0, "5% is within noise");
  assert.equal(run(m, 0.6 * 0.7, 120, 10), 0, "a 10 s shrug is not bracing");
  assert.equal(run(m, 0.6, 130, 5), 0);
  assert.equal(run(m, 0.6 * 0.7, 135, 60, false), 0, "only flagged while posture is otherwise good");
});

test("bracing: nothing fires before a relaxed reference exists", () => {
  const m = new BracingMonitor();
  assert.equal(run(m, 0.4, 0, 40), 0);
});

test("bracing: a pinned exhale-and-drop reference is used directly", () => {
  const m = new BracingMonitor();
  m.pinRelaxed(0.7);
  assert.equal(m.reference, 0.7);
  assert.equal(run(m, 0.55, 0, RELAX.bracing_sustain_s + 2), 1);
});

function breath(base, inhale, settle) {
  const b = new BreathCheck();
  b.start(0, base);
  let out = null;
  let exhaled = false;
  for (let i = 1; i <= 100 && !out; i++) {
    const t = i / 10;
    const r = b.update(t < 5 ? inhale : settle, t);
    if (r === "exhale") exhaled = true;
    else if (r) out = r;
  }
  assert.ok(exhaled, "prompts the exhale");
  return out;
}

test("breath check verdicts", () => {
  assert.equal(breath(0.6, 0.53, 0.6).kind, "rose");
  assert.equal(breath(0.6, 0.6, 0.67).kind, "held");
  const ok = breath(0.6, 0.59, 0.61);
  assert.equal(ok.kind, "relaxed");
  assert.ok(Math.abs(ok.relaxed - 0.61) < 1e-9);
  assert.equal(breath(null, 0.6, 0.6).kind, "unclear");
});

test("relaxed flag: null without a reference, true at the reference, false when shoulders are up, null without a reading", () => {
  const m = new BracingMonitor();
  assert.equal(m.relaxed, null);
  run(m, 0.6, 0, 10);
  assert.equal(m.relaxed, null, "no reference after 10 s");
  run(m, 0.6, 10, 60);
  assert.equal(m.relaxed, true);
  run(m, 0.6 * 0.8, 70, 5);
  assert.equal(m.relaxed, false);
  m.update(null, 80, true);
  assert.equal(m.relaxed, null);
  run(m, 0.6, 81, 5);
  m.reset();
  assert.equal(m.relaxed, null);
});
