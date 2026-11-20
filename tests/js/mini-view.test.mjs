// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// mini-view.js: needle transform and which mini views get drawn.

import assert from "node:assert/strict";
import test from "node:test";
import { MINI_SCALE, miniViewsToDraw, needleTransform } from "../../docs/app/mini-view.js";

const NAMES = ["practice", "setup"];

test("needle transform maps -1, 0, 1 to 0, 90, 180 degrees about the dial centre", () => {
  assert.equal(needleTransform(-1), "rotate(0.0 100 100)");
  assert.equal(needleTransform(0), "rotate(90.0 100 100)");
  assert.equal(needleTransform(1), "rotate(180.0 100 100)");
  assert.equal(needleTransform(0.25), "rotate(112.5 100 100)");
});

test("only open panels are drawn", () => {
  assert.deepEqual(miniViewsToDraw(NAMES, { practice: true, setup: false }, 0.2), ["practice"]);
  assert.deepEqual(miniViewsToDraw(NAMES, { practice: false, setup: true }, 0.2), ["setup"]);
  assert.deepEqual(miniViewsToDraw(NAMES, { practice: true, setup: true }, 0.2), NAMES);
  assert.deepEqual(miniViewsToDraw(NAMES, {}, 0.2), []);
});

test("a null needle (silent test) draws nothing, a zero needle still draws", () => {
  assert.deepEqual(miniViewsToDraw(NAMES, { practice: true, setup: true }, null), []);
  assert.deepEqual(miniViewsToDraw(NAMES, { practice: true, setup: true }, undefined), []);
  assert.deepEqual(miniViewsToDraw(NAMES, { practice: true }, 0), ["practice"]);
});

test("mini scale shrinks strokes below the main view", () => {
  assert.ok(MINI_SCALE > 0 && MINI_SCALE < 1);
});
