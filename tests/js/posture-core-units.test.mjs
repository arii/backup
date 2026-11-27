// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Example-based tests for the browser core: scoring, state machine, needle,
// calibration and cues. Expected angles are precomputed constants (not derived
// with the code's own helpers) so a formula regression is caught.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULTS,
  Nudge,
  PostureEngine,
  PostureStateMachine,
  Reason,
  State,
  CalibrationRecorder,
  NeedleSmoother,
  LEFT_EAR,
  LEFT_HIP,
  LEFT_SHOULDER,
  RIGHT_EAR,
  RIGHT_HIP,
  RIGHT_SHOULDER,
  calibratedNeedle,
  clamp,
  lowVisibilityDetail,
  mirrorSign,
  postureCue,
  postureZero,
  rawNeedle,
  scorePose,
  scored,
  thresholdNeedle,
  unreliable,
  zoneOf,
} from "../../docs/app/posture-core.js";

const CFG = DEFAULTS.scoring;
const near = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

function pose(overrides = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  const set = (i, x, y) => {
    lm[i] = { x, y, visibility: 1 };
  };
  set(LEFT_SHOULDER, 0.4, 0.6);
  set(RIGHT_SHOULDER, 0.6, 0.6);
  set(LEFT_EAR, 0.46, 0.45);
  set(RIGHT_EAR, 0.54, 0.45);
  set(LEFT_HIP, 0.44, 0.9);
  set(RIGHT_HIP, 0.56, 0.9);
  for (const [i, v] of Object.entries(overrides)) lm[i] = { visibility: 1, ...v };
  return lm;
}

const mirror = (lm) => lm.map((p) => ({ ...p, x: 1 - p.x }));

const SLOUCHED = pose({ [LEFT_EAR]: { x: 0.48, y: 0.54 }, [RIGHT_EAR]: { x: 0.56, y: 0.54 } });
const LEANING = pose({
  [LEFT_SHOULDER]: { x: 0.45, y: 0.6 },
  [RIGHT_SHOULDER]: { x: 0.65, y: 0.6 },
  [LEFT_EAR]: { x: 0.51, y: 0.45 },
  [RIGHT_EAR]: { x: 0.59, y: 0.45 },
});
const TILTED = pose({ [LEFT_EAR]: { x: 0.45, y: 0.46 }, [RIGHT_EAR]: { x: 0.55, y: 0.44 } });
const UNEVEN = pose({
  [RIGHT_SHOULDER]: { x: 0.6, y: 0.62 },
  [LEFT_EAR]: { x: 0.46, y: 0.46 },
  [RIGHT_EAR]: { x: 0.54, y: 0.46 },
});

// -- scoring ------------------------------------------------------------------

test("each metric reads its precomputed angle", () => {
  const good = scorePose(pose(), CFG);
  for (const k of ["head_forward_deg", "trunk_lean_deg", "head_tilt_deg", "shoulder_level_deg"]) near(good[k], 0);
  near(scorePose(SLOUCHED, CFG).head_forward_deg, 18.4349488);
  near(scorePose(LEANING, CFG).trunk_lean_deg, 9.4623222);
  near(scorePose(TILTED, CFG).head_tilt_deg, 11.3099325);
  const uneven = scorePose(UNEVEN, CFG);
  near(uneven.shoulder_level_deg, 5.7105931);
  near(uneven.head_tilt_deg, 5.7105931);
});

test("zones: good, bad and the hysteresis band", () => {
  assert.equal(zoneOf(scorePose(pose(), CFG), CFG), "good");
  assert.equal(zoneOf(scorePose(SLOUCHED, CFG), CFG), "bad");
  // 5.7 deg is under the 6 deg enter threshold and over the 3 deg exit.
  assert.equal(zoneOf(scorePose(UNEVEN, CFG), CFG), "neutral");
});

test("unreliable results: no pose, low visibility, framing", () => {
  assert.equal(scorePose(null, CFG).reason, Reason.NO_POSE);
  const cropped = pose({ [RIGHT_SHOULDER]: { x: 0.6, y: 0.6, visibility: 0.1 } });
  const res = scorePose(cropped, CFG);
  assert.equal(res.reason, Reason.LOW_VISIBILITY);
  assert.match(res.detail, /shoulders not visible \(right 0\.10\)/);
  assert.equal(res.detail, lowVisibilityDetail(cropped, CFG));
  const narrow = pose({ [LEFT_SHOULDER]: { x: 0.48, y: 0.6 }, [RIGHT_SHOULDER]: { x: 0.52, y: 0.6 } });
  const far = scorePose(narrow, CFG);
  assert.equal(far.reason, Reason.FRAMING_OUT_OF_BAND);
  assert.match(far.detail, /^too far/);
  const wide = pose({ [LEFT_SHOULDER]: { x: 0.1, y: 0.6 }, [RIGHT_SHOULDER]: { x: 0.9, y: 0.6 } });
  assert.match(scorePose(wide, CFG).detail, /^too close/);
});

