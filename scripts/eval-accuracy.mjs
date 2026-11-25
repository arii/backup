// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Accuracy eval: replays the labeled sessions in tests/eval/data/ through the real
// PostureEngine and reports precision and recall (slouching is the positive class).
//
//   node scripts/eval-accuracy.mjs                    print the table, write the JSON
//   node scripts/eval-accuracy.mjs --check            also fail if any number drops below tests/eval/baseline.json
//   node scripts/eval-accuracy.mjs --update-baseline  rewrite the baseline and print the before/after table
//   node scripts/eval-accuracy.mjs --ci               --check, but a pull request that touches no scoring/eval file skips
//   --out <file>                                      where to write the JSON (default tests/eval/results/latest.json)

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calibrationCost, evaluate } from "../tests/eval/harness.mjs";
import { compare, evalTriggered } from "../tests/eval/gate.mjs";
import { loadDatasets } from "../tests/eval/load.mjs";
import { formatBaselineDiff, formatCost, formatTable } from "../tests/eval/report.mjs";
import { changedPaths } from "./ci-prose-only.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(root, "tests/eval/baseline.json");
const NOTE =
  "Baseline numbers for the accuracy eval. Datasets named synthetic are generated, so these numbers check the harness; they are not an accuracy claim about real people.";

function readBaseline() {
  return JSON.parse(readFileSync(BASELINE, "utf8"));
}

function skipForUnrelatedPr(env) {
  if (env.EVENT_NAME !== "pull_request") return false;
  try {
    return !evalTriggered(changedPaths(env.BASE_SHA, env.HEAD_SHA));
  } catch {
    console.warn("Could not establish the changed files; running the eval.");
    return false;
  }
}

function main(argv, env) {
  const flag = (name) => argv.includes(name);
  const outIndex = argv.indexOf("--out");
  const out = outIndex >= 0 ? path.resolve(argv[outIndex + 1]) : path.join(root, "tests/eval/results/latest.json");

  if (flag("--ci") && skipForUnrelatedPr(env)) {
    console.log("No scoring or eval file changed in this pull request; accuracy eval skipped.");
    return 0;
  }

  const { sessions, sha256 } = loadDatasets();
  const { summary, sessions: perSession } = evaluate(sessions);
  const cost = calibrationCost(summary);
  const table = `${formatTable(summary)}\n${formatCost(cost)}`;
  console.log(table);
  const failedSaves = perSession.filter((s) => s.calibration_saved === false).map((s) => s.id);
  if (failedSaves.length) console.log(`Calibration did not save in: ${failedSaves.join(", ")}`);

  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ dataset_sha256: sha256, summary, calibration_cost: cost, sessions: perSession }, null, 2)}\n`,
  );
  console.log(`Wrote ${path.relative(root, out)}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\`\`\`\n${table}\n\`\`\`\n`);

  if (flag("--update-baseline")) {
    let before = {};
    try {
      before = readBaseline().summary;
    } catch {
      // first baseline
    }
    writeFileSync(BASELINE, `${JSON.stringify({ note: NOTE, dataset_sha256: sha256, summary }, null, 2)}\n`);
    console.log(`Updated ${path.relative(root, BASELINE)}. Paste this into the PR body:\n`);
    console.log(formatBaselineDiff(before, summary));
    return 0;
  }

  if (flag("--check") || flag("--ci")) {
    const { regressions, improvements } = compare(readBaseline().summary, summary);
    for (const r of regressions)
      console.error(`REGRESSION ${r.key}: baseline ${r.baseline} -> ${r.current} (${r.reason})`);
    if (regressions.length) {
      console.error(
        `\n${regressions.length} number(s) fell below tests/eval/baseline.json. Fix the change, or if the drop is intended run npm run eval:update-baseline and record before/after in the PR body (tests/eval/README.md).`,
      );
      return 1;
    }
    console.log(`Gate passed: no precision or recall below the baseline. ${improvements.length} number(s) improved.`);
    if (improvements.length)
      console.log("To lock in an improvement: npm run eval:update-baseline, and record before/after in the PR body.");
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2), process.env);
