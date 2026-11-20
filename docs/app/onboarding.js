// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// First-run onboarding, the safety notice and the setup check. Pure (no DOM,
// injected clock) like relax.js, so it is unit-tested in
// tests/js/onboarding.test.mjs. See .kiro/specs/onboarding-and-setup and
// .kiro/specs/safety-and-disclaimers.
//
// SetupCheck turns the engine's per-frame failure reasons into a diagnosis
// with plain-language fixes, but only once a fault has lasted a few seconds,
// so a blink or a head turn does not flash a warning.

import { DEFAULTS, Reason } from "./posture-core.js";

export const ONBOARDING_VERSION = 1; // bump to show the whole walkthrough again
export const ACK_VERSION = 1; // bump to ask for the safety acknowledgement again

export const SETUP = Object.freeze({
  persist_s: 4, // a fault must last this long before it is reported
  ok_s: 5, // good frames needed before "ok" is reported
  low_fps: 8, // below this, tracking is too choppy to trust
});

/** The safety text, written once. Static pages carry copies of it. This is a
 *  draft for review by counsel, not legal advice. */
export const SAFETY_SHORT =
  "Posture Guard is a wellness tool, not medical advice or a medical device. " +
  "Do not hold a rigid posture. Stop and see a clinician if you have pain, numbness or dizziness.";

export const SAFETY_POINTS = Object.freeze([
  "Posture Guard is a wellness tool. It is not medical advice and not a medical device, " +
    "and it does not diagnose, treat or prevent any condition.",
  "Do not hold a rigid posture. Relax your shoulders and change position often. " +
    "Reminders are not a substitute for regular movement breaks.",
  "Stop and see a qualified clinician if you feel pain, numbness, tingling or dizziness, " +
    "or if pain persists.",
  "If you have a spine, nerve, neuromuscular or other medical condition, are pregnant, " +
    "or are recovering from an injury, check with a professional first.",
  "Webcam estimates are approximate. Lighting, camera angle, clothing and body shape " +
    "change the result. \"Good\" means close to your own calibrated baseline.",
  "Your video and body landmarks are processed in your browser and are not uploaded. " +
    "Settings and daily totals are stored in this browser. The pose model and scripts are served from this site, with no third-party requests.",
  "The software is provided as-is, without warranty, under the MIT License.",
]);

/** One sentence for the "Relax, don't brace" panel. */
export const RELAX_SAFETY = "This is a gentle check, not a medical test. Stop if anything hurts.";

/** The three walkthrough steps. Step 3 is the safety notice (SAFETY_POINTS). */
export const ONBOARDING_STEPS = Object.freeze([
  {
    title: "How it works",
    points: [
      "Your webcam, the pose model and the posture logic all run in this tab. No video or landmarks leave your computer.",
      "Place the camera at eye level, about an arm's length away, with your head and shoulders in frame.",
      "Face a light (a window or lamp in front of you) and use a plain background if you can.",
    ],
  },
  {
    title: "What you will see and hear",
    points: [
      "A needle and a \"what to fix\" box show which part of your posture drifted and how to correct it.",
      "If you keep slouching you get a chime first, then a spoken cue.",
      "Praise is opt-in. A silent \"Test me\" check shows whether the habit sticks without reminders.",
    ],
  },
  { title: "Before you start", points: SAFETY_POINTS },
]);

/** First-run "Choose your coach" and "You're set" steps (rendered in app.js). */
export const COACH_INTRO =
  "Pick how Posture Guard talks to you. Every choice can be changed later under Reminders & sounds and Breaks & prompts.";
export const DONE_INTRO =
  "Leave this tab open and keep your laptop awake: reminders stop if the tab closes or the machine sleeps. " +
  "Pause any time with the Pause button. A silent test now gives you a baseline to compare with later. " +
  "If a friend might like it, you can share the page.";

/** "Learn the cues" practice: each step names the tile (metric) that should light up. */
export const PRACTICE_STEPS = Object.freeze([
  { text: "Sit tall, head over your shoulders. This is the posture to come back to.", metric: null },
  { text: "Now push your head forward, like reading a small screen.", metric: "head_forward" },
  { text: "Tilt your head toward one shoulder.", metric: "head_tilt" },
  { text: "Raise one shoulder.", metric: "shoulder_level" },
  { text: "Lean your upper body to one side.", metric: "trunk_lean" },
]);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** True when the walkthrough or the safety acknowledgement is out of date. */
export function shouldShowOnboarding(store) {
  const s = store || {};
  return num(s.onboarded) < ONBOARDING_VERSION || num(s.ackVersion) < ACK_VERSION;
}