test("low visibility detail joins groups and flags trunk lean for hips", () => {
  const lm = pose();
  lm[LEFT_EAR].visibility = 0.2;
  lm[LEFT_HIP].visibility = 0.3;
  assert.equal(
    lowVisibilityDetail(lm, CFG),
    "ears not visible (left 0.20); hips not visible (left 0.30) - trunk lean unavailable",
  );
});

test("hidden hips degrade to head metrics, or gate when degraded feedback is off", () => {
  const hidden = pose();
  hidden[LEFT_HIP].visibility = 0.1;
  hidden[RIGHT_HIP].visibility = 0.1;
  const res = scorePose(hidden, CFG);
  assert.equal(res.kind, "scored");
  assert.equal(res.trunk_lean_available, false);
  assert.equal(scorePose(hidden, { ...CFG, degraded_feedback: false }).reason, Reason.LOW_VISIBILITY);
  assert.equal(scorePose(hidden, { ...CFG, trunk_lean_required: false, degraded_feedback: false }).kind, "scored");
});

test("hidden hip garbage cannot decide the zone", () => {
  const lm = pose({
    [LEFT_HIP]: { x: 0.9, y: 0.2, visibility: 0.1 },
    [RIGHT_HIP]: { x: 0.1, y: 0.2, visibility: 0.1 },
  });
  const res = scorePose(lm, CFG);
  assert.equal(res.trunk_lean_available, false);
  assert.equal(zoneOf(res, CFG), "good");
});

test("partial visibility reaches bad through the head metrics", () => {
  const lm = SLOUCHED.map((p) => ({ ...p }));
  lm[LEFT_HIP].visibility = 0.1;
  lm[RIGHT_HIP].visibility = 0.1;
  assert.equal(zoneOf(scorePose(lm, CFG), CFG), "bad");
});

test("ears or shoulders below the floor still gate", () => {
  for (const i of [LEFT_EAR, RIGHT_EAR, LEFT_SHOULDER, RIGHT_SHOULDER]) {
    const lm = pose();
    lm[i].visibility = 0.2;
    assert.equal(scorePose(lm, { ...CFG, degraded_feedback: true }).reason, Reason.LOW_VISIBILITY);
  }
});

test("non-finite input never yields a score", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    for (const i of [LEFT_EAR, RIGHT_SHOULDER]) {
      const lm = pose();
      lm[i].x = bad;
      assert.equal(scorePose(lm, CFG).reason, Reason.NON_FINITE);
    }
  }
  const nanHip = pose();
  nanHip[LEFT_HIP].y = NaN;
  assert.equal(scorePose(nanHip, CFG).trunk_lean_available, false);
  assert.equal(scorePose(nanHip, { ...CFG, degraded_feedback: false }).reason, Reason.NON_FINITE);
  const nanVis = pose();
  nanVis[LEFT_EAR].visibility = NaN;
  assert.equal(scorePose(nanVis, CFG).reason, Reason.LOW_VISIBILITY);
  const huge = pose({ [LEFT_EAR]: { x: 1e308, y: -1e308 }, [RIGHT_EAR]: { x: -1e308, y: 1e308 } });
  const res = scorePose(huge, { ...CFG, shoulder_width_min: 0, shoulder_width_max: Infinity });
  if (res.kind === "scored") {
    for (const k of ["head_forward_deg", "head_tilt_deg", "shoulder_level_deg"]) assert.ok(Number.isFinite(res[k]));
  }
});

test("mirrored framing: shoulder sign and angles survive x -> 1 - x", () => {
  near(scorePose(mirror(pose()), CFG).shoulder_level_deg, 0);
  assert.equal(zoneOf(scorePose(mirror(pose()), CFG), CFG), "good");
  // Right shoulder lower (larger y) reads positive in either orientation.
  near(scorePose(mirror(UNEVEN), CFG).shoulder_level_deg, 5.7105931);
  near(Math.abs(scorePose(mirror(TILTED), CFG).head_tilt_deg), 11.3099325);
  const slouch = scorePose(mirror(SLOUCHED), CFG);
  near(Math.abs(slouch.head_forward_deg), 18.4349488);
  assert.ok(Math.abs(scorePose(mirror(LEANING), CFG).trunk_lean_deg) < 180);
  near(Math.abs(scorePose(mirror(LEANING), CFG).trunk_lean_deg), 9.4623222);
});

// -- state machine --------------------------------------------------------------

const machine = (over = {}, voiceTimings = null) =>
  new PostureStateMachine({ ...DEFAULTS.state, ...over }, CFG, DEFAULTS.feedback, voiceTimings);
const GOOD = scored({ head_forward_deg: 0, trunk_lean_deg: 0, head_tilt_deg: 0, shoulder_level_deg: 0 });
const BAD = scored({ head_forward_deg: 18, trunk_lean_deg: 0, head_tilt_deg: 0, shoulder_level_deg: 0 });
const NEUTRAL = scored({ head_forward_deg: 0, trunk_lean_deg: 0, head_tilt_deg: 0, shoulder_level_deg: 4.5 });
const NO_POSE = unreliable(Reason.NO_POSE);

