// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// demo-pose.js: the scripted demo, replayed through the engine exactly as the app runs it.

import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_CYCLE_S, demoPose, practicePose } from "../../docs/app/demo-pose.js";
import { gaugeView, ZONE_COLOR, zoneOfAngle } from "../../docs/app/mini-view.js";
import { DEFAULTS, PostureEngine, State, scorePose } from "../../docs/app/posture-core.js";

test("the demo alternates good and slouch every cycle", () => {
  const head = (t) => demoPose(t)[7].y;
  assert.ok(head(DEMO_CYCLE_S + 1) > head(1), "the head drops in the slouch half");
  assert.equal(head(2 * DEMO_CYCLE_S + 1).toFixed(3), head(1).toFixed(3));
});

test("demo replay at 15 fps: gauge, label and skeleton agree through slouch onset and recovery", () => {
  const engine = new PostureEngine(DEFAULTS);
  engine.setDriftBaselineEnabled(false); // as app.js does for the synthetic demo
  const seen = new Set();
  let prev = null;
  let recoveries = 0;
  for (let t = 0; t < 4 * DEMO_CYCLE_S; t += 1 / 15) {
    const out = engine.process(demoPose(t), t);
    const view = gaugeView(
      out.transition.state,
      out.result.kind === "scored",
      out.hold?.kind === "slipping",
      out.needle,
    );
    const where = `t=${t.toFixed(2)} ${out.transition.state}`;
    if (view.zone !== "none" && view.angle !== null) assert.equal(zoneOfAngle(view.angle), view.zone, where);
    if (view.label === "slouching") assert.equal(view.color, ZONE_COLOR.bad, where);
    if (view.zone === "good") assert.equal(view.color, ZONE_COLOR.good, where);
    // Amber exactly while the fill runs toward the chime (frame 05), never amber without it.
    if (view.zone !== "bad") assert.equal(view.zone === "drift", out.hold?.kind === "slipping", where);
    if (prev === State.BAD_CHIME || prev === State.BAD_VOICE) {
      if (out.transition.state === State.GOOD) recoveries += 1;
    }
    prev = out.transition.state;
    seen.add(view.zone);
  }
  assert.ok(seen.has("good") && seen.has("drift") && seen.has("bad"), [...seen].join());
  assert.ok(recoveries >= 1, "the replay covers a recovery");
});

test("Learn the cues poses show only the taught fault, at any demo time (#103)", () => {
  const cfg = DEFAULTS.scoring;
  const keys = ["head_forward", "head_tilt", "shoulder_level", "trunk_lean"];
  for (const t of [1, DEMO_CYCLE_S + 5, 3 * DEMO_CYCLE_S + 2]) {
    for (const metric of [null, ...keys]) {
      const m = scorePose(practicePose(metric, t), cfg);
      for (const k of keys) {
        const v = Math.abs(m[`${k}_deg`]);
        if (k === metric) assert.ok(v > cfg[`${k}_deg`], `${metric} at ${t}: ${v}`);
        else assert.ok(v < cfg[`${k}_deg`] - cfg.hysteresis_margin_deg, `${metric} at ${t}: ${k} ${v}`);
      }
    }
  }
});
