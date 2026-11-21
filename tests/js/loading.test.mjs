// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// loading.js: byte-level download progress for the start-up steps.

import assert from "node:assert/strict";
import test from "node:test";
import { LoadSteps, downloadAll, mb, overallPercent } from "../../docs/app/loading.js";

/** A fetch stand-in that streams `bytes` in `chunk`-sized pieces. */
function fakeFetch(files, { contentLength = true } = {}) {
  return async (url) => {
    const f = files[url];
    if (!f) return new Response("nf", { status: 404 });
    const data = new Uint8Array(f.bytes).fill(7);
    let at = 0;
    const body = new ReadableStream({
      pull(ctrl) {
        if (at >= data.length) return ctrl.close();
        ctrl.enqueue(data.slice(at, at + f.chunk));
        at += f.chunk;
      },
    });
    const headers = contentLength ? { "content-length": String(f.wire ?? f.bytes) } : {};
    return new Response(body, { headers });
  };
}

test("progress counts every byte against the expected total and ends at 100%", async () => {
  const files = { "https://x/a.wasm": { bytes: 1000, chunk: 300 }, "https://x/b.task": { bytes: 500, chunk: 200 } };
  const seen = [];
  const bufs = await downloadAll(Object.keys(files), (got, total) => seen.push([got, total]), {
    fetchImpl: fakeFetch(files),
    sizes: new Map([
      ["https://x/a.wasm", 1000],
      ["https://x/b.task", 500],
    ]),
  });
  assert.deepEqual(
    bufs.map((b) => b.byteLength),
    [1000, 500],
  );
  assert.deepEqual(seen.at(-1), [1500, 1500]);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i][0] >= seen[i - 1][0], "never goes backwards");
  assert.ok(
    seen.every(([g, t]) => g <= t),
    "never past 100%",
  );
});

test("gzip: a smaller Content-Length can't push progress past 100% when the real size is known", async () => {
  const files = { "https://x/a.wasm": { bytes: 1000, chunk: 250, wire: 400 } };
  const seen = [];
  await downloadAll(Object.keys(files), (g, t) => seen.push([g, t]), {
    fetchImpl: fakeFetch(files),
    sizes: new Map([["https://x/a.wasm", 1000]]),
  });
  assert.ok(seen.every(([g, t]) => g <= t));
  assert.deepEqual(seen.at(-1), [1000, 1000]);
});

test("unknown sizes fall back to Content-Length, then to bytes received", async () => {
  const files = { "https://x/a": { bytes: 300, chunk: 100 } };
  const withLen = [];
  await downloadAll(["https://x/a"], (g, t) => withLen.push([g, t]), { fetchImpl: fakeFetch(files), sizes: new Map() });
  assert.deepEqual(withLen.at(-1), [300, 300]);
  const noLen = [];
  await downloadAll(["https://x/a"], (g, t) => noLen.push([g, t]), {
    fetchImpl: fakeFetch(files, { contentLength: false }),
    sizes: new Map(),
  });
  assert.deepEqual(noLen.at(-1), [300, 300], "exact once finished");
});

test("an HTTP error rejects with the file name", async () => {
  await assert.rejects(
    downloadAll(["https://x/missing.task"], () => {}, { fetchImpl: fakeFetch({}), sizes: new Map() }),
    /missing\.task: HTTP 404/,
  );
});

test("mb formatting", () => {
  assert.equal(mb(5_777_746), "5.8");
  assert.equal(mb(15_201_732), "15");
});

// -- LoadSteps and overallPercent, on a minimal fake DOM --------------------------

function fakeDoc() {
  const mk = () => ({ textContent: "", className: "", style: {}, attrs: {}, hidden: false });
  const items = ["camera", "download", "start"].map((id) => {
    const li = { ...mk(), dataset: { step: id }, label: mk(), detail: mk() };
    li.label.textContent = `label ${id}`;
    li.querySelector = (sel) => (sel === ".load-label" ? li.label : li.detail);
    return li;
  });
  const root = { ...mk(), hidden: true };
  root.querySelectorAll = () => items;
  root.querySelector = (sel) => items.find((li) => sel.includes(`"${li.dataset.step}"`));
  const bar = {
    ...mk(),
    hidden: true,
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
  };
  const overlay = {
    ...mk(),
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
  };
  const byId = { "load-steps": root, "load-bar": bar, "load-fill": mk(), "load-hint": mk(), "start-overlay": overlay };
  return { doc: { getElementById: (id) => byId[id] }, items, bar, byId };
}

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  const add = (entry) => {
    pending.set(next, entry);
    return next++;
  };
  return {
    setTimeout: (fn, ms) => add({ fn, ms, repeat: false }),
    setInterval: (fn, ms) => add({ fn, ms, repeat: true }),
    clearTimeout: (id) => pending.delete(id),
    clearInterval: (id) => pending.delete(id),
    pending,
  };
}