/** Feed `result` every `dt` seconds from `from` to `to` inclusive; collect nudges by time. */
function run(sm, result, from, to, dt = 0.1) {
  const out = [];
  for (let t = from; t <= to + 1e-9; t += dt) {
    const tr = sm.update(typeof result === "function" ? result(t) : result, t);
    if (tr.nudge !== Nudge.NONE) out.push([Math.round(t * 1000) / 1000, tr.nudge]);
  }
  return out;
}

test("good confirms after good_confirm_s, a single bad frame does not leave it", () => {
  const sm = machine({}, null);
  run(sm, GOOD, 0, 0.5);
  assert.notEqual(sm.state, State.GOOD);
  run(sm, GOOD, 0.6, 2);
  assert.equal(sm.state, State.GOOD);
  assert.equal(sm.update(BAD, 2.1).state, State.GOOD);
});

test("chime after bad_sustain_s, voice after voice_delay_s, repeat each cooldown", () => {
  const sm = machine();
  run(sm, GOOD, 0, 2);
  const out = run(sm, BAD, 2.1, 60, 0.1);
  const chimes = out.filter(([, n]) => n === Nudge.CHIME);
  const voices = out.filter(([, n]) => n === Nudge.VOICE).map(([t]) => t);
  assert.equal(chimes.length, 1);
  assert.ok(chimes[0][0] >= 2.1 + 2 - 1e-6 && chimes[0][0] <= 2.1 + 2.3);
  assert.ok(voices[0] - chimes[0][0] >= DEFAULTS.state.voice_delay_s - 1e-6);
  near(voices[0] - chimes[0][0], DEFAULTS.state.voice_delay_s, 0.2);
  assert.ok(voices[1] - voices[0] >= DEFAULTS.state.voice_repeat_cooldown_s - 1e-6);
});

test("recovery needs recovery_good_s of good and is flagged on one frame only", () => {
  const sm = machine();
  run(sm, GOOD, 0, 2);
  run(sm, BAD, 2.1, 6);
  assert.equal(sm.state, State.BAD_CHIME);
  const flags = [];
  for (let t = 6.1; t <= 14; t += 0.1) {
    const tr = sm.update(GOOD, t);
    if (tr.recovered) flags.push(t);
  }
  assert.equal(flags.length, 1);
  assert.ok(flags[0] >= 6.1 + DEFAULTS.state.recovery_good_s - 0.3);
  assert.equal(sm.state, State.GOOD);
});

test("the hysteresis band holds the bad state", () => {
  const sm = machine();
  run(sm, GOOD, 0, 2);
  run(sm, BAD, 2.1, 5);
  run(sm, NEUTRAL, 5.1, 20);
  assert.ok([State.BAD_CHIME, State.BAD_VOICE].includes(sm.state));
});

test("voice timings override changes the next nudge only", () => {
  let timings = [3, 5];
  const sm = machine({}, () => timings);
  run(sm, GOOD, 0, 2);
  const out = run(sm, BAD, 2.1, 12, 0.1);
  const chimeAt = out.find(([, n]) => n === Nudge.CHIME)[0];
  const voiceAt = out.find(([, n]) => n === Nudge.VOICE)[0];
  near(voiceAt - chimeAt, 3, 0.2);
  timings = [3, 20];
  const later = run(sm, BAD, 12.1, 40, 0.1).filter(([, n]) => n === Nudge.VOICE);
  assert.ok(later.length <= 2);
});

test("low visibility is silent and resets the bad streak", () => {
  const sm = machine();
  run(sm, GOOD, 0, 2);
  run(sm, BAD, 2.1, 3);
  assert.equal(sm.update(unreliable(Reason.LOW_VISIBILITY, "x"), 3.1).state, State.UNRELIABLE);
  const out = run(sm, BAD, 3.2, 4.5);
  assert.equal(out.length, 0);
});

test("no pose times out to no_person and cancels pending voice", () => {
  const sm = machine();
  run(sm, GOOD, 0, 2);
  run(sm, BAD, 2.1, 5);
  assert.equal(sm.state, State.BAD_CHIME);
  assert.equal(sm.update(NO_POSE, 5.1).state, State.BAD_CHIME);
  assert.equal(sm.update(NO_POSE, 5.1 + DEFAULTS.state.no_person_timeout_s).state, State.NO_PERSON);
  const out = run(sm, NO_POSE, 8, 30);
  assert.equal(out.length, 0);
});

test("tracked pose outside the framing band or low visibility never reaches no_person", () => {
  for (const r of [unreliable(Reason.FRAMING_OUT_OF_BAND, "too far"), unreliable(Reason.LOW_VISIBILITY, "x")]) {
    const sm = machine();
    run(sm, GOOD, 0, 2);
    run(sm, r, 2.1, 30);
    assert.equal(sm.state, State.UNRELIABLE);
  }
});

test("a person returning from no_person is confirmed good again", () => {
  const sm = machine();
  run(sm, GOOD, 0, 2);
  run(sm, NO_POSE, 2.1, 6);
  assert.equal(sm.state, State.NO_PERSON);
  run(sm, GOOD, 6.1, 8);
  assert.equal(sm.state, State.GOOD);
});

