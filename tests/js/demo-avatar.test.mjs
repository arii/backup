// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// The demo's synthetic avatar: the markup, the asset and the precache agree.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = new URL("../../docs/app/", import.meta.url);

test("the demo avatar layers point at a precached SVG that has no background rect", () => {
  const html = readFileSync(new URL("index.html", app), "utf8");
  assert.match(html, /id="demo-avatar-img" src="demo-avatar\.svg"/);
  assert.equal((html.match(/demo-avatar\.svg/g) || []).length, 1, "one picture, no split layers");
  const svg = readFileSync(new URL("demo-avatar.svg", app), "utf8");
  assert.ok(svg.startsWith("<svg"), "an SVG");
  assert.ok(!svg.includes('<rect width="640"'), "the stage supplies the background");
  const pre = JSON.parse(readFileSync(new URL("precache.json", app), "utf8"));
  assert.ok(
    pre.files.some((f) => f.url === "demo-avatar.svg"),
    "precached for offline use",
  );
});

test("app.js pins one avatar picture at the shoulders, in demo only", () => {
  const js = readFileSync(new URL("app.js", app), "utf8");
  assert.match(js, /const on = Boolean\(demo && lm\)/);
  assert.match(js, /rotate\(\$\{tilt/);
});
