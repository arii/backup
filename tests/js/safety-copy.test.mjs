// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// safety-and-disclaimers tasks 7, 8 and 9: no health claims in user-facing copy,
// static copies of the safety text match onboarding.js, and every wellness tool
// carries its own "stop if it hurts" line.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GUIDE_SAFETY } from "../../docs/app/breathing.js";
import { MILESTONE_TEXT } from "../../docs/app/feedback.js";
import { ONBOARDING_STEPS, RELAX_SAFETY, SAFETY_POINTS, SAFETY_SHORT } from "../../docs/app/onboarding.js";
import { ALL_LINES } from "../../docs/app/voice-lines.js";
import { TOOL_SAFETY, toolSafety } from "../../docs/app/wellness.js";

const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

/** Visible text of an HTML file, whitespace collapsed. */
const htmlText = (f) =>
  read(f)
    .replace(/<(style|script)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/** Markdown with quote marks, bold and line wraps removed. */
const mdText = (f) => read(f).replace(/^>\s?/gm, "").replace(/\*\*/g, "").replace(/\s+/g, " ");

const norm = (s) => s.replace(/\s+/g, " ").trim();

// Claims discipline (requirement 6): a sentence that names a condition or a cure
// must say the app does NOT do it.
const CLAIM =
  /\b(prevents?|cures?|cured|heals?|therap(y|eutic)|clinically (proven|validated|tested)|proven to|guaranteed?|relieves? (your )?(back|neck|pain)|eliminates? (pain|strain)|reduces? (your )?(back|neck) pain|fix(es)? your (back|neck))\b|\btreat(s|ing)? (back|neck|pain|your|any|conditions?|headaches?)|\bdiagnos(es|ing)\b/i;
const NEGATED = /\b(not|n't|no|never|nothing|without|weak|neither)\b/i;

function claimsIn(text) {
  return text.split(/(?<=[.!?])\s+/).filter((sentence) => CLAIM.test(sentence) && !NEGATED.test(sentence));
}

test("the claim lint flags a health claim and allows a disclaimer", () => {
  assert.equal(claimsIn("BackUp prevents back pain.").length, 1);
  assert.equal(claimsIn("It cures neck strain!").length, 1);
  assert.equal(claimsIn("Clinically proven to help.").length, 1);
  assert.equal(claimsIn("It does not diagnose, treat or prevent any condition.").length, 0);
  assert.equal(claimsIn("A nudge to sit up is a nudge, not a cure.").length, 0);
  assert.equal(claimsIn("It reminds you and gives you a nudge.").length, 0);
});

test("no user-facing copy claims to prevent, treat or cure anything", () => {
  const copy = {
    "docs/app/index.html": htmlText("docs/app/index.html"),
    "docs/index.html": htmlText("docs/index.html"),
    "docs/privacy.html": htmlText("docs/privacy.html"),
    "README.md": mdText("README.md"),
    "KIROWEEN.md": mdText("KIROWEEN.md"),
    "voice-lines.js": ALL_LINES.join(". "),
    "onboarding.js": [
      ...SAFETY_POINTS,
      SAFETY_SHORT,
      RELAX_SAFETY,
      ...ONBOARDING_STEPS.flatMap((s) => [s.title, ...s.points]),
    ].join(" "),
    "feedback.js": Object.values(MILESTONE_TEXT).join(". "),
    "wellness.js": Object.values(TOOL_SAFETY).join(". "),
  };
  for (const [file, text] of Object.entries(copy)) {
    assert.deepEqual(claimsIn(text), [], `health claim in ${file}`);
  }
});

test("the static safety notices carry the exact SAFETY_SHORT sentences", () => {
  const sentences = SAFETY_SHORT.split(/(?<=\.)\s+/).map(norm);
  assert.equal(sentences.length, 3);
  for (const f of ["docs/index.html"]) {
    const text = htmlText(f);
    for (const sentence of sentences) assert.ok(text.includes(sentence), `${f} is missing: ${sentence}`);
  }
  const readme = mdText("README.md");
  for (const sentence of sentences) assert.ok(readme.includes(sentence), `README.md is missing: ${sentence}`);
});

test("the README safety list carries the SAFETY_POINTS that apply to a static page", () => {
  const readme = mdText("README.md");
  // README may add a sentence about the research; every sentence of each point must appear as written.
  for (const point of SAFETY_POINTS.slice(0, 5)) {
    for (const sentence of norm(point).split(/(?<=\.)\s+/)) {
      assert.ok(readme.includes(sentence), `README.md is missing: ${sentence}`);
    }
  }
});

test("the privacy page and the app footer carry the same disclaimer", () => {
  assert.match(htmlText("docs/privacy.html"), /not a medical device/);
  assert.match(htmlText("docs/privacy.html"), /rigid posture/);
  assert.equal(SAFETY_SHORT.includes("wellness tool, not medical advice or a medical device"), true);
});

test("every wellness tool says to stop if it hurts or makes you dizzy", () => {
  for (const id of ["stretch", "move", "eye", "jaw", "breathing", "offer", "guide"]) {
    assert.match(TOOL_SAFETY[id], /\bstop\b.*\b(hurts?|dizzy)\b/i, id);
  }
  assert.equal(toolSafety("demo", "stretch"), TOOL_SAFETY.stretch);
  assert.equal(toolSafety("demo", "move"), TOOL_SAFETY.move);
  assert.equal(toolSafety("water", undefined), "");
  assert.match(GUIDE_SAFETY, /Stop/);
});

test("the app page carries the tool safety lines", () => {
  const html = htmlText("docs/app/index.html");
  assert.match(html, /Stop if you feel dizzy/);
  assert.match(html, /Stop if anything hurts/);
});