test("glitch frames hold good, keep the bad streak and keep the baseline", () => {
  const glitch = unreliable(Reason.NON_FINITE);
  const sm = machine();
  run(sm, GOOD, 0, 2);
  assert.equal(sm.update(glitch, 2.05).state, State.GOOD);
  const bad = run(sm, (t) => (Math.round(t * 10) % 3 === 0 ? glitch : BAD), 2.1, 4.5);
  assert.ok(
    bad.some(([, n]) => n === Nudge.CHIME),
    "glitches did not reset the bad streak",
  );
  const before = sm.baseline.metrics;
  sm.update(glitch, 5);
  assert.equal(sm.baseline.metrics, before);
});

test("moving further from level than the slow baseline breaches while raw angles stay under the threshold", () => {
  const sm = machine();
  sm.setBaselineAnchor(metrics(0, 0, 0, -2));
  const worse = metrics(0, 0, 0, 4.5); // 6.5 degrees from the baseline, further from level
  assert.equal(zoneOf(worse, CFG), "neutral");
  const out = run(sm, worse, 0, 5);
  assert.ok(out.some(([, n]) => n === Nudge.CHIME));
  const plain = machine();
  assert.equal(run(plain, worse, 0, 5).length, 0);
});

test("moving back toward level from the slow baseline never breaches (#97)", () => {
  const sm = machine();
  sm.setBaselineAnchor(metrics(-9));
  assert.equal(run(sm, GOOD, 0, 5).length, 0);
  assert.equal(sm.state, State.GOOD);
});

test("#97: minutes at -5 degree shoulders, then a level 2.9 degree pose is good and has no cue", () => {
  const sm = machine();
  run(sm, metrics(0, 0, 0, -5), 0, 600, 0.5); // the baseline drifts to about -5
  assert.ok(sm.baseline.metrics.shoulder_level_deg < -4.5, "the baseline drifted");
  const level = metrics(0, 0, 0, 2.9);
  const out = run(sm, level, 600, 620, 0.1);
  assert.equal(out.filter(([, n]) => n === Nudge.CHIME || n === Nudge.VOICE).length, 0, "no reminder for a level pose");
  assert.equal(sm.state, State.GOOD);
  assert.equal(postureCue(level, CFG, sm.baseline.metrics), null, "no 'Shoulders uneven'");
});

test("property: no baseline history makes a level pose (every |angle| < 3) read bad or get a cue", () => {
  let seed = 97;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const any = (span) => (rnd() * 2 - 1) * span;
  for (let trial = 0; trial < 200; trial++) {
    const sm = machine();
    let t = 0;
    for (let k = 0; k < 20; k++) {
      const m = metrics(any(30), any(30), any(30), any(30));
      run(sm, m, t, t + 5 + rnd() * 60, 0.5);
      t += 70;
    }
    const level = metrics(any(2.9), any(2.9), any(2.9), any(2.9));
    const ref = sm.baseline.metrics;
    run(sm, level, t, t + 10, 0.1);
    assert.notEqual(sm.history.at(-1)[1], "bad", `trial ${trial}: zone`);
    assert.equal(postureCue(level, CFG, ref), null, `trial ${trial}: cue`);
  }
});

test("a drift baseline seeded from a slouch no longer traps the machine in bad (#67)", () => {
  // The demo alternates a fixed good pose and a fixed slouch pose. Pressing
  // its button during the slouch half seeds the drift baseline from a slouch
  // frame. Sitting up moves back toward level, which never counts against the
  // baseline (#97), so the machine recovers.
  const seeded = machine();
  run(seeded, BAD, 0, 5); // demo's slouch pose is what tracking sees first
  assert.equal(seeded.state, State.BAD_CHIME);
  run(seeded, GOOD, 5.1, 12); // demo's good pose, well past recovery_good_s
  assert.equal(seeded.state, State.GOOD);

  // The demo disables the drift baseline, so absolute angles classify it and
  // the same sequence recovers as soon as the good pose is held.
  const fixed = machine();
  fixed.setDriftBaselineEnabled(false);
  assert.equal(fixed.baseline, null);
  run(fixed, BAD, 0, 5);
  assert.equal(fixed.state, State.BAD_CHIME);
  run(fixed, GOOD, 5.1, 9);
  assert.equal(fixed.state, State.GOOD);
});

test("setDriftBaselineEnabled re-enables from scoring config and re-applies calibration", () => {
  const engine = new PostureEngine();
  engine.setDriftBaselineEnabled(false);
  assert.equal(engine.machine.baseline, null);
  engine.setDriftBaselineEnabled(true);
  assert.ok(engine.machine.baseline !== null);
  engine.machine.baseline.setAnchor(GOOD);
  run(engine.machine, BAD, 0, 3); // updates the EMA away from the anchor
  engine.setDriftBaselineEnabled(false);
  engine.setDriftBaselineEnabled(true); // a fresh baseline, not the drifted one
  assert.ok(engine.machine.baseline !== null);
});

test("baseline anchor survives no_person and feature off restores plain behavior", () => {
  const sm = machine();
  sm.setBaselineAnchor(GOOD);
  run(sm, NO_POSE, 0, 4);
  assert.deepEqual(sm.baseline.metrics, GOOD);
  const off = new PostureStateMachine(
    DEFAULTS.state,
    { ...CFG, baseline_deviation: { enabled: false, window_s: 300 } },
    DEFAULTS.feedback,
  );
  assert.equal(off.baseline, null);
  run(off, GOOD, 0, 2);
  assert.equal(off.state, State.GOOD);
});

