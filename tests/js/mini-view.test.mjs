// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// mini-view.js: needle transform.

import assert from "node:assert/strict";
import test from "node:test";
import { needleTransform } from "../../docs/app/mini-view.js";

test("needle transform maps -1, 0, 1 to 0, 90, 180 degrees about the dial centre", () => {
  assert.equal(needleTransform(-1), "rotate(0.0 100 100)");
  assert.equal(needleTransform(0), "rotate(90.0 100 100)");
  assert.equal(needleTransform(1), "rotate(180.0 100 100)");
  assert.equal(needleTransform(0.25), "rotate(112.5 100 100)");
});
