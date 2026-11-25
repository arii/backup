// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// The accuracy gate as a unit test: the current engine, run over the committed labeled
// sessions, must not score below tests/eval/baseline.json. A scoring change that lowers a
// number fails here until the baseline is updated on purpose (tests/eval/README.md).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compare } from "../eval/gate.mjs";
import { evaluate } from "../eval/harness.mjs";
import { loadDatasets } from "../eval/load.mjs";

test("no precision or recall is below the committed baseline", () => {
  const baseline = JSON.parse(readFileSync(new URL("../eval/baseline.json", import.meta.url), "utf8"));
  const { summary } = evaluate(loadDatasets().sessions);
  const { regressions } = compare(baseline.summary, summary);
  const lines = regressions.map((r) => `${r.key}: ${r.baseline} -> ${r.current} (${r.reason})`);
  assert.deepEqual(lines, [], "fix the change, or update the baseline on purpose: tests/eval/README.md");
});