test("good confirmation and slouch chime work at low frame rates", () => {
  for (const fps of [2, 5, 10, 30]) {
    const sm = machine();
    run(sm, GOOD, 0, 3, 1 / fps);
    assert.equal(sm.state, State.GOOD, `${fps} fps good`);
    const out = run(sm, BAD, 3 + 1 / fps, 8, 1 / fps);
    assert.ok(
      out.some(([, n]) => n === Nudge.CHIME),
      `${fps} fps chime`,
    );
  }
});

test("positive chime fires after sustained good, spaces out, and stays off when disabled", () => {
  const sm = machine();
  const out = run(sm, GOOD, 0, 200, 0.5)
    .filter(([, n]) => n === Nudge.POSITIVE_CHIME)
    .map(([t]) => t);
  assert.ok(out.length >= 2);
  assert.ok(out[0] >= 15 * 0.75 - 1e-6, `first praise at ${out[0]}`);
  assert.ok(out[1] - out[0] >= out[0] - 1e-6);
  const off = new PostureStateMachine(DEFAULTS.state, CFG, {
    ...DEFAULTS.feedback,
    positive_chime: { ...DEFAULTS.feedback.positive_chime, enabled: false },
  });
  assert.equal(run(off, GOOD, 0, 200, 0.5).length, 0);
});

test("a bad episode or unreliable frames restart the praise interval", () => {
  const sm = machine();
  run(sm, GOOD, 0, 10, 0.5);
  run(sm, BAD, 10.5, 14);
  assert.ok([State.BAD_CHIME, State.BAD_VOICE].includes(sm.state));
  run(sm, GOOD, 14.1, 20);
  assert.equal(sm.state, State.GOOD);
  assert.ok(sm.goodStateSince >= 14);
});

// -- needle -----------------------------------------------------------------------

const metrics = (head = 0, trunk = 0, tilt = 0, level = 0, ok = true) =>
  scored({
    head_forward_deg: head,
    trunk_lean_deg: trunk,
    head_tilt_deg: tilt,
    shoulder_level_deg: level,
    trunk_lean_available: ok,
  });

test("threshold needle: upright -1, every metric at threshold +1, unavailable trunk skipped", () => {
  assert.equal(thresholdNeedle(metrics(), CFG), -1);
  const at = metrics(CFG.head_forward_deg, CFG.trunk_lean_deg, CFG.head_tilt_deg, CFG.shoulder_level_deg);
  assert.equal(thresholdNeedle(at, CFG), 1);
  const noTrunk = metrics(CFG.head_forward_deg, 99, 0, 0, false);
  near(thresholdNeedle(noTrunk, CFG), 2 / 3 - 1, 1e-12);
  assert.equal(thresholdNeedle(metrics(NaN), CFG), null);
});

test("calibrated needle maps centroids to -1, 0, +1 and clamps beyond", () => {
  const cal = { good: metrics(), bad: metrics(10, 0, 0, 0) };
  assert.equal(calibratedNeedle(metrics(), cal), -1);
  assert.equal(calibratedNeedle(metrics(10), cal), 1);
  assert.equal(calibratedNeedle(metrics(5), cal), 0);
  assert.equal(calibratedNeedle(metrics(30), cal), 1);
  assert.equal(calibratedNeedle(metrics(5), { good: metrics(), bad: metrics() }), null);
  // Identical centroids fall back to thresholds through rawNeedle.
  assert.equal(rawNeedle(metrics(), CFG, { good: metrics(), bad: metrics() }), -1);
});

test("clamp maps NaN to the low end", () => {
  assert.equal(clamp(NaN), -1);
  assert.equal(clamp(5), 1);
  assert.equal(clamp(-5), -1);
});

test("smoother: first sample as is, exact exponential step, frame-rate independent, holds on bad input", () => {
  const s = new NeedleSmoother({ tau_s: 0.5 });
  assert.equal(s.update(0.4, 0), 0.4);
  const v = s.update(1, 0.5);
  near(v, 1 - Math.exp(-1) + Math.exp(-1) * 0.4, 1e-12);
  const one = new NeedleSmoother({ tau_s: 0.5 });
  const many = new NeedleSmoother({ tau_s: 0.5 });
  one.update(-1, 0);
  many.update(-1, 0);
  one.update(1, 1);
  for (let i = 1; i <= 10; i += 1) many.update(1, i / 10);
  near(one.value, many.value, 1e-12);
  const held = many.value;
  for (const [raw, t] of [
    [null, 2],
    [NaN, 3],
    [0, 0.5],
  ])
    assert.equal(many.update(raw, t), held);
  const instant = new NeedleSmoother({ tau_s: 0 });
  instant.update(-1, 0);
  assert.equal(instant.update(0.7, 0.1), 0.7);
});

