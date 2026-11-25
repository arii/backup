// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Text output for the eval: a console table, the calibration-cost table, and the
// before/after table to paste into a PR when the baseline is updated on purpose.

import { ROWS } from "./metrics.mjs";
import { flatten } from "./gate.mjs";

const pct = (v) => (v === null ? "  n/a" : `${(v * 100).toFixed(1).padStart(5)}%`);
const signed = (v) => (v === null ? "  n/a" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} pts`.padStart(10));

export function formatTable(summary) {
  const lines = [];
  for (const [dataset, paths] of Object.entries(summary)) {
    for (const [path, legs] of Object.entries(paths)) {
      for (const [leg, group] of Object.entries(legs)) {
        lines.push(`${dataset} | ${path} | calibration: ${leg} | ${group.sessions} sessions`);
        lines.push(
          `  ${"row".padEnd(15)} ${"precision".padStart(9)} ${"recall".padStart(8)}  ${"tp".padStart(5)} ${"fp".padStart(5)} ${"fn".padStart(5)}`,
        );
        for (const row of ROWS) {
          const v = group.rows[row];
          lines.push(
            `  ${row.padEnd(15)} ${pct(v.precision).padStart(9)} ${pct(v.recall).padStart(8)}  ${String(v.tp).padStart(5)} ${String(v.fp).padStart(5)} ${String(v.fn).padStart(5)}`,
          );
        }
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}

export function formatCost(cost) {
  const lines = [];
  for (const [dataset, paths] of Object.entries(cost)) {
    for (const [path, rows] of Object.entries(paths)) {
      lines.push(`${dataset} | ${path} | cost of a mid-movement calibration (mid_movement minus comfortable)`);
      lines.push(`  ${"row".padEnd(15)} ${"precision".padStart(10)} ${"recall".padStart(10)}`);
      for (const row of ROWS)
        lines.push(
          `  ${row.padEnd(15)} ${signed(rows[row].precision).padStart(10)} ${signed(rows[row].recall).padStart(10)}`,
        );
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** Markdown rows for every number that changed, for the PR body. */
export function formatBaselineDiff(before, after) {
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  const rows = keys
    .filter((k) => a.get(k) !== b.get(k))
    .map((k) => `| ${k} | ${pct(a.get(k) ?? null).trim()} | ${pct(b.get(k) ?? null).trim()} |`);
  if (!rows.length) return "No numbers changed.";
  return ["| number | before | after |", "| --- | --- | --- |", ...rows].join("\n");
}
