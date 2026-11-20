// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// onboarding.js: versioned acknowledgement, safety text and the setup check.

import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS, Reason } from "../../docs/app/posture-core.js";
import {
  ACK_VERSION,
  Diagnosis,
  markOnboarded,
  ONBOARDING_STEPS,
  ONBOARDING_VERSION,
  SAFETY_POINTS,
  COACH_INTRO,
  DONE_INTRO,
  SAFETY_SHORT,
  SETUP,
  SetupCheck,
  shouldShowOnboarding,
  needsAckOnly,
} from "../../docs/app/onboarding.js";

const FPS = 15;
/** Feed `seconds` of identical frames at 15 fps starting at t0; returns the last result. */
function feed(check, frame, t0, seconds) {
  let out;
  for (let i = 0; i <= seconds * FPS; i++) out = check.update({ fps: 15, ...frame }, t0 + i / FPS);
  return out;
}
const GOOD = { reason: null, state: "good", metricsPresent: true };

test("onboarding is shown to a new store and not after markOnboarded", () => {
  assert.equal(shouldShowOnboarding({}), true);
  assert.equal(shouldShowOnboarding(null), true);
  assert.equal(shouldShowOnboarding({ onboarded: "x", ackVersion: NaN }), true);
  const s = markOnboarded({});
  assert.deepEqual([s.onboarded, s.ackVersion], [ONBOARDING_VERSION, ACK_VERSION]);
  assert.equal(shouldShowOnboarding(s), false);
});

test("a higher ACK_VERSION re-asks for every existing store, ack step only", () => {
  const old = { onboarded: ONBOARDING_VERSION, ackVersion: ACK_VERSION - 1 };
  assert.equal(shouldShowOnboarding(old), true);
  assert.equal(needsAckOnly(old), true);
  assert.equal(needsAckOnly({}), false);
  assert.equal(needsAckOnly(markOnboarded({})), false);
});

test("safety text carries the required phrases and the third step is the notice", () => {
  const all = SAFETY_POINTS.join(" ").toLowerCase();
  for (const phrase of [
    "not medical advice",
    "not a medical device",
    "rigid posture",
    "pain, numbness",
    "dizziness",
    "clinician",
    "spine",
    "approximate",
    "not uploaded",
    "as-is",
    "mit license",
  ])
    assert.ok(all.includes(phrase), phrase);
  assert.ok(/medical advice/.test(SAFETY_SHORT) && /rigid posture/.test(SAFETY_SHORT));
  assert.equal(ONBOARDING_STEPS.length, 3);
  assert.equal(ONBOARDING_STEPS[2].points, SAFETY_POINTS);
});

test("no diagnosis is reported before the fault has persisted", () => {
  const c = new SetupCheck();
  const early = feed(c, { reason: Reason.NO_POSE, state: "no_person" }, 0, SETUP.persist_s - 0.5);
  assert.equal(early.diagnosis, Diagnosis.CHECKING);
  const late = feed(c, { reason: Reason.NO_POSE, state: "no_person" }, SETUP.persist_s - 0.5, 1);
  assert.equal(late.diagnosis, Diagnosis.NO_PERSON);
  assert.ok(late.fixes.length >= 2);
});

test("each reason maps to its diagnosis", () => {
  const cases = [
    [Reason.NO_POSE, Diagnosis.NO_PERSON],
    [Reason.FRAMING_OUT_OF_BAND, Diagnosis.FRAMING],
    [Reason.LOW_VISIBILITY, Diagnosis.LIGHT],
  ];
  for (const [reason, want] of cases) {
    const out = feed(new SetupCheck(), { reason, state: "unreliable" }, 0, SETUP.persist_s + 1);
    assert.equal(out.diagnosis, want, reason);
    assert.ok(out.fixes.length >= 2, reason);
  }
});

test("low fps is reported only when it persists and only below the threshold", () => {
  const c = new SetupCheck();
  let out;
  for (let i = 0; i <= (SETUP.persist_s + 1) * 4; i++) out = c.update({ ...GOOD, fps: 5 }, i / 4);
  assert.equal(out.diagnosis, Diagnosis.LOW_FPS);
  const fine = feed(new SetupCheck(), { ...GOOD, fps: SETUP.low_fps }, 0, SETUP.ok_s + 1);
  assert.equal(fine.diagnosis, Diagnosis.OK);
});

test("ok needs ok_s seconds of good frames", () => {
  const c = new SetupCheck();
  assert.notEqual(feed(c, GOOD, 0, SETUP.ok_s - 0.5).diagnosis, Diagnosis.OK);
  assert.equal(feed(c, GOOD, SETUP.ok_s - 0.5, 1).diagnosis, Diagnosis.OK);
  assert.deepEqual(c.current(100).fixes, []);
});

test("a short glitch does not leave ok, and a recovered fault clears after ok_s", () => {
  const c = new SetupCheck();
  feed(c, GOOD, 0, 10);
  const blip = feed(c, { reason: Reason.LOW_VISIBILITY, state: "unreliable" }, 10, SETUP.persist_s - 1);
  assert.equal(blip.diagnosis, Diagnosis.OK);
  feed(c, GOOD, 10 + SETUP.persist_s, 1); // candidate flips back before the fault was reported
  const fault = feed(c, { reason: Reason.LOW_VISIBILITY, state: "unreliable" }, 20, SETUP.persist_s + 1);
  assert.equal(fault.diagnosis, Diagnosis.LIGHT);
  assert.equal(feed(c, GOOD, 30, SETUP.ok_s - 1).diagnosis, Diagnosis.LIGHT);
  assert.equal(feed(c, GOOD, 40, SETUP.ok_s + 1).diagnosis, Diagnosis.OK);
});

test("non-finite glitch frames change nothing, not even the timers", () => {
  const c = new SetupCheck();
  feed(c, { reason: Reason.NO_POSE, state: "no_person" }, 0, 2);
  for (let i = 0; i < 100; i++) c.update({ reason: Reason.NON_FINITE, state: "unreliable", fps: 15 }, 2 + i * 0.1);
  const out = c.update({ reason: Reason.NO_POSE, state: "no_person", fps: 15 }, SETUP.persist_s + 0.1);
  assert.equal(out.diagnosis, Diagnosis.NO_PERSON, "the fault clock kept running through the glitches");
});

test("the framing advice follows the configured shoulder band", () => {
  const out = feed(new SetupCheck(), { reason: Reason.FRAMING_OUT_OF_BAND, state: "unreliable" }, 0, 5);
  const text = out.fixes.join(" ");
  assert.ok(text.includes(`${Math.round(DEFAULTS.scoring.shoulder_width_min * 100)}%`));
  assert.ok(text.includes(`${Math.round(DEFAULTS.scoring.shoulder_width_max * 100)}%`));
});

test("first-run coach and done text: versions stay at 1 so existing seeds keep working", () => {
  assert.equal(ONBOARDING_VERSION, 1);
  assert.equal(ACK_VERSION, 1);
  assert.match(COACH_INTRO, /Reminders & sounds/);
  for (const re of [/Leave this tab open/, /Pause any time/, /silent test/, /share/]) assert.match(DONE_INTRO, re);
  assert.doesNotMatch(`${COACH_INTRO} ${DONE_INTRO}`, /\u2014/); // no em dash
});
