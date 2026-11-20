// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// privacy.js: pure helpers for what the app stores and what a bug report shares.
// Node-testable (no DOM): app.js passes in the storage object and the facts.

/** Every localStorage key the app writes. "Delete my data" removes all of them. */
export const STORE_KEYS = Object.freeze(["posture-guard:v1"]);

export const PUBLIC_WARNING =
  "\u26a0 This issue will be public. Check the diagnostics below and delete anything you don't want to share.";

export const BUG_LINK_TIP = "Opens GitHub with a pre-filled public issue (needs a GitHub account).";

/** Remove all app data from `storage`. Returns true when every key is gone. */
export function clearStoredData(storage, keys = STORE_KEYS) {
  try {
    for (const k of keys) storage.removeItem(k);
    return keys.every((k) => storage.getItem(k) === null);
  } catch {
    return false; // storage unavailable
  }
}

/** Strip URLs, file paths and email addresses from an error message, then cap it. */
export function sanitizeError(message, max = 200) {
  return String(message)
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, "<email>")
    .replace(/[A-Za-z]:\\[^\s'")]*/g, "<path>")
    .replace(/(^|[\s(='"])\/(?:[\w.@~-]+\/)+[\w.@~-]*/g, "$1<path>")
    .slice(0, max);
}

/** WebGL result without the GPU model: only whether it works, and which version. */
export function webglSummary(gl) {
  if (!gl) return "unavailable";
  return typeof gl.createVertexArray === "function" && typeof gl.texStorage2D === "function" ? "WebGL2 ok" : "WebGL1 ok";
}

/** @param {{diag: string, problems: string[]}} parts */
export function buildBugReportBody({ diag, problems }) {
  const errs = problems.length ? problems.join("\n") : "(none)";
  return [
    PUBLIC_WARNING, "",
    "**What happened?**", "", "", "",
    "**What did you expect?**", "", "", "",
    "**Steps to reproduce** (webcam or demo? what posture?)", "", "1. ", "",
    "<details open><summary>Diagnostics (filled in by the app, no video or images)</summary>", "",
    diag, "", "Recent errors:", "```", errs, "```", "</details>",
  ].join("\n");
}