test("baseline decay is exponential and ignores an unavailable trunk", () => {
  const sm = machine();
  sm.setBaselineAnchor(metrics(0, 4, 0, 0));
  sm.baseline.update(metrics(10, 0, 0, 0, false), 0);
  sm.baseline.update(metrics(10, 0, 0, 0, false), 60);
  const alpha = 1 - Math.exp(-60 / CFG.baseline_deviation.window_s);
  near(sm.baseline.metrics.head_forward_deg, 10 * alpha, 1e-9);
  assert.equal(sm.baseline.metrics.trunk_lean_deg, 4);
});

// -- calibration ------------------------------------------------------------------

test("calibration records nothing until started, then produces centroids", () => {
  const rec = new CalibrationRecorder(DEFAULTS.calibration);
  for (let t = 0; t < 5; t += 0.2) rec.feed(metrics(3), t);
  assert.equal(rec.centroids.good, null);
  rec.start("good");
  assert.equal(rec.status.remaining_s, DEFAULTS.calibration.window_s);
  for (let t = 10; t <= 10 + 3.2; t += 0.2) rec.feed(metrics(2, 1, 0.5, 0.25), t);
  assert.equal(rec.status.active, null);
  near(rec.centroids.good.head_forward_deg, 2);
  rec.start("bad");
  for (let t = 20; t <= 23.2; t += 0.2) rec.feed(metrics(12), t);
  assert.ok(rec.calibration !== null);
  assert.equal(rec.status.calibrated, true);
});

test("a recording taken while moving into a posture is rejected, a steady one is kept", () => {
  const rec = new CalibrationRecorder(DEFAULTS.calibration);
  rec.start("good");
  for (let t = 0; t <= 3.2; t += 0.2) rec.feed(metrics(t * 4), t); // 0 to ~13 degrees across the window
  assert.equal(rec.centroids.good, null);
  assert.match(rec.status.error, /moved while it was recording/);
  assert.equal(rec.status.error_kind, "moved");
  rec.start("good");
  for (let t = 10; t <= 13.2; t += 0.2) rec.feed(metrics(2 + 0.4 * Math.sin(t * 7)), t); // small jitter
  assert.equal(rec.status.error, null);
  near(rec.centroids.good.head_forward_deg, 2, 0.5);
});

test("a rejected moving recording keeps the previously saved posture", () => {
  const rec = new CalibrationRecorder(DEFAULTS.calibration);
  rec.start("good");
  for (let t = 0; t <= 3.2; t += 0.2) rec.feed(metrics(2), t);
  const saved = rec.centroids.good;
  const version = rec.version;
  rec.start("good");
  for (let t = 10; t <= 13.2; t += 0.2) rec.feed(metrics((t - 10) * 4), t);
  assert.equal(rec.centroids.good, saved);
  assert.equal(rec.version, version);
  assert.equal(rec.status.error_kind, "moved");
  rec.start("good");
  assert.equal(rec.status.error_kind, null);
});

test("a noisier detector gets a wider drift limit", () => {
  const drifting = (rec) => {
    rec.start("good");
    for (let t = 0; t <= 3.2; t += 0.2) rec.feed(metrics(t * 2), t); // about 3.2 deg between halves
    return rec;
  };
  assert.equal(drifting(new CalibrationRecorder(DEFAULTS.calibration)).status.error, null);
  const strict = new CalibrationRecorder({ ...DEFAULTS.calibration, max_drift_deg: 1.0 });
  assert.equal(drifting(strict).status.error_kind, "moved");
  const noisy = new CalibrationRecorder({ ...DEFAULTS.calibration, max_drift_deg: 1.0, max_drift_deg_noisy: 7.0 });
  noisy.useNoisyDetector(true);
  assert.equal(drifting(noisy).status.error, null);
  noisy.useNoisyDetector(false);
  assert.equal(drifting(noisy).status.error_kind, "moved");
});

// Motion robustness of the drift gate: which shapes of movement inside the 3 s window are kept or rejected.
function record(shape, noiseSd = 0) {
  let a = 12345; // small seeded generator, never Math.random
  const rnd = () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296 - 0.5;
  };
  const rec = new CalibrationRecorder(DEFAULTS.calibration);
  rec.start("good");
  for (let i = 0; i <= 16; i++) {
    const t = i * 0.2;
    rec.feed(metrics(shape(t) + noiseSd * 3.46 * rnd()), t);
  }
  return rec;
}

test("drift gate: a sustained step in the middle of the window is rejected", () => {
  assert.equal(record((t) => (t < 1.5 ? 0 : 12)).status.error_kind, "moved");
});

test("drift gate: settling before the window and then holding still is kept (sudden lean already done)", () => {
  const rec = record(() => 12);
  assert.equal(rec.status.error, null);
  near(rec.centroids.good.head_forward_deg, 12, 1e-6);
});

test("drift gate: a one-frame tracking spike is kept, and moves the average by under 3 degrees", () => {
  const rec = record((t) => (Math.abs(t - 1.6) < 0.01 ? 30 : 2));
  assert.equal(rec.status.error, null);
  assert.ok(Math.abs(rec.centroids.good.head_forward_deg - 2) < 3);
});

test("drift gate: plain landmark noise of 2 degrees is kept", () => {
  assert.equal(record(() => 5, 2).status.error, null);
});

