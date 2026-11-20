// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// privacy.js: delete-my-data and the public bug report body.

import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_WARNING, STORE_KEYS, buildBugReportBody, clearStoredData, sanitizeError, webglSummary,
} from "../../docs/app/privacy.js";

function fakeStorage(initial) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    removeItem: (k) => { m.delete(k); },
    get size() { return m.size; },
  };
}

test("delete my data removes posture-guard:v1 and leaves other sites' keys alone", () => {
  const s = fakeStorage({ "posture-guard:v1": '{"days":{},"badSound":"data:audio/mp3;base64,AAA"}', other: "x" });
  assert.ok(STORE_KEYS.includes("posture-guard:v1"));
  assert.equal(clearStoredData(s), true);
  assert.equal(s.getItem("posture-guard:v1"), null);
  assert.equal(s.getItem("other"), "x");
});

test("delete my data reports failure when storage throws", () => {
  const s = { getItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  assert.equal(clearStoredData(s), false);
});

test("bug report body starts with the public warning and has no renderer string", () => {
  const body = buildBugReportBody({ diag: "- WebGL: WebGL2 ok", problems: [] });
  assert.equal(body.split("\n")[0], PUBLIC_WARNING);
  assert.match(PUBLIC_WARNING, /will be public/);
  assert.ok(!/renderer|ANGLE|NVIDIA|Intel|Radeon/i.test(body));
});

test("webglSummary reports only ok and version", () => {
  assert.equal(webglSummary(null), "unavailable");
  assert.equal(webglSummary({ createVertexArray() {}, texStorage2D() {}, getParameter() { throw new Error("no"); } }), "WebGL2 ok");
  assert.equal(webglSummary({}), "WebGL1 ok");
});

test("sanitizeError strips urls, paths and emails", () => {
  const out = sanitizeError("Failed https://cdn.example.com/a/b.js?x=1 at /home/ann/app/x.js and C:\\Users\\ann\\x.js mail ann@example.com");
  assert.ok(!/cdn\.example|home|ann|Users/.test(out), out);
  assert.match(out, /<url>/);
  assert.equal(sanitizeError("x".repeat(500)).length, 200);
  assert.equal(sanitizeError("Cannot read properties of undefined"), "Cannot read properties of undefined");
});
