// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// wellness.js: guided break demos and the local water count.

import assert from "node:assert/strict";
import test from "node:test";
import { addWater, DEMO_DONE, demoAt, demoLength, demoStaticText } from "../../docs/app/wellness.js";
import { summarize, exportJson } from "../../docs/app/progress.js";
import { clearStoredData } from "../../docs/app/privacy.js";
import { BreakTracker } from "../../docs/app/breaks.js";
import { resolveSettings } from "../../docs/app/settings.js";

test("every demo lasts 10 to 20 seconds", () => {
  for (const kind of ["stretch", "move", "water"]) {
    const n = demoLength(kind);
    assert.ok(n >= 10 && n <= 20, `${kind} ${n}s`);
  }
});

test("demoAt walks the steps in order and reports done after the last one", () => {
  const first = demoAt("stretch", 0);
  assert.equal(first.index, 0);
  assert.equal(first.done, false);
  assert.ok(first.line.length > 0);
  assert.equal(demoAt("stretch", 6).index, 1);
  const end = demoAt("stretch", demoLength("stretch"));
  assert.equal(end.done, true);
  assert.equal(end.index, 2);
});

test("static text lists every step on its own numbered line", () => {
  const lines = demoStaticText("water").split("\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith("1. "));
  assert.ok(DEMO_DONE.stretch);
});

test("addWater counts per day, ignores junk and keeps 60 days", () => {
  const store = { water: { "2026-01-01": 2, bad: 5, "2026-01-02": -1 } };
  assert.equal(addWater(store, "2026-01-03"), 1);
  assert.equal(addWater(store, "2026-01-03"), 2);
  assert.deepEqual(store.water, { "2026-01-01": 2, "2026-01-03": 2 });
  const many = { water: {} };
  for (let i = 0; i < 80; i++) many.water[new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)] = 1;
  addWater(many, "2026-06-01");
  assert.ok(Object.keys(many.water).length <= 61);
});

test("the water count shows in progress and the export, and Delete my data clears it", () => {
  const now = Date.UTC(2026, 4, 10, 12);
  const store = { water: {} };
  addWater(store, "2026-05-10");
  addWater(store, "2026-05-10");
  addWater(store, "2026-05-08");
  const s = summarize(store, now);
  assert.equal(s.water_today, 2);
  assert.equal(s.water_7d, 3);
  assert.deepEqual(JSON.parse(exportJson(store, now)).water, { "2026-05-08": 1, "2026-05-10": 2 });
  const mem = new Map([["posture-guard:v1", JSON.stringify(store)]]);
  const storage = { removeItem: (k) => mem.delete(k), getItem: (k) => mem.get(k) ?? null };
  assert.equal(clearStoredData(storage), true);
  assert.equal(mem.size, 0);
});

test("stretch and water reminders are off by default and then follow their interval", () => {
  const st = resolveSettings({});
  assert.equal(st.stretchMinutes, 0);
  assert.equal(st.waterMinutes, 0);
  assert.equal(resolveSettings({ waterMinutes: 45 }).waterMinutes, 45);
  assert.equal(resolveSettings({ waterMinutes: 7 }).waterMinutes, 0);
  const tr = new BreakTracker({ eyeBreaks: false, moveBreakMinutes: 0, stretchMinutes: 30, waterMinutes: 45 });
  tr.update(true, 0);
  for (let t = 1; t <= 30 * 60; t++) tr.update(true, t);
  assert.deepEqual(tr.due(), ["stretch"]);
  tr.taken("stretch");
  for (let t = 30 * 60 + 1; t <= 45 * 60; t++) tr.update(true, t);
  assert.deepEqual(tr.due(), ["water"]);
  tr.taken("water");
  assert.deepEqual(tr.due(), []);
  tr.setWaterMinutes(0);
  tr.setStretchMinutes(0);
  for (let t = 45 * 60 + 1; t <= 5 * 3600; t++) tr.update(true, t);
  assert.deepEqual(tr.due(), []);
});