test("drift gate: a slow sway around one posture is kept; a fast steady slide is rejected; a slow one passes (known gap)", () => {
  assert.equal(record((t) => 5 + 2 * Math.sin(t * 4)).status.error, null);
  assert.equal(record((t) => t * 5).status.error_kind, "moved"); // 5 deg/s
  assert.equal(record((t) => t * 3).status.error, null); // known gap: a slide under about 3.5 deg/s passes the limit
});

test("too few scored frames is reported as unseen, not moved", () => {
  const rec = new CalibrationRecorder(DEFAULTS.calibration);
  rec.start("good");
  for (let t = 0; t <= 3.5; t += 0.2) rec.feed(unreliable(Reason.NO_POSE), t);
  assert.equal(rec.status.error_kind, "unseen");
});

test("motion limit is judged per metric: one wandering metric rejects the recording", () => {
  const rec = new CalibrationRecorder(DEFAULTS.calibration);
  rec.start("bad");
  for (let t = 0; t <= 3.2; t += 0.2) rec.feed(metrics(12, (t % 1) * 20, 0, 0), t);
  assert.equal(rec.centroids.bad, null);
  assert.match(rec.status.error, /bad calibration rejected/);
});

test("calibration progress is reported while recording", () => {
  const rec = new CalibrationRecorder(DEFAULTS.calibration);
  rec.start("good");
  rec.feed(metrics(), 0);
  rec.feed(metrics(), 1);
  near(rec.status.remaining_s, 2);
  assert.equal(rec.status.active, "good");
});

test("unreliable frames are skipped and too few samples fail", () => {
  const rec = new CalibrationRecorder(DEFAULTS.calibration);
  rec.start("good");
  for (let t = 0; t <= 3.5; t += 0.2) rec.feed(unreliable(Reason.NO_POSE), t);
  assert.match(rec.status.error, /good calibration failed: 0 scored frames/);
  assert.equal(rec.centroids.good, null);
});

test("trunk is unavailable when hips are mostly hidden; identical recordings report an error; reset clears", () => {
  const rec = new CalibrationRecorder(DEFAULTS.calibration);
  rec.start("good");
  for (let t = 0; t <= 3.2; t += 0.2) rec.feed(metrics(0, 5, 0, 0, t < 1), t);
  assert.equal(rec.centroids.good.trunk_lean_available, false);
  rec.start("bad");
  for (let t = 10; t <= 13.2; t += 0.2) rec.feed(metrics(0, 5, 0, 0, t < 11), t);
  assert.match(rec.status.error, /identical/);
  rec.reset();
  assert.equal(rec.calibration, null);
  assert.equal(rec.status.error, null);
  assert.equal(rec.counts.good, 0);
});

test("engine anchors the baseline to the recorded good posture", () => {
  const engine = new PostureEngine(DEFAULTS);
  engine.calibration.start("good");
  for (let t = 0; t <= 3.4; t += 0.2) engine.process(SLOUCHED, t);
  near(engine.machine.baseline.metrics.head_forward_deg, 18.4349488);
});

// -- cues --------------------------------------------------------------------------

test("upright pose has no cue; jitter on an upright pose has none either", () => {
  assert.equal(postureCue(scorePose(pose(), CFG), CFG), null);
  assert.equal(postureCue(metrics(1, 1, 1, 1), CFG), null);
});

test("head forward, tilt, shoulder and trunk cues name the right metric", () => {
  assert.equal(postureCue(scorePose(SLOUCHED, CFG), CFG).id, "head_forward:-");
  assert.equal(postureCue(scorePose(TILTED, CFG), CFG, null, mirrorSign(TILTED)).metric, "head_tilt");
  assert.equal(postureCue(scorePose(LEANING, CFG), CFG, null, mirrorSign(LEANING)).metric, "trunk_lean");
  const uneven = postureCue(metrics(0, 0, 0, 20), CFG);
  assert.equal(uneven.id, "shoulder_level:right");
  assert.equal(postureCue(metrics(0, 0, 0, -20), CFG).id, "shoulder_level:left");
  for (const c of [uneven, postureCue(metrics(18), CFG)]) {
    assert.ok(c.title && c.fix && c.say);
  }
});

test("the metric furthest past its band wins", () => {
  // head_forward 10/8 = 1.25 vs shoulder_level 7.8/6 = 1.3
  assert.equal(postureCue(metrics(10, 0, 0, 7.8), CFG).metric, "shoulder_level");
  assert.equal(postureCue(metrics(10, 0, 0, 7), CFG).metric, "head_forward");
});

test("drift away from the baseline is reported with its own sign; back toward level is not; trunk ignored without hips", () => {
  const cue = postureCue(metrics(0, 0, 0, 4), CFG, metrics(0, 0, 0, -3));
  assert.equal(cue.metric, "shoulder_level");
  assert.equal(cue.side, "right");
  assert.equal(postureCue(metrics(0, 0, 0, 0), CFG, metrics(0, 0, 0, -10)), null);
  assert.equal(postureCue(metrics(0, 40, 0, 0, false), CFG), null);
});

