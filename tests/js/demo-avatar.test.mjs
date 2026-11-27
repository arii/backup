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
  assert.match(html, /id="demo-avatar-body" src="demo-avatar-body\.svg"/);
  assert.match(html, /id="demo-avatar-head" src="demo-avatar-head\.svg"/);
  for (const f of ["demo-avatar-body.svg", "demo-avatar-head.svg"]) {
    const svg = readFileSync(new URL(f, app), "utf8");
    assert.ok(svg.startsWith("<svg"), `${f} is an SVG`);
    assert.ok(!svg.includes('<rect width="640"'), "the stage supplies the background");
  }
  const pre = JSON.parse(readFileSync(new URL("precache.json", app), "utf8"));
  assert.ok(
    pre.files.some((f) => f.url === "demo-avatar-body.svg"),
    "precached for offline use",
  );
});

test("app.js pins the avatar head to the ears and body to the shoulders, in demo only", () => {
  const js = readFileSync(new URL("app.js", app), "utf8");
  assert.match(js, /const on = Boolean\(demo && lm\)/);
  assert.match(js, /pin\(\$\("demo-avatar-head"\), lm\[7\], lm\[8\]/);
  assert.match(js, /pin\(\$\("demo-avatar-body"\), lm\[11\], lm\[12\]/);
});

test("the demo pose keeps the avatar's proportions in every state", async () => {
  const { demoPose, practicePose } = await import("../../docs/app/demo-pose.js");
  for (const lm of [demoPose(1), demoPose(25), practicePose("shoulder_level", 1), practicePose("head_forward", 1)]) {
    const shW = Math.abs(lm[11].x - lm[12].x);
    const earW = Math.abs(lm[7].x - lm[8].x);
    assert.ok(Math.abs(earW / shW - 182 / 264) < 0.05, `ear/shoulder ${earW / shW}`);
  }
  const gap = (lm) => (lm[11].y + lm[12].y) / 2 - (lm[7].y + lm[8].y) / 2;
  assert.ok(gap(demoPose(1)) > 0.17 && gap(demoPose(1)) < 0.2, "upright gap matches the avatar neck");
  assert.ok(gap(demoPose(25)) < gap(demoPose(1)) - 0.08, "slouch drops the head clearly");
});
