// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// loading.js: byte-level download progress for the start-up steps.

import assert from "node:assert/strict";
import test from "node:test";
import { downloadAll, mb } from "../../docs/app/loading.js";

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
    sizes: new Map([["https://x/a.wasm", 1000], ["https://x/b.task", 500]]),
  });
  assert.deepEqual(bufs.map((b) => b.byteLength), [1000, 500]);
  assert.deepEqual(seen.at(-1), [1500, 1500]);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i][0] >= seen[i - 1][0], "never goes backwards");
  assert.ok(seen.every(([g, t]) => g <= t), "never past 100%");
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
    fetchImpl: fakeFetch(files, { contentLength: false }), sizes: new Map(),
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
