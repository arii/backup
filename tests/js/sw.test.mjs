// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Runs docs/app/sw.js in a vm sandbox with a fake caches / fetch / self.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SCOPE = "https://example.test/app/";
const SRC = readFileSync(new URL("../../docs/app/sw.js", import.meta.url), "utf8");

function fakeCaches() {
  const stores = new Map();
  const make = (name) => ({
    async put(url, res) { stores.get(name).set(String(url), await res.clone().text()); },
    async match(url) { const v = stores.get(name).get(String(url)); return v === undefined ? undefined : new Response(v); },
  });
  return {
    stores,
    async open(n) { if (!stores.has(n)) stores.set(n, new Map()); return make(n); },
    async has(n) { return stores.has(n); },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
  };
}

/** Load sw.js at `version`. `site` maps url path -> body; a missing path 404s. */
function load(version, site, caches, fetchLog = []) {
  const handlers = {};
  const files = Object.entries(site).filter(([u]) => u !== "precache.json").map(([url, body]) => ({
    url, size: body.length, sha256: `h:${body}`,
  }));
  const pre = { version, files };
  const self = {
    registration: { scope: SCOPE },
    location: new URL(SCOPE),
    clients: { matchAll: async () => [], claim: async () => {} },
    skipWaiting: () => {},
    addEventListener: (t, fn) => { handlers[t] = fn; },
  };
  const fetchFn = async (u) => {
    const url = String(u.url || u);
    fetchLog.push(url);
    const key = url.slice(SCOPE.length);
    if (key === "precache.json") return new Response(JSON.stringify(pre));
    return key in site ? new Response(site[key]) : new Response("no", { status: 404 });
  };
  const ctx = vm.createContext({ self, caches, fetch: fetchFn, Response, URL, Promise, JSON, Object, Math, String, Error });
  vm.runInContext(SRC.replace(/const PRECACHE_VERSION = "[^"]*";/, `const PRECACHE_VERSION = "${version}";`), ctx);
  const run = async (type, extra = {}) => {
    let p; handlers[type]({ waitUntil: (x) => { p = x; }, ...extra });
    return p;
  };
  const get = async (path, method = "GET") => {
    let p = null;
    handlers.fetch({ request: { url: SCOPE.replace(/app\/$/, "") + path, method }, respondWith: (x) => { p = x; } });
    return p && (await p);
  };
  return { run, get };
}

test("install fills a per-version cache and meta is written last", async () => {
  const caches = fakeCaches();
  const w = load("v1", { "index.html": "I1", "app.js": "A1" }, caches);
  await w.run("install");
  const c = caches.stores.get("posture-guard-v1");
  assert.equal([...c.keys()].at(-1), SCOPE + "__offline-meta.json");
  assert.equal(c.get(SCOPE + "index.html"), "I1");
});

test("fetch maps /app/ to index.html, strips the query, and ignores sw.js", async () => {
  const caches = fakeCaches();
  const w = load("v1", { "index.html": "I1", "app.js": "A1" }, caches);
  await w.run("install");
  assert.equal(await (await w.get("app/")).text(), "I1");
  assert.equal(await (await w.get("app/app.js?x=1")).text(), "A1");
  assert.equal(await w.get("app/sw.js"), null);
  assert.equal(await w.get("app/precache.json"), null);
  assert.equal(await w.get("app/app.js", "POST"), null);
});

test("an update stages a new cache and the old worker keeps serving its own", async () => {
  const caches = fakeCaches();
  const w1 = load("v1", { "index.html": "I1", "app.js": "A1" }, caches);
  await w1.run("install");
  const log = [];
  const w2 = load("v2", { "index.html": "I2", "app.js": "A1" }, caches, log);
  await w2.run("install");
  assert.equal(await (await w1.get("app/")).text(), "I1");
  assert.equal(await (await w2.get("app/")).text(), "I2");
  assert.ok(!log.some((u) => u.endsWith("/app.js")), "unchanged file is copied, not downloaded");
  await w2.run("activate");
  assert.deepEqual(await caches.keys(), ["posture-guard-v2"]);
});

test("a failed update leaves the working copy intact and no partial cache", async () => {
  const caches = fakeCaches();
  const w1 = load("v1", { "index.html": "I1", "app.js": "A1" }, caches);
  await w1.run("install");
  // The manifest lists app.js but the server no longer serves it.
  const site = { "index.html": "I2", "app.js": "A2" };
  const w3 = load("v2", site, caches);
  delete site["app.js"];
  await assert.rejects(w3.run("install"));
  assert.deepEqual(await caches.keys(), ["posture-guard-v1"]);
  assert.equal(await (await w1.get("app/")).text(), "I1");
  assert.equal(await (await w1.get("app/app.js")).text(), "A1");
});
