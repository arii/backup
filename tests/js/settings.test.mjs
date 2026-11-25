// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// settings.js: new-user defaults, the optional P shortcut and camera error text.

import assert from "node:assert/strict";
import test from "node:test";
import {
  cameraConstraints,
  cameraErrorMessage,
  cameraProblem,
  isDeviceGoneError,
  isPauseShortcut,
  minutesLabel,
  nextOption,
  resolveSettings,
} from "../../docs/app/settings.js";

test("new users get the breath check and the P shortcut on", () => {
  for (const s of [resolveSettings({}), resolveSettings(null)]) {
    assert.equal(s.relaxReminders, true);
    assert.equal(s.pauseShortcut, true);
  }
});

test("stored choices are kept, including an explicit off", () => {
  const s = resolveSettings({ relaxReminders: false, pauseShortcut: false });
  assert.equal(s.relaxReminders, false);
  assert.equal(s.pauseShortcut, false);
  assert.equal(resolveSettings({ relaxReminders: true }).relaxReminders, true);
});

test("P pauses only when the shortcut is on and no modifier or text field is involved", () => {
  const key = (extra) => ({ key: "p", target: { closest: () => null }, ...extra });
  assert.equal(isPauseShortcut(key(), true), true);
  assert.equal(isPauseShortcut(key({ key: "P" }), true), true);
  assert.equal(isPauseShortcut(key(), false), false);
  assert.equal(isPauseShortcut(key({ key: "q" }), true), false);
  assert.equal(isPauseShortcut(key({ ctrlKey: true }), true), false);
  assert.equal(isPauseShortcut(key({ metaKey: true }), true), false);
  assert.equal(isPauseShortcut(key({ altKey: true }), true), false);
  assert.equal(isPauseShortcut(key({ target: { closest: () => ({}) } }), true), false);
  assert.equal(isPauseShortcut(null, true), false);
});

test("a denied camera says how to re-allow it", () => {
  const msg = cameraErrorMessage({ name: "NotAllowedError", message: "Permission denied" });
  assert.match(msg, /address bar/);
  assert.match(msg, /site.*settings/i);
  assert.match(msg, /reload/);
  assert.match(msg, /demo/);
});

test("no camera, a busy camera and other errors each get their own message (#102)", () => {
  const none = cameraErrorMessage({ name: "NotFoundError", message: "Requested device not found" });
  assert.match(none, /No camera found/);
  assert.match(none, /demo/);
  assert.match(cameraErrorMessage({ name: "NotReadableError", message: "Could not start video source" }), /in use/);
  const other = cameraErrorMessage({ name: "TypeError", message: "model failed" });
  assert.match(other, /model failed/);
  assert.equal(cameraProblem({ name: "NotAllowedError" }), "denied");
  assert.equal(cameraProblem({ name: "OverconstrainedError" }), "none");
  assert.equal(cameraProblem({ name: "AbortError" }), "busy");
  assert.equal(cameraProblem(new Error("x")), null);
});

test("breaks and prompts defaults: eye breaks on, move break 60, breathing moments opt in", () => {
  const s = resolveSettings({});
  assert.equal(s.eyeBreaks, true);
  assert.equal(s.moveBreakMinutes, 60);
  assert.equal(s.breathingMoments, false);
  assert.equal(s.breatheCues, false);
  assert.deepEqual(s.promptsDismissed, {});
});

test("breaks and prompts choices persist, and bad stored values fall back", () => {
  const s = resolveSettings({
    eyeBreaks: false,
    moveBreakMinutes: 0,
    breathingMoments: true,
    breatheCues: true,
    promptsDismissed: { eye: true, move: false, bogus: true },
  });
  assert.equal(s.eyeBreaks, false);
  assert.equal(s.moveBreakMinutes, 0);
  assert.equal(s.breathingMoments, true);
  assert.equal(s.breatheCues, true);
  assert.deepEqual(s.promptsDismissed, { eye: true });
  assert.equal(resolveSettings({ moveBreakMinutes: 33 }).moveBreakMinutes, 60);
  assert.equal(resolveSettings({ moveBreakMinutes: "45" }).moveBreakMinutes, 45);
});

test("the jaw prompt is off for new users and keeps only 30 or 45", () => {
  assert.equal(resolveSettings({}).jawMinutes, 0);
  assert.equal(resolveSettings({ jawMinutes: 45 }).jawMinutes, 45);
  assert.equal(resolveSettings({ jawMinutes: 60 }).jawMinutes, 0);
  assert.equal(resolveSettings({ promptsDismissed: { jaw: true } }).promptsDismissed.jaw, true);
});

test("a remembered camera is requested exactly, otherwise the front camera", () => {
  assert.deepEqual(cameraConstraints("abc").deviceId, { exact: "abc" });
  assert.equal(cameraConstraints("abc").facingMode, undefined);
  for (const none of ["", undefined, null, 5]) {
    const c = cameraConstraints(none);
    assert.equal(c.facingMode, "user");
    assert.equal(c.deviceId, undefined);
  }
});

test("a missing or unusable remembered camera is retried, a refusal is not", () => {
  for (const name of ["OverconstrainedError", "NotFoundError", "NotReadableError"])
    assert.equal(isDeviceGoneError({ name }), true);
  for (const name of ["NotAllowedError", "SecurityError", "TypeError"])
    assert.equal(isDeviceGoneError({ name }), false);
  assert.equal(isDeviceGoneError(null), false);
});

test("tap-to-change rows step through their options and wrap round", () => {
  assert.equal(nextOption([30, 45, 60, 90, 0], 60), 90);
  assert.equal(nextOption([30, 45, 60, 90, 0], 0), 30);
  assert.equal(nextOption(["standard", "light"], "light"), "standard");
  assert.equal(nextOption([5, 10, 20], "10"), 20, "values read from the DOM are strings");
  assert.equal(nextOption([5, 10, 20], "nope"), 5);
  assert.equal(minutesLabel(45), "Every 45 min");
  assert.equal(minutesLabel(0), "Off");
});
