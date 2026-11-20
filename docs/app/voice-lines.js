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
  "Easy does it. Looking good.",
  "Spine of a champion.",
];
export const RECOVERY_PRAISE = ["That's better.", "There you go.", "Much better."];

// Anti-bracing (relax.js): good posture is a relaxed stack, not a squeeze.
export const RELAX_LINES = {
  bracing: "Shoulders creeping up? Breathe out and let them drop.",
  inhale: "Breath check. Take a slow, deep breath in.",
  exhale: "And breathe out. Let your shoulders drop.",
  rose: "Your shoulders rose as you breathed in. Let them hang, and breathe into your belly.",
  held: "Your shoulders dropped when you let go, so you were holding them up. Stay soft.",
  relaxed: "Nice. Relaxed and stacked.",
  unclear: "I couldn't see your shoulders clearly. Try again facing the camera.",
};

export const CUE_LINES = CUE_METRICS.map((metric) => cueText(metric, "")[2]);

/** All lines to pre-render, de-duplicated, in a stable order. */
export const ALL_LINES = [...new Set([
  DEFAULT_PROMPT, TEST_LINE, ...CUE_LINES, ...PRAISE, ...RECOVERY_PRAISE, ...Object.values(RELAX_LINES),
])];

// Kokoro voices offered in the app (id -> label). Rendered for every line.
export const VOICES = {
  af_heart: "Heart (natural, US)",
  am_michael: "Michael (natural, US)",
};
