// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// tests/eval/synthetic.mjs, load.mjs and the committed synthetic data: deterministic,
// valid, small, labeled as synthetic.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DATA_DIR, loadDatasets } from "../eval/load.mjs";
import { validateSession } from "../eval/schema.mjs";
import { BODY_COUNT, generateFiles } from "../eval/synthetic.mjs";
import { makeSession } from "./eval-support.mjs";

const files = generateFiles();

test("generating twice gives byte-identical text", () => {
  assert.deepEqual(generateFiles(), files);
});

test("the generator uses a seeded RNG, never Math.random", () => {
  const src = readFileSync(new URL("../eval/synthetic.mjs", import.meta.url), "utf8");
  assert.ok(!src.includes("Math.random"));
});

test("the committed files are exactly what the generator writes", () => {
  const dir = path.join(DATA_DIR, "synthetic");
  assert.deepEqual(readdirSync(dir).sort(), files.map(([n]) => n).sort());
  for (const [name, text] of files) assert.equal(readFileSync(path.join(dir, name), "utf8"), text, name);
});

test("one session per body, path and calibration leg, all valid and marked synthetic", () => {
  assert.equal(files.length, BODY_COUNT * 2 * 2);
  for (const [name, text] of files) {
    const s = JSON.parse(text);
    assert.deepEqual(validateSession(s), [], name);
    assert.equal(s.synthetic, true);
    assert.match(s.source, /^synthetic-generator/);
    assert.ok(s.id.startsWith("syn-"));
    assert.equal(`${s.id}.json`, name);
  }
});

test("the set stays small", () => {
  const bytes = files.reduce((n, [, text]) => n + Buffer.byteLength(text), 0);
  assert.ok(bytes < 1_000_000, `${bytes} bytes`);
});

test("it covers the hard cases: low rates, jittered timing, dropped frames, NaN glitches, hidden hips", () => {
  const all = files.map(([, text]) => JSON.parse(text));
  const fps = new Set(all.map((s) => s.scene.fps));
  assert.ok(fps.has(2));
  const jittered = all.some((s) => {
    const dts = s.frames.slice(1).map((f, i) => f[0] - s.frames[i][0]);
    return Math.max(...dts) - Math.min(...dts) > 0.05;
  });
  assert.ok(jittered);
  assert.ok(all.some((s) => s.frames.some((f) => f[1] === null)));
  assert.ok(all.some((s) => s.frames.some((f) => f[1]?.some((v) => v === null))));
  assert.ok(all.some((s) => !s.scene.hips_in_frame));
  assert.ok(all.some((s) => s.scene.lighting === "dim"));
});

test("both calibration legs share the labels and every frame after the calibration phase", () => {
  const byId = new Map(files.map(([, text]) => [JSON.parse(text).id, JSON.parse(text)]));
  for (const [id, a] of byId) {
    if (!id.endsWith("-comfortable")) continue;
    const b = byId.get(id.replace("-comfortable", "-mid_movement"));
    assert.deepEqual(a.labels, b.labels);
    const after = (s) => s.frames.filter((f) => f[0] >= 4.0);
    assert.deepEqual(after(a), after(b));
    assert.notDeepEqual(a.frames, b.frames);
  }
});

test("loadDatasets reads, sorts and fingerprints; an invalid session is an error", () => {
  const root = mkdtempSync(path.join(tmpdir(), "eval-load-"));
  mkdirSync(path.join(root, "unit"));
  writeFileSync(path.join(root, "unit", "b.json"), JSON.stringify(makeSession({ id: "b" })));
  writeFileSync(path.join(root, "unit", "a.json"), JSON.stringify(makeSession({ id: "a" })));
  const first = loadDatasets(root);
  assert.deepEqual(
    first.sessions.map((s) => s.session.id),
    ["a", "b"],
  );
  assert.equal(loadDatasets(root).sha256, first.sha256);
  writeFileSync(path.join(root, "unit", "c.json"), JSON.stringify(makeSession({ id: "c", path: "kinect" })));
  assert.throws(() => loadDatasets(root), /unit\/c\.json/);
});
