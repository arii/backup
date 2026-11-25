// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Pure UI settings logic (no DOM), unit-tested in tests/js/settings.test.mjs:
// defaults for new users, the optional single-key pause shortcut (WCAG 2.1.4
// Character Key Shortcuts) and the camera error wording.

import { normalizeJawMinutes, normalizeMoveMinutes, normalizeReminderMinutes } from "./breaks.js";

/** Prompt ids a user can silence with "Don't show this again". */
const DISMISSIBLE_PROMPTS = Object.freeze(["eye", "move", "stretch", "water", "jaw", "breathing"]);

/** Stored choices win; anything never stored gets the default for new users. */
export function resolveSettings(store) {
  const s = store || {};
  return {
    // Shoulder-creep reminders and a breath check every 20 min of good posture.
    // On for new users; an explicit stored `false` is kept.
    relaxReminders: s.relaxReminders !== false,
    // The "P" key pauses. On by default, can be turned off (2.1.4).
    pauseShortcut: s.pauseShortcut !== false,
    // Breaks & prompts panel. Eye breaks on, move break every 60 min (off/30/45/60/90),
    // breathing moments opt in, spoken cues in "Breathe with me" opt in.
    eyeBreaks: s.eyeBreaks !== false,
    moveBreakMinutes: normalizeMoveMinutes(s.moveBreakMinutes),
    // Stretch and water reminders are off until chosen (0, 30, 45, 60 or 90 minutes).
    stretchMinutes: normalizeReminderMinutes(s.stretchMinutes),
    waterMinutes: normalizeReminderMinutes(s.waterMinutes),
    // Jaw relax prompt: off until chosen (30 or 45 minutes).
    jawMinutes: normalizeJawMinutes(s.jawMinutes),
    breathingMoments: s.breathingMoments === true,
    breatheCues: s.breatheCues === true,
    // "Don't show this again" flags, only for known prompts.
    promptsDismissed: Object.fromEntries(
      DISMISSIBLE_PROMPTS.filter((k) => s.promptsDismissed && s.promptsDismissed[k] === true).map((k) => [k, true]),
    ),
  };
}

const TEXT_ENTRY = "input, textarea, select, [contenteditable]";

/** True when a keydown should toggle pause: the shortcut is on, the key is a
 *  bare P, and focus is not in a text field. `e.target` may lack closest(). */
export function isPauseShortcut(e, enabled) {
  if (!enabled || !e) return false;
  if (e.key !== "p" && e.key !== "P") return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return !(e.target && typeof e.target.closest === "function" && e.target.closest(TEXT_ENTRY));
}

export const NEEDS_TRACKING_TIP = "Start the webcam or demo first";

/** Which camera problem an error is (#102): "denied", "none", "busy", or null when the
 *  error is not about the camera (for example the pose model). */
export function cameraProblem(err) {
  const name = err?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "none";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  return null;
}

/** The message under the Start buttons when the camera could not start. */
export function cameraErrorMessage(err) {
  const kind = cameraProblem(err);
  if (kind === "denied") {
    return (
      "Camera permission denied. To allow it, click the lock or camera icon in the address bar " +
      "(or open this site's settings), allow the camera, then reload the page. " +
      "You can also try the demo instead."
    );
  }
  if (kind === "none") return "No camera found. Connect or turn on a webcam, then Try again, or try the demo.";
  if (kind === "busy") {
    return "The camera is in use by another app, such as a video call. Close it, then Try again, or try the demo.";
  }
  const detail = err?.message || String(err);
  return `Could not start: ${detail}. Try the demo instead.`;
}

/** getUserMedia video constraints. A remembered device is requested exactly;
 *  without one, the front camera as before. */
export function cameraConstraints(deviceId) {
  const base = { width: { ideal: 640 }, height: { ideal: 480 } };
  if (typeof deviceId === "string" && deviceId) return { ...base, deviceId: { exact: deviceId } };
  return { ...base, facingMode: "user" };
}

/** True when the error means the remembered camera is gone or cannot satisfy the
 *  request, so the caller should forget it and ask again without it. Permission
 *  errors are not retried. */
export function isDeviceGoneError(err) {
  const name = err?.name;
  return name === "OverconstrainedError" || name === "NotFoundError" || name === "NotReadableError";
}

/** The value after `current` in `options`, wrapping round: a Settings row that is tapped to
 *  change its value (storyboard v3 has no dropdowns). An unknown current gives the first. */
export function nextOption(options, current) {
  const i = options.findIndex((o) => String(o) === String(current));
  return options[(i + 1) % options.length];
}

/** Text for a reminder interval in minutes: "Every 45 min", or "Off" for 0. */
export function minutesLabel(min) {
  return Number(min) > 0 ? `Every ${Number(min)} min` : "Off";
}
