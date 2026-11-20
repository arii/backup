// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// settings.js: new-user defaults, the optional P shortcut and camera error text.

import assert from "node:assert/strict";
import test from "node:test";
import { cameraErrorMessage, isPauseShortcut, resolveSettings } from "../../docs/app/settings.js";

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

test("other camera errors keep their detail", () => {
  const msg = cameraErrorMessage({ name: "NotFoundError", message: "Requested device not found" });
  assert.match(msg, /Requested device not found/);
  assert.match(msg, /demo/);
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
