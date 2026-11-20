// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// Every sentence the app can say on its own. scripts/render-voice.mjs renders
// each one to an MP3 with Kokoro-82M (a natural-sounding open TTS model) into
// docs/app/voice/, so the app plays recorded clips instead of the browser's
// often robotic speechSynthesis voice. Text not listed here (a custom prompt
// typed in settings) falls back to speechSynthesis.

import { CUE_METRICS, cueText } from "./posture-core.js";

export const DEFAULT_PROMPT = "Please fix your posture";
export const TEST_LINE = "Hi. I'll let you know when you slouch.";

// Rotating praise: varied wording keeps it from fading into background noise
// (repeating one identical phrase habituates fastest).
export const PRAISE = [
  "Looking good.",
  "Nice posture.",
  "You're looking good.",
  "Great, keep it up.",
  "Posture to die for.",
  "Tall and relaxed. Nice.",
  "Spine of a champion.",
];
export const RECOVERY_PRAISE = ["That's better.", "There you go.", "Much better."];

export const CUE_LINES = CUE_METRICS.map((metric) => cueText(metric, "")[2]);

/** All lines to pre-render, de-duplicated, in a stable order. */
export const ALL_LINES = [...new Set([
  DEFAULT_PROMPT, TEST_LINE, ...CUE_LINES, ...PRAISE, ...RECOVERY_PRAISE,
])];

// Kokoro voices offered in the app (id -> label). Rendered for every line.
export const VOICES = {
  af_heart: "Heart (natural, US)",
  am_michael: "Michael (natural, US)",
};
