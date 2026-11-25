// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Reads labeled sessions from tests/eval/data/<dataset>/*.json and validates each one.
// Local files only: nothing is fetched or uploaded.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSession } from "./schema.mjs";

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");

/** Every dataset directory under `root`, sorted, so the run order never depends on the disk. */
export function loadDatasets(root = DATA_DIR) {
  const sessions = [];
  const hash = createHash("sha256");
  const datasets = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const dataset of datasets) {
    const files = readdirSync(path.join(root, dataset))
      .filter((f) => f.endsWith(".json"))
      .sort();
    for (const file of files) {
      const text = readFileSync(path.join(root, dataset, file), "utf8");
      const session = JSON.parse(text);
      const problems = validateSession(session);
      if (problems.length) throw new Error(`${dataset}/${file}: ${problems.join("; ")}`);
      hash.update(`${dataset}/${file}\n${text}`);
      sessions.push({ dataset, session });
    }
  }
  return { sessions, sha256: hash.digest("hex") };
}
