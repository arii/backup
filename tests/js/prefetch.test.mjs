// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// docs/prefetch.js: landing page intent prefetch (hover, focus, pointer down).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SRC = readFileSync(new URL("../../docs/prefetch.js", import.meta.url), "utf8");

/** Run the script against a fake page. Returns the handlers, the fetch calls (as `added`) and a fake timer queue. */
function page({ connection, webgl = true } = {}) {
  const handlers = {};
  const fetched = [];
  const timers = [];
  const link = { addEventListener: (type, fn) => (handlers[type] = fn) };
  const document = {
    createElement: (tag) => (tag === "canvas" ? { getContext: () => (webgl ? {} : null) } : {}),
    querySelectorAll: (sel) => (sel === 'a[href="./app/"]' ? [link] : []),
  };
  const ctx = {
    document,
    fetch: (url, opts) => {
      fetched.push({ url, opts });
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    },
    navigator: { connection },
    location: { href: "https://example.test/posture-guard/" },
    WebAssembly: { validate: () => true },
    URL,
    Uint8Array,
    Boolean,
    setTimeout: (fn, ms) => timers.push({ fn, ms }) && timers.length,
    clearTimeout: (id) => {
      timers[id - 1] = null;
    },
  };
  vm.runInNewContext(SRC, ctx);
  return { handlers, added: fetched, timers };
}

test("nothing is fetched on load", () => {
  assert.equal(page().added.length, 0);
});

test("pointer down prefetches the model and wasm once, same origin", () => {
  const p = page();
  p.handlers.pointerdown();
  p.handlers.focus();
  assert.deepEqual(
    p.added.map((f) => f.url),
    [
      "https://example.test/posture-guard/app/vendor/pose_landmarker_lite.task",
      "https://example.test/posture-guard/app/vendor/wasm/vision_wasm_internal.wasm",
    ],
  );
});

test("hover waits 150 ms and leaving cancels it", () => {
  const p = page();
  p.handlers.pointerenter();
  assert.equal(p.timers[0].ms, 150);
  p.handlers.pointerleave();
  assert.equal(p.timers[0], null);
  assert.equal(p.added.length, 0);
  p.handlers.pointerenter();
  p.timers[1].fn();
  assert.equal(p.added.length, 2);
});

test("skipped on Save-Data, 2g and without WebGL", () => {
  for (const opts of [
    { connection: { saveData: true } },
    { connection: { effectiveType: "2g" } },
    { connection: { effectiveType: "slow-2g" } },
    { webgl: false },
  ]) {
    const p = page(opts);
    p.handlers.pointerdown();
    assert.equal(p.added.length, 0, JSON.stringify(opts));
  }
  const ok = page({ connection: { effectiveType: "4g", saveData: false } });
  ok.handlers.focus();
  assert.equal(ok.added.length, 2);
});
