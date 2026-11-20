// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// Pure UI settings logic (no DOM), unit-tested in tests/js/settings.test.mjs:
// defaults for new users, the optional single-key pause shortcut (WCAG 2.1.4
// Character Key Shortcuts) and the camera error wording.

/** Stored choices win; anything never stored gets the default for new users. */
export function resolveSettings(store) {
  const s = store || {};
  return {
    // Shoulder-creep reminders and a breath check every 20 min of good posture.
    // On for new users; an explicit stored `false` is kept.
    relaxReminders: s.relaxReminders !== false,
    // The "P" key pauses. On by default, can be turned off (2.1.4).
    pauseShortcut: s.pauseShortcut !== false,
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

/** The message under the Start buttons when the camera could not start. */
export function cameraErrorMessage(err) {
  const detail = (err && err.message) || String(err);
  if (err && err.name === "NotAllowedError") {
    return "Camera permission denied. To allow it, click the camera icon in the address bar " +
      "(or open this site's settings), allow the camera, then reload the page. " +
      "You can also try the demo instead.";
  }
  return `Could not start: ${detail}. Try the demo instead.`;
}