test("overallPercent weights camera 5%, download 80% and warm-up 15%", () => {
  assert.equal(overallPercent({}), 0);
  assert.equal(overallPercent({ camera: 1 }), 5);
  assert.equal(overallPercent({ camera: 1, download: 0.5 }), 45);
  assert.equal(overallPercent({ camera: 1, download: 1 }), 85);
  assert.equal(overallPercent({ camera: 1, download: 1, start: 1 }), 100);
  assert.equal(overallPercent({ camera: 5, download: -1, start: 0.5 }), 13, "clamped to 0..1");
});

test("two steps can be active at once, and finishing one leaves the other running", () => {
  const { doc, items } = fakeDoc();
  const steps = new LoadSteps(doc, { now: () => 0, timers: fakeTimers() });
  steps.open();
  steps.start("camera");
  steps.start("download");
  assert.deepEqual(
    items.map((li) => li.className),
    ["active", "active", "pending"],
  );
  steps.done("camera");
  assert.deepEqual(
    items.map((li) => li.className),
    ["done", "active", "pending"],
  );
});

test("progress is throttled to 250 ms, but the final tick always shows", () => {
  const { doc, items, bar } = fakeDoc();
  let t = 1000;
  const steps = new LoadSteps(doc, { now: () => t, timers: fakeTimers() });
  steps.open();
  steps.start("download");
  steps.progress(100_000, 1_000_000);
  assert.equal(items[1].detail.textContent, "0.1 of 1.0 MB");
  t += 100;
  steps.progress(500_000, 1_000_000);
  assert.equal(items[1].detail.textContent, "0.1 of 1.0 MB", "dropped: too soon");
  t += 200;
  steps.progress(500_000, 1_000_000);
  assert.equal(items[1].detail.textContent, "0.5 of 1.0 MB");
  assert.equal(bar.attrs["aria-valuenow"], "40");
  t += 1;
  steps.progress(1_000_000, 1_000_000);
  assert.equal(items[1].detail.textContent, "1.0 of 1.0 MB", "the last tick is not dropped");
});

test("labels change only when a step is renamed, so the live region speaks once per step", () => {
  const { doc, items } = fakeDoc();
  const steps = new LoadSteps(doc, { now: () => 0, timers: fakeTimers() });
  steps.open();
  const before = items.map((li) => li.label.textContent);
  steps.start("camera");
  steps.start("download");
  steps.progress(1, 10);
  steps.done("camera");
  steps.start("start");
  assert.deepEqual(
    items.map((li) => li.label.textContent),
    before,
    "progress and state changes never touch the label text",
  );
  steps.label("download", "simpler model");
  assert.equal(items[1].label.textContent, "simpler model");
  steps.open();
  assert.equal(items[1].label.textContent, "label download", "open() restores the default label");
});

test("warm-up counts elapsed seconds and stops when the step is done", () => {
  const { doc, items } = fakeDoc();
  let t = 0;
  const timers = fakeTimers();
  const steps = new LoadSteps(doc, { now: () => t, timers });
  steps.open();
  steps.start("start", { elapsed: true });
  const tick = [...timers.pending.values()].find((p) => p.repeat);
  t = 3400;
  tick.fn();
  assert.equal(items[2].detail.textContent, "3 s");
  steps.done("start");
  assert.ok(![...timers.pending.values()].some((p) => p.repeat), "interval cleared");
  assert.equal(items[2].detail.textContent, "");
});

test("fail marks the active step failed and puts other running steps back to pending", () => {
  const { doc, items } = fakeDoc();
  const steps = new LoadSteps(doc, { now: () => 0, timers: fakeTimers() });
  steps.open();
  steps.start("camera");
  steps.start("download");
  steps.fail("camera");
  assert.deepEqual(
    items.map((li) => li.className),
    ["failed", "pending", "pending"],
  );
  steps.open();
  steps.start("download");
  steps.fail();
  assert.equal(items[1].className, "failed", "no id: the first active step");
});
