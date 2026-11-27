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
  calibrateNote,
  Diagnosis,
  markOnboarded,
  ONBOARDING_STEPS,
  ONBOARDING_VERSION,
  SAFETY_POINTS,
  completeStep,
  nextSetupStep,
  reopenSetupStep,
  SETUP_STEPS,
  setupProgress,
  skipAll,
  skipStep,
  undoStep,
  viewSetupStep,
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

test("one short welcome includes safety without a multi-page walkthrough", () => {
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
  assert.equal(ONBOARDING_STEPS.length, 1);
  assert.ok(ONBOARDING_STEPS[0].points.includes(SAFETY_SHORT));
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

test("setup text: versions stay at 1 so existing seeds keep working, no em dash", () => {
  assert.equal(ONBOARDING_VERSION, 1);
  assert.equal(ACK_VERSION, 1);
  assert.deepEqual(
    SETUP_STEPS.map((x) => [x.title, x.action]),
    [
      ["Head and shoulders in frame", "Continue"],
      ["Sit comfortably", "Save my posture"],
    ],
    "frames 02 and 03: one line and one button each",
  );
  assert.doesNotMatch(JSON.stringify(SETUP_STEPS), /\u2014/);
});

const KEYS = SETUP_STEPS.map((s) => s.key);

test("setup steps: unique keys, framing and calibrate first, stages never go down", () => {
  assert.equal(new Set(KEYS).size, KEYS.length);
  assert.deepEqual(KEYS.slice(0, 2), ["framing", "calibrate"]);
  for (let i = 1; i < SETUP_STEPS.length; i++) assert.ok(SETUP_STEPS[i].stage >= SETUP_STEPS[i - 1].stage);
});

test("nextSetupStep waits for the reveal stage of each step", () => {
  const store = {};
  assert.equal(nextSetupStep(store, 0), null);
  assert.equal(nextSetupStep(store, 1), "framing", "step 1 shows while tracking settles");
  completeStep(store, "framing");
  assert.equal(nextSetupStep(store, 1), null, "step 2 waits for the gauge");
  assert.equal(nextSetupStep(store, 2), "calibrate");
  completeStep(store, "calibrate");
  assert.equal(nextSetupStep(store, 5), null, "settings never become automatic setup tasks");
  assert.equal(reopenSetupStep(store), null, "nothing optional is left in the sequence (#96)");
});

test("undoStep offers a done step again (posture saved only in the demo), but never a skipped one", () => {
  const store = {};
  completeStep(store, "framing");
  completeStep(store, "calibrate");
  assert.equal(store.setupDone, true);
  undoStep(store, "calibrate");
  assert.equal(store.setupDone, false);
  assert.equal(nextSetupStep(store, 2), "calibrate", "the camera session asks for the posture again");
  assert.deepEqual(setupProgress(store).done, ["framing"]);
  const skipped = {};
  skipStep(skipped, "framing");
  skipStep(skipped, "calibrate");
  undoStep(skipped, "calibrate");
  assert.equal(skipped.setupDone, true, "a skip is the person's choice and stays");
  assert.equal(nextSetupStep(skipped, 2), null);
});

test("a skipped step is not offered again on its own but stays reachable", () => {
  const store = {};
  skipStep(store, "framing");
  assert.equal(nextSetupStep(store, 2), "calibrate");
  assert.deepEqual(setupProgress(store).skipped, ["framing"]);
  assert.equal(reopenSetupStep(store), "framing");
  completeStep(store, "framing");
  assert.deepEqual(setupProgress(store).skipped, [], "doing a skipped step marks it done");
  assert.equal(reopenSetupStep(store), "calibrate");
});

test("skipStep never un-does a finished step", () => {
  const store = {};
  completeStep(store, "framing");
  skipStep(store, "framing");
  assert.deepEqual(setupProgress(store), { step: "framing", done: ["framing"], skipped: [] });
});

test("the sequence ends when every step is done or skipped", () => {
  const store = {};
  for (const [i, k] of KEYS.entries()) {
    assert.ok(!store.setupDone, `not done before ${k}`);
    if (i % 2) skipStep(store, k);
    else completeStep(store, k);
  }
  assert.equal(store.setupDone, true);
  assert.equal(store.firstRunDone, true, "kept for older code");
  assert.equal(nextSetupStep(store, 5), null);
  assert.equal(reopenSetupStep(store), KEYS[1], "skipped steps stay reachable from the Set up button");
});

test("skipAll ends the sequence and grants nothing", () => {
  const store = { relaxReminders: true, eyeBreaks: true };
  const before = JSON.stringify(store);
  skipAll(store);
  assert.equal(store.setupDone, true);
  assert.equal(nextSetupStep(store, 5), null);
  assert.equal(store.consent, undefined, "no consent record");
  assert.equal(store.breathingMoments, undefined);
  assert.equal(store.spokenPraise, undefined);
  assert.equal(store.revealAll, undefined);
  const { setup, setupDone, firstRunDone, ...rest } = store;
  assert.equal(JSON.stringify(rest), before, "no setting changed");
  assert.deepEqual(setup.skipped, KEYS);
  assert.deepEqual(setup.done, []);
});

test("skipAll keeps finished steps as done", () => {
  const store = {};
  completeStep(store, "framing");
  skipAll(store);
  assert.deepEqual(setupProgress(store).done, ["framing"]);
  assert.ok(!setupProgress(store).skipped.includes("framing"));
});

test("setupProgress ignores junk in the store", () => {
  assert.deepEqual(setupProgress(null), { step: null, done: [], skipped: [] });
  assert.deepEqual(setupProgress({ setup: { step: "nope", done: "x", skipped: ["framing", 3, "nope"] } }), {
    step: null,
    done: [],
    skipped: ["framing"],
  });
  const store = {};
  viewSetupStep(store, "calibrate");
  assert.equal(setupProgress(store).step, "calibrate");
});

test("calibrateNote tells the person to hold still while recording, and why a save failed", () => {
  const idle = { active: null, remaining_s: null, error: null };
  assert.match(calibrateNote(idle), /hold still for 3 seconds/);
  assert.equal(calibrateNote({ active: "good", remaining_s: 2.2, error: null }), "Hold still… 3");
  assert.equal(calibrateNote({ active: "good", remaining_s: 0.1, error: null }), "Hold still… 1");
  assert.equal(calibrateNote({ active: "good", remaining_s: null, error: null }), "Hold still… 1");
  const failed = { active: null, remaining_s: null, error: "good calibration failed: 0 scored frames" };
  assert.match(calibrateNote(failed, true), /head and shoulders in view/);
  assert.doesNotMatch(calibrateNote(failed, false), /Couldn't save/); // an old error from before this card
});
