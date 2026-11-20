// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// prompts.js: one scheduler, never two prompts at once, quiet start, global gap.

import assert from "node:assert/strict";
import test from "node:test";
import { PROMPTS, PromptScheduler } from "../../docs/app/prompts.js";

const MIN = 60;
/** Ask for `id` and poll at the same instant (as the app does every frame). */
function ask(s, id, now, ctx = {}) {
  s.enqueue(id, now);
  return s.poll(now, ctx);
}

function make(isEnabled) {
  const s = new PromptScheduler({ isEnabled });
  s.startSession(0);
  return s;
}

test("nothing shows in the first 5 minutes of a session", () => {
  const s = make();
  assert.equal(ask(s, "eye", 1), null);
  assert.equal(ask(s, "eye", 299), null);
  assert.equal(ask(s, "eye", 300)?.id, "eye");
});

test("at most one non-posture prompt per 10 minutes", () => {
  const s = make();
  s.enqueue("eye", 300);
  assert.equal(s.poll(300)?.id, "eye");
  s.dismiss(310, "done");
  assert.equal(ask(s, "move", 320), null);
  assert.equal(ask(s, "move", 300 + 599), null);
  assert.equal(ask(s, "move", 300 + 600)?.id, "move");
});

test("priority: breath check > break > breathing message", () => {
  const s = make();
  s.enqueue("breathing", 300);
  s.enqueue("move", 300);
  s.enqueue("breath", 300);
  assert.equal(s.poll(300)?.id, "breath");
  s.dismiss(301);
  s.enqueue("breathing", 900);
  assert.equal(ask(s, "move", 900)?.id, "move");
  s.dismiss(901);
  assert.equal(s.poll(1500), null); // breathing went stale
  assert.equal(ask(s, "breathing", 1500)?.id, "breathing");
});

test("never two at once, even after the global gap", () => {
  const s = make();
  s.enqueue("eye", 300);
  assert.equal(s.poll(300)?.id, "eye");
  assert.equal(ask(s, "breathing", 2000), null);
  assert.equal(s.active.id, "eye");
  s.dismiss(2000, "done");
  s.enqueue("breathing", 2000);
  assert.equal(s.poll(2001)?.id, "breathing");
});

test("a posture reminder holds every other prompt back", () => {
  const s = make();
  s.notePosture(400);
  assert.equal(ask(s, "eye", 405), null);
  assert.equal(ask(s, "eye", 400 + PROMPTS.posture_hold_s)?.id, "eye");
});

test("suppressed while paused, in a silent test, or during a breath check", () => {
  for (const ctx of [{ paused: true }, { test: true }, { breathCheck: true }]) {
    const s = make();
    assert.equal(ask(s, "eye", 1000, ctx), null, JSON.stringify(ctx));
    assert.equal(s.active, null);
    assert.equal(ask(s, "eye", 1001)?.id, "eye"); // shows once the suppression ends
  }
});

test("a disabled or dismissed prompt is never queued", () => {
  const off = new Set(["eye"]);
  const s = make((id) => !off.has(id));
  assert.equal(s.enqueue("eye", 400), false);
  assert.equal(s.poll(400), null);
  assert.equal(s.enqueue("move", 400), true);
  off.add("move"); // turned off while queued
  assert.equal(s.poll(401), null);
});

test("snooze and Not now keep that prompt away for 10 minutes", () => {
  for (const how of ["snooze", "notnow"]) {
    const s = make();
    s.enqueue("eye", 300);
    s.poll(300);
    assert.equal(s.dismiss(310, how), "eye");
    assert.equal(ask(s, "eye", 900), null, how); // past the global gap? no: still snoozed
    assert.equal(ask(s, "eye", 310 + PROMPTS.snooze_s)?.id, "eye", how);
  }
});

test("breathing moments cooldown is 30 minutes, the other types are shorter", () => {
  const s = make();
  s.enqueue("breathing", 300);
  s.poll(300);
  s.dismiss(310);
  assert.equal(ask(s, "breathing", 1000), null);
  assert.equal(ask(s, "breathing", 300 + 30 * MIN - 1), null);
  assert.equal(ask(s, "breathing", 300 + 30 * MIN)?.id, "breathing");
});

test("stale queued prompts are dropped", () => {
  const s = make();
  s.enqueue("eye", 100);
  assert.equal(s.poll(100 + PROMPTS.queue_ttl_s + 1), null);
  assert.equal(s.queue.length, 0);
});

test("unknown prompt ids are refused", () => {
  assert.equal(make().enqueue("bogus", 0), false);
});

test("within a priority level the prompt shown longest ago goes first", () => {
  const s = make();
  assert.equal(ask(s, "eye", 300)?.id, "eye");
  s.dismiss(301);
  s.enqueue("eye", 900);
  assert.equal(ask(s, "move", 900)?.id, "move");
});
