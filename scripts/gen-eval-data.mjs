// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Regenerates the SYNTHETIC labeled sessions in tests/eval/data/synthetic/. Deterministic:
// a rerun rewrites byte-identical files. With --check it writes nothing and fails when the
// committed files differ from what the generator produces.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../tests/eval/load.mjs";
import { generateFiles } from "../tests/eval/synthetic.mjs";

const dir = path.join(DATA_DIR, "synthetic");
const files = generateFiles();

if (process.argv.includes("--check")) {
  const onDisk = new Set(readdirSync(dir).filter((f) => f.endsWith(".json")));
  const problems = [];
  for (const [name, text] of files) {
    onDisk.delete(name);
    let current = null;
    try {
      current = readFileSync(path.join(dir, name), "utf8");
    } catch {
      // reported below
    }
    if (current !== text) problems.push(`${name} differs from the generator`);
  }
  for (const extra of onDisk) problems.push(`${extra} is not produced by the generator`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`${files.length} synthetic sessions match the generator.`);
  }
} else {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(path.join(dir, f));
  for (const [name, text] of files) writeFileSync(path.join(dir, name), text);
  console.log(`Wrote ${files.length} synthetic sessions to ${path.relative(process.cwd(), dir)}`);
}
