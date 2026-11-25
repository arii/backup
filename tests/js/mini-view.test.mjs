// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// mini-view.js: one zone per frame for the needle, the label and the skeleton (#97).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  angleTransform,
  gaugeView,
  gaugeZone,
  ZONE_COLOR,
  tileStates,
  ZONE_DEGREES,
  zoneAngle,
  zoneOfAngle,
} from "../../docs/app/mini-view.js";
import { PostureEngine, State, TRACKED } from "../../docs/app/posture-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(path.join(here, "fixtures", "golden-timeline.json"), "utf8"));

function landmarksFrom(encoded) {
  if (encoded === null) return null;
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  TRACKED.forEach((index, i) => {
    const [x, y, v] = encoded[i];
    lm[index] = { x: x === null ? NaN : x, y, visibility: v };
  });
  return lm;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const LABEL_OF = { good: "upright", drift: "drifting", bad: "slouching" };

/** The three signals agree: angle in the zone's arc, label and colour of that zone. */
function assertAgrees(view, where) {
  if (view.zone === "none") return;
  assert.equal(view.label, LABEL_OF[view.zone], `${where} label`);
  assert.equal(view.color, ZONE_COLOR[view.zone], `${where} colour`);
  if (view.angle !== null) assert.equal(zoneOfAngle(view.angle), view.zone, `${where} angle ${view.angle}`);
  if (view.label === "slouching") assert.equal(view.color, ZONE_COLOR.bad, `${where} slouching is red`);
}

test("angle transform about the dial centre", () => {
  assert.equal(angleTransform(0), "rotate(0.0 100 100)");
  assert.equal(angleTransform(112.5), "rotate(112.5 100 100)");
});

test("zones follow the state machine and the slipping hold, not the averaged needle", () => {
  assert.equal(gaugeZone(State.BAD_CHIME, true, false), "bad");
  assert.equal(gaugeZone(State.BAD_VOICE, false, false), "bad", "still bad while nobody is scored");
  assert.equal(gaugeZone(State.GOOD, true, false), "good");
  assert.equal(gaugeZone(State.GOOD, true, true), "drift", "slipping toward the chime is amber");
  assert.equal(gaugeZone(State.NO_PERSON, true, true), "drift", "slipping while settling in is amber too");
  assert.equal(gaugeZone(State.NO_PERSON, true, false), "none", "settling in is grey (frame 02)");
  assert.equal(gaugeZone(State.NO_PERSON, false, false), "none");
});

test("property: every needle value stays inside its zone's arc, monotonic within the zone", () => {
  const rand = rng(97);
  for (const zone of ["good", "drift", "bad"]) {
    const [lo, hi] = ZONE_DEGREES[zone];
    let prev = -Infinity;
    for (const n of Array.from({ length: 500 }, () => rand() * 2 - 1).sort((a, b) => a - b)) {
      const a = zoneAngle(zone, n);
      assert.ok(a > lo && a < hi, `${zone} ${n} -> ${a}`);
      assert.ok(a >= prev);
      prev = a;
      assert.equal(zoneOfAngle(a), zone);
    }
    // Out-of-range input is clamped, not extrapolated out of the arc.
    assert.equal(zoneOfAngle(zoneAngle(zone, 5)), zone);
    assert.equal(zoneOfAngle(zoneAngle(zone, -5)), zone);
  }
});

test("golden timeline: needle, label and skeleton agree on every frame (frame 48 was green while slouching)", () => {
  const engine = new PostureEngine(golden.config);
  let sawBad = 0;
  golden.frames.forEach((frame, i) => {
    if (frame.calibrate) engine.calibration.start(frame.calibrate);
    const out = engine.process(landmarksFrom(frame.pose), frame.t);
    const view = gaugeView(
      out.transition.state,
      out.result.kind === "scored",
      out.hold?.kind === "slipping",
      out.needle,
    );
    assertAgrees(view, `frame ${i} t=${frame.t} state=${out.transition.state}`);
    if (view.zone === "bad") sawBad += 1;
    if (i === 48) {
      // The old mapping, (needle + 1) * 90 degrees, put this reminder frame in the green arc.
      assert.equal(out.transition.state, State.BAD_CHIME);
      assert.equal(zoneOfAngle((out.needle + 1) * 90), "good");
      assert.equal(zoneOfAngle(view.angle), "bad");
    }
  });
  assert.ok(sawBad > 10, "the fixture has a real slouch to check");
});

test("body-part tiles: the cued metric takes the zone colour, others amber only past their threshold", () => {
  const cfg = { head_forward_deg: 8, head_tilt_deg: 8, shoulder_level_deg: 6, trunk_lean_deg: 7 };
  const m = { head_forward_deg: 15, head_tilt_deg: 3, shoulder_level_deg: 2, trunk_lean_deg: 11 };
  assert.deepEqual(tileStates("drift", "head_forward", m, cfg), {
    head_forward: "warn",
    head_tilt: "ok",
    shoulder_level: "ok",
    trunk_lean: "warn",
  });
  assert.equal(tileStates("bad", "head_forward", m, cfg).head_forward, "bad", "frame 06: the cued tile is red");
  assert.equal(tileStates("good", null, { head_forward_deg: 2 }, cfg).head_forward, "ok");
  assert.equal(tileStates("bad", null, {}, cfg).trunk_lean, "ok", "no reading is not a fault");
});