/** True when only the safety acknowledgement is stale (walkthrough already seen). */
export function needsAckOnly(store) {
  const s = store || {};
  return num(s.onboarded) >= ONBOARDING_VERSION && num(s.ackVersion) < ACK_VERSION;
}

export function markOnboarded(store) {
  store.onboarded = ONBOARDING_VERSION;
  store.ackVersion = ACK_VERSION;
  return store;
}

export const Diagnosis = Object.freeze({
  CHECKING: "checking",
  NO_PERSON: "no_person_in_view",
  FRAMING: "too_close_or_far",
  LIGHT: "low_light_or_blocked",
  LOW_FPS: "low_fps",
  OK: "ok",
});

const pct = (x) => `${Math.round(x * 100)}%`;

/** Plain-language fixes for a diagnosis. The framing band follows config. */
export function fixesFor(diagnosis, scoring = DEFAULTS.scoring) {
  switch (diagnosis) {
    case Diagnosis.NO_PERSON:
      return [
        "Sit so your head and shoulders are in the frame.",
        "Check that nothing covers the camera.",
        "Check that the browser is using the right camera.",
      ];
    case Diagnosis.LIGHT:
      return [
        "Face a light source, such as a window or a lamp in front of you.",
        "Avoid a bright window or lamp behind you.",
        "Move hair, hands or a mug away from your ears and shoulders.",
      ];
    case Diagnosis.FRAMING:
      return [
        "Sit about an arm's length from the screen.",
        `Your shoulders should span between ${pct(scoring.shoulder_width_min)} and ${pct(scoring.shoulder_width_max)} of the picture width.`,
        "Move back if your head touches the top edge, or closer if you look tiny.",
      ];
    case Diagnosis.LOW_FPS:
      return [
        "Close other tabs and video calls.",
        "Plug in your laptop and turn off battery saver.",
        "Try another browser if it stays choppy.",
      ];
    default:
      return [];
  }
}

export const DIAGNOSIS_TEXT = Object.freeze({
  [Diagnosis.CHECKING]: "Checking your setup...",
  [Diagnosis.NO_PERSON]: "I can't see you.",
  [Diagnosis.FRAMING]: "You are too close or too far from the camera.",
  [Diagnosis.LIGHT]: "The view is too dark or partly blocked.",
  [Diagnosis.LOW_FPS]: "Tracking is running slowly.",
  [Diagnosis.OK]: "Tracking looks good.",
});

export class SetupCheck {
  /** @param {object} cfg SETUP-like thresholds. @param {object} scoring for the framing band. */
  constructor(cfg = SETUP, scoring = DEFAULTS.scoring) {
    this.cfg = cfg;
    this.scoring = scoring;
    this.reset();
  }

  reset() {
    this.reported = Diagnosis.CHECKING;
    this.reportedAt = null;
    this.candidate = null;
    this.since = null;
  }

  candidateFor({ reason, fps, metricsPresent }) {
    if (reason === Reason.NO_POSE) return Diagnosis.NO_PERSON;
    if (reason === Reason.FRAMING_OUT_OF_BAND) return Diagnosis.FRAMING;
    if (reason === Reason.LOW_VISIBILITY) return Diagnosis.LIGHT;
    if (Number.isFinite(fps) && fps > 0 && fps < this.cfg.low_fps) return Diagnosis.LOW_FPS;
    return metricsPresent ? Diagnosis.OK : Diagnosis.CHECKING;
  }

  /** @param {{reason?: string|null, state?: string, fps?: number, metricsPresent?: boolean}} frame
   *  @param {number} now seconds. Returns {diagnosis, fixes, since_s}. */
  update(frame, now) {
    const f = frame || {};
    if (f.reason !== Reason.NON_FINITE) { // a tracking glitch changes nothing
      const cand = this.candidateFor(f);
      if (cand !== this.candidate) { this.candidate = cand; this.since = now; }
      const need = cand === Diagnosis.OK ? this.cfg.ok_s : this.cfg.persist_s;
      if (cand !== this.reported && now - this.since >= need) {
        this.reported = cand;
        this.reportedAt = now;
      }
    }
    return this.current(now);
  }

  current(now) {
    return {
      diagnosis: this.reported,
      fixes: fixesFor(this.reported, this.scoring),
      since_s: this.reportedAt === null || now === undefined ? 0 : Math.max(0, now - this.reportedAt),
    };
  }
}