test("a cue names a metric only past its threshold on that frame, and goes when it is back in range (#97)", () => {
  // 7 degrees is inside the hysteresis band (exit 5, threshold 8): no cue.
  assert.equal(postureCue(metrics(7), CFG), null);
  assert.equal(postureCue(metrics(8.5), CFG).metric, "head_forward");
  assert.equal(postureCue(metrics(0, 0, 0, 5.9), CFG), null, "5.9 degree shoulders are not 'uneven'");
});

// -- zero point (the saved good posture) -------------------------------------------

test("postureZero caps each metric at its threshold and drops an unavailable trunk", () => {
  const z = postureZero(metrics(10, 3, -2, 20, false), CFG);
  assert.deepEqual(z, { head_forward_deg: 8, head_tilt_deg: -2, shoulder_level_deg: 6, trunk_lean_deg: 0 });
  assert.equal(postureZero(null, CFG), null);
});

/** An engine with a saved good posture; the zero applies on the next frame. */
function calibratedAt(good) {
  const e = new PostureEngine();
  e.calibration.load({ good, good_samples: 10 });
  e.process(null, -1);
  return e;
}

test("after saving a posture 10 degrees off (camera to one side), sitting that way is good; 10 more reminds", () => {
  const saved = metrics(10);
  const e = calibratedAt(saved);
  const out = run(e.machine, saved, 0, 60);
  assert.ok(!out.some(([, n]) => n === Nudge.CHIME), "no reminder at the saved posture");
  assert.equal(e.machine.state, State.GOOD);
  assert.equal(postureCue(saved, CFG, null, 1, e.machine.activeZero), null);
  assert.equal(postureCue(metrics(20), CFG, null, 1, e.machine.activeZero).metric, "head_forward");
  const slouch = run(e.machine, metrics(20), 60, 66);
  assert.ok(
    slouch.some(([, n]) => n === Nudge.CHIME),
    "a real slouch past the saved posture still reminds",
  );
  // Without the zero the saved posture itself is past the 8 degree threshold.
  assert.ok(run(machine(), saved, 0, 6).some(([, n]) => n === Nudge.CHIME));
});

test("a slouch saved by mistake hides at most one threshold of it", () => {
  const e = calibratedAt(metrics(30));
  assert.equal(e.machine.activeZero.head_forward_deg, CFG.head_forward_deg);
  const out = run(e.machine, metrics(30), 0, 6);
  assert.ok(out.some(([, n]) => n === Nudge.CHIME));
});

test("the engine reports metrics from the zero point, and the demo (drift baseline off) ignores it", () => {
  const e = calibratedAt(metrics(6, 0, 2, 0));
  const out = e.process(pose(), 0.1);
  near(out.relative.head_forward_deg, -6);
  near(out.relative.head_tilt_deg, -2);
  e.setDriftBaselineEnabled(false);
  assert.equal(e.machine.activeZero, null);
  near(e.process(pose(), 0.2).relative.head_forward_deg, 0);
  e.setDriftBaselineEnabled(true);
  assert.equal(e.machine.activeZero.head_forward_deg, 6);
  assert.equal(e.hold(pose(), 0.3).relative, null);
});

// -- hold (activities that suppress posture feedback) -------------------------

test("hold scores presence only and emits nothing while a bad pose streams", () => {
  const e = new PostureEngine();
  for (let t = 0; t < 5; t += 0.2) e.process(pose(), t); // settle into GOOD
  const before = {
    state: e.machine.state,
    badSince: e.machine.badSince,
    history: e.machine.history.slice(),
    needle: e.needle.value,
  };
  let nudges = 0;
  let out;
  for (let t = 5; t < 305; t += 0.2) {
    out = e.hold(SLOUCHED, t);
    nudges += out.nudges.length;
    assert.equal(out.held, true);
    assert.equal(out.cue, null);
    assert.equal(out.hold, null);
    assert.equal(out.transition.nudge, Nudge.NONE);
    assert.equal(out.transition.state, before.state);
    assert.equal(out.needle, before.needle);
  }
  assert.equal(nudges, 0);
  assert.equal(out.result.kind, "scored");
  assert.equal(e.machine.state, before.state);
  assert.equal(e.machine.badSince, before.badSince);
  assert.deepEqual(e.machine.history, before.history);
  assert.equal(e.needle.value, before.needle);
});

test("hold reports absence as an unreliable no-pose result", () => {
  const e = new PostureEngine();
  const out = e.hold(null, 1);
  assert.equal(out.result.kind, "unreliable");
  assert.equal(out.result.reason, Reason.NO_POSE);
});

test("after restart a bad pose needs bad_sustain_s before a reminder", () => {
  const e = new PostureEngine();
  for (let t = 0; t < 5; t += 0.2) e.process(pose(), t);
  for (let t = 5; t < 65; t += 0.2) e.hold(SLOUCHED, t);
  e.restart();
  const need = DEFAULTS.state.bad_sustain_s;
  let first = null;
  for (let t = 65; t < 80; t += 0.1) {
    const out = e.process(SLOUCHED, t);
    if (first === null && out.nudges.length) first = t;
  }
  assert.ok(first !== null, "a reminder eventually fires");
  assert.ok(first - 65 >= need - 0.2, `reminder at +${(first - 65).toFixed(1)} s, need >= ${need}`);
});
