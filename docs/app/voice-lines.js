// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Every sentence the app can say on its own. scripts/render-voice.mjs renders
// each one to an MP3 with Kokoro-82M (a natural-sounding open TTS model) into
// docs/app/voice/, so the app plays recorded clips instead of the browser's
// often robotic speechSynthesis voice. Text not listed here (a custom prompt
// typed in settings) falls back to speechSynthesis.

import { CUE_METRICS, cueText } from "./posture-core.js";

export const DEFAULT_PROMPT = "Please fix your posture";
const TEST_LINE = "Hi. I'll let you know when you slouch.";

// Rotating praise: varied wording keeps it from fading into background noise
// (repeating one identical phrase habituates fastest).
export const PRAISE = [
  "Looking good.",
  "Nice posture.",
  "You're looking good.",
  "Great, keep it up.",
  "Posture to die for.",
  "Easy does it. Looking good.",
  "Spine of a champion.",
];
export const RECOVERY_PRAISE = ["That's better.", "There you go.", "Much better."];

// Anti-bracing (relax.js): good posture is a relaxed stack, not a squeeze.
export const RELAX_LINES = {
  introOffer: "Want to try a 30 second breath check? It looks at your shoulders.",
  bracing: "Shoulders creeping up? Breathe out and let them drop.",
  inhale: "Breath check. Take a slow, deep breath in.",
  exhale: "And breathe out. Let your shoulders drop.",
  rose: "Your shoulders rose as you breathed in. Let them hang, and breathe into your belly.",
  held: "Your shoulders dropped when you let go, so you were holding them up. Stay soft.",
  relaxed: "Nice. Relaxed and stacked.",
  unclear: "I couldn't see your shoulders clearly. Try again facing the camera.",
};

// Break prompts (breaks.js, prompts.js). Wellness wording only: no health claims.
export const BREAK_LINES = {
  eye: "Look at something 20 feet away for 20 seconds.",
  eyeDone: "Nice. Your eyes had a rest.",
  move: "Time to stand up and move for a couple of minutes.",
  stretch: "Time for a gentle neck and shoulder stretch.",
  water: "Time for a few sips of water.",
  jaw: "Check your face: unclench your jaw and let your tongue rest on the floor of your mouth.",
};

// "Take a break" demos (wellness.js): short guided steps, no camera, no form coaching.
export const DEMO_LINES = {
  stretchNeck: "Neck. Let one ear drift toward your shoulder, then switch sides. Keep it gentle.",
  stretchRoll: "Shoulders. Roll them up, back and down, slowly.",
  stretchChest: "Chest. Open your arms wide and breathe in. Stop if anything hurts.",
  stretchDone: "Nice. Shake it out.",
  moveStand: "Stand up.",
  moveWalk: "Walk or sway for a bit. Roll your ankles.",
  moveReach: "Reach up high, then let your arms drop.",
  moveDone: "Good. Back to it when you are ready.",
  waterPick: "Pick up your glass of water.",
  waterSip: "Take a few slow sips.",
  waterPut: "Put it down. Tap I drank to count it.",
};

// Breathing moments (breathing.js): rotated so they do not fade into the background.
export const BREATHING_MOMENTS = [
  "Long breath out. Let your shoulders drop.",
  "Easy now. Let your jaw go soft and breathe out slowly.",
  "Pause for one slow breath. Let go on the way out.",
  "Breathe in through your nose, then let it all go.",
  "Let your arms feel heavy and breathe out easy.",
];

// "Breathe with me": about 4 s in and 6 s out for one minute, then a breath check.
export const BREATHE_LINES = {
  offer: "Want a minute to breathe out with me?",
  intro: "Breathe with me for one minute. Stop if you feel dizzy.",
  in: "Breathe in.",
  out: "And out, nice and easy.",
  done: "Easy. Now a breath check.",
};

const CUE_LINES = CUE_METRICS.map((metric) => cueText(metric, "")[2]);

/** All lines to pre-render, de-duplicated, in a stable order. */
export const ALL_LINES = [
  ...new Set([
    DEFAULT_PROMPT,
    TEST_LINE,
    ...CUE_LINES,
    ...PRAISE,
    ...RECOVERY_PRAISE,
    ...Object.values(RELAX_LINES),
    ...Object.values(BREAK_LINES),
    ...Object.values(DEMO_LINES),
    ...BREATHING_MOMENTS,
    ...Object.values(BREATHE_LINES),
  ]),
];

// Kokoro voices offered in the app (id -> label). Rendered for every line.
export const VOICES = {
  af_heart: "Heart (natural, US)",
  am_michael: "Michael (natural, US)",
};
