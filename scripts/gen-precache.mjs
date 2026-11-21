// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Generates docs/app/precache.json: every same-origin file the app needs to
// run offline (app JS, index.html, vendored MediaPipe runtime and model,
// voice clips), with size and sha256, plus one version hash over all of it.
// The version is also written into docs/app/sw.js so the service worker file
// changes whenever any precached file changes (browsers only update a service
// worker when its own bytes change).
//
//   node scripts/gen-precache.mjs           write precache.json and update sw.js
//   node scripts/gen-precache.mjs --check   exit 1 if either is out of date
//
// It also rewrites the "about N MB" download size quoted in docs/privacy.html
// and README.md (tests/js/offline.test.mjs checks they match).
// The voice-clips workflow runs this after rendering new clips.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "docs", "app");
/** Files in docs/app that the running app never needs. */
const EXCLUDE = new Set(["sw.js", "precache.json", "package.json", "vendor/README.md"]);
const VERSION_LINE = /^const PRECACHE_VERSION = "[^"]*";$/m;

function walk(dir, rel = "") {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, r));
    else if (!EXCLUDE.has(r)) out.push(r);
  }
  return out;
}

/** Build the precache manifest for the app directory. Pure given the files. */
export function buildPrecache(appDir = APP) {
  const files = walk(appDir).map((url) => {
    const buf = readFileSync(path.join(appDir, url));
    return { url, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  });
  const version = createHash("sha256")
    .update(files.map((f) => `${f.url}:${f.sha256}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  return { version, totalBytes: files.reduce((n, f) => n + f.size, 0), files };
}

const SIZE_DOCS = ["docs/privacy.html", "README.md"];

/** Replace the first "about N MB" in text with the rounded size of totalBytes. */
export function withQuotedSize(text, totalBytes) {
  return text.replace(/about \d+ MB/, `about ${Math.round(totalBytes / 1048576)} MB`);
}

export function withVersion(swSource, version) {
  if (!VERSION_LINE.test(swSource)) throw new Error("sw.js has no PRECACHE_VERSION line");
  return swSource.replace(VERSION_LINE, `const PRECACHE_VERSION = "${version}";`);
}

/** Returns a list of problems; empty means precache.json and sw.js are current. */
export function checkPrecache(appDir = APP) {
  const problems = [];
  const want = buildPrecache(appDir);
  const jsonPath = path.join(appDir, "precache.json");
  const swPath = path.join(appDir, "sw.js");
  if (!existsSync(jsonPath)) problems.push("precache.json is missing");
  else if (readFileSync(jsonPath, "utf8") !== JSON.stringify(want, null, 2) + "\n") {
    problems.push("precache.json is out of date");
  }
  if (!existsSync(swPath)) problems.push("sw.js is missing");
  else if (readFileSync(swPath, "utf8") !== withVersion(readFileSync(swPath, "utf8"), want.version)) {
    problems.push("sw.js PRECACHE_VERSION is out of date");
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const problems = checkPrecache();
    if (problems.length) {
      console.error(`${problems.join("; ")}. Run: node scripts/gen-precache.mjs`);
      process.exit(1);
    }
    console.log("precache.json and sw.js are up to date");
  } else {
    const pre = buildPrecache();
    writeFileSync(path.join(APP, "precache.json"), JSON.stringify(pre, null, 2) + "\n");
    const swPath = path.join(APP, "sw.js");
    writeFileSync(swPath, withVersion(readFileSync(swPath, "utf8"), pre.version));
    for (const f of SIZE_DOCS) {
      const p = path.join(ROOT, f);
      writeFileSync(p, withQuotedSize(readFileSync(p, "utf8"), pre.totalBytes));
    }
    console.log(`precache ${pre.version}: ${pre.files.length} files, ${(pre.totalBytes / 1048576).toFixed(1)} MB`);
  }
}
