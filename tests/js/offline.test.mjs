// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  READY_TEXT,
  formatSize,
  isOfflineReady,
  missingFiles,
  offlineMessage,
  offlineState,
  progressPercent,
} from "../../docs/app/offline.js";
import { buildPrecache, checkPrecache, withVersion } from "../../scripts/gen-precache.mjs";

const pre = { version: "v1", files: [{ url: "a.js" }, { url: "b.js" }] };

test("ready needs every file and the matching version", () => {
  assert.equal(isOfflineReady(pre, ["a.js", "b.js"], "v1"), true);
  assert.equal(isOfflineReady(pre, ["a.js"], "v1"), false);
  assert.equal(isOfflineReady(pre, ["a.js", "b.js"], "v0"), false);
  assert.equal(isOfflineReady(pre, ["a.js", "b.js"], null), false);
  assert.deepEqual(missingFiles(pre, ["b.js"]), ["a.js"]);
});

test("progress never shows 100 before done", () => {
  assert.equal(progressPercent(50, 100), 50);
  assert.equal(progressPercent(100, 100), 99);
  assert.equal(progressPercent(100, 100, true), 100);
  assert.equal(progressPercent(5, 0), 0);
});

test("state precedence", () => {
  const f = { supported: true, registered: false, ready: false, downloading: false, error: false, stale: false };
  assert.equal(offlineState({ ...f, supported: false }), "unsupported");
  assert.equal(offlineState(f), "idle");
  assert.equal(offlineState({ ...f, ready: true }), "ready");
  assert.equal(offlineState({ ...f, downloading: true, ready: true }), "downloading");
  assert.equal(offlineState({ ...f, error: true }), "error");
  assert.equal(offlineState({ ...f, registered: true, stale: true }), "update-available");
});

test("wording", () => {
  assert.match(offlineMessage("ready"), /^Offline mode is ready\. You can disconnect Wi-Fi now\./);
  assert.match(READY_TEXT, /video is never stored/i);
  assert.match(offlineMessage("downloading", { percent: 42 }), /Downloading for offline use\.\.\. 42%/);
  assert.match(offlineMessage("idle", { totalBytes: 25834106 }), /24\.6 MB/);
  assert.equal(formatSize(2048), "2 KB");
  assert.equal(formatSize(-1), "");
});

test("committed precache.json and sw.js are current", () => {
  assert.deepEqual(checkPrecache(), []);
});

test("changing a file changes the precache version", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pre-"));
  cpSync(path.resolve("docs/app/voice"), path.join(dir, "voice"), { recursive: true });
  writeFileSync(path.join(dir, "app.js"), "a");
  const v1 = buildPrecache(dir).version;
  writeFileSync(path.join(dir, "app.js"), "b");
  const v2 = buildPrecache(dir).version;
  assert.notEqual(v1, v2);
  const manifest = path.join(dir, "voice", "manifest.json");
  writeFileSync(manifest, readFileSync(manifest, "utf8") + " ");
  assert.notEqual(buildPrecache(dir).version, v2);
  assert.ok(buildPrecache(dir).files.some((f) => f.url === "voice/manifest.json"));
});

test("sw.js version line is rewritten", () => {
  assert.match(withVersion('x\nconst PRECACHE_VERSION = "old";\ny', "new"), /PRECACHE_VERSION = "new";/);
  assert.throws(() => withVersion("nothing", "new"));
});

test("precache covers the vendored runtime, model and voices", () => {
  const urls = buildPrecache().files.map((f) => f.url);
  for (const u of [
    "index.html",
    "app.js",
    "offline.js",
    "vendor/vision_bundle.mjs",
    "vendor/pose_landmarker_lite.task",
    "vendor/wasm/vision_wasm_internal.wasm",
    "voice/manifest.json",
  ])
    assert.ok(urls.includes(u), u);
  assert.ok(!urls.includes("sw.js") && !urls.includes("precache.json"));
});

test("static docs quote the real offline download size from precache.json", async () => {
  const { readFileSync } = await import("node:fs");
  const pre = JSON.parse(readFileSync(new URL("../../docs/app/precache.json", import.meta.url), "utf8"));
  const mb = Math.round(pre.totalBytes / 1048576);
  for (const f of ["docs/privacy.html", "README.md"]) {
    const text = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    const m = text.match(/about (\d+) MB/);
    assert.ok(m, `${f} states the size`);
    assert.equal(Number(m[1]), mb, `${f} says ${m[1]} MB but precache.json totals ${mb} MB`);
  }
});
