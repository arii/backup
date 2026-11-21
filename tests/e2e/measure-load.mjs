// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Load-time and page-density measurement for the first-run experience
// (.kiro/specs/progressive-loading, requirement 10). Not part of CI: timings from
// headless Chromium with software WebGL (SwiftShader) are relative, not absolute.
//
//   node tests/e2e/measure-load.mjs <base-url> <fake-camera.y4m|""> <out-dir> [scenarios]
//
// scenarios: comma list of desk (1280x800), m320 (320x640), slow (1280x800 with the
// network held to about 1.5 Mbit/s). Default: all three. Prints one JSON object.
//
// Marks are milliseconds from the click on Start with webcam:
//   videoDecoded   the video element has frames (it may still be covered)
//   videoVisible   frames are playing AND nothing from #start-overlay covers the
//                  centre of the video (so a covering overlay does not count)
//   firstScored    the badge left "waiting"/"no one in view" or a metric has a number
//   settled        the badge is no longer "waiting", "settling in" or "no one in view"
// Density snapshots (visible words, controls, checkboxes and radios) are taken at
// landing, after onboarding, and when tracking is settled. Run it before and after a
// change with the same arguments to compare.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const [base = "http://localhost:8123/", y4m = "", outDir = "measure-load-report", only = "desk,m320,slow"] =
  process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const url = `${base}app/`;

const snap = (page) =>
  page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.visibility !== "hidden" &&
        s.display !== "none" &&
        !e.closest("[hidden]") &&
        !e.closest("details:not([open]) > :not(summary)")
      );
    };
    const ctrls = [...document.querySelectorAll("button,input,select,a[href],summary")].filter(vis);
    const checks = ctrls.filter((e) => e.type === "checkbox" || e.type === "radio");
    const inView = (e) => {
      const r = e.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0;
    };
    let words = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const p = t.parentElement;
      if (!p || ["SCRIPT", "STYLE"].includes(p.tagName) || !vis(p)) continue;
      words += t.textContent.trim().split(/\s+/).filter(Boolean).length;
    }
    // Words in <main> outside the stage, the first-run guide card and the "Not working?"
    // help panel (it opens itself when a setup fault is found and is manual help, not a
    // staged panel). Requirement 4.9 budget: at most 150.
    let belowStageWords = 0;
    const w2 = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
    for (let t = w2.nextNode(); t; t = w2.nextNode()) {
      const p = t.parentElement;
      if (!p || ["SCRIPT", "STYLE"].includes(p.tagName) || p.closest(".stage, #first-run, #setup-panel") || !vis(p))
        continue;
      belowStageWords += t.textContent.trim().split(/\s+/).filter(Boolean).length;
    }
    return {
      words,
      belowStageWords,
      controls: ctrls.length,
      checkboxesRadios: checks.length,
      controlsInFirstViewport: ctrls.filter(inView).length,
    };
  });

const videoVisible = () => {
  const v = document.getElementById("video");
  if (!v || v.readyState < 2 || v.paused) return false;
  const r = v.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!top && !top.closest("#start-overlay");
};
const videoDecoded = () => {
  const v = document.getElementById("video");
  return !!v && v.readyState >= 2 && !v.paused;
};
const firstScored = () => {
  const t = document.getElementById("state-badge").textContent;
  return (
    !["waiting", "no one in view"].includes(t) || /\d/.test(document.getElementById("m-head_forward_deg").textContent)
  );
};
const settled = () =>
  !["waiting", "settling in", "no one in view"].includes(document.getElementById("state-badge").textContent);

async function run(label, viewport, { throttle = false } = {}) {
  const args = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
  ];
  if (y4m) args.push(`--use-file-for-fake-video-capture=${y4m}`);
  const browser = await chromium.launch({ args });
  try {
    const ctx = await browser.newContext({ viewport, permissions: ["camera"] });
    const page = await ctx.newPage();
    if (throttle) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 40,
        downloadThroughput: 187500, // 1.5 Mbit/s
        uploadThroughput: 96000,
      });
    }
    const out = { label, viewport, marks: {} };
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "commit" });
    await page.waitForSelector("#start-overlay", { state: "attached" });
    out.marks.firstContentfulPaint = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const f = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
          if (f) return resolve(Math.round(f.startTime));
          new PerformanceObserver((list, obs) => {
            resolve(Math.round(list.getEntries()[0].startTime));
            obs.disconnect();
          }).observe({ type: "paint", buffered: true });
        }),
    );
    await page.waitForLoadState("load");
    out.marks.load = Date.now() - t0;
    out.landing = await snap(page);
    await page.screenshot({ path: path.join(outDir, `${label}-0-landing.png`) });

    // First-run walkthrough, when shown, then the safety acknowledgement.
    let steps = 0;
    if (await page.locator("#ob-next").isVisible()) {
      while (await page.locator("#ob-next").isVisible()) {
        await page.click("#ob-next");
        steps++;
      }
      await page.click("#ob-ack");
    }
    out.onboardingSteps = steps;
    out.startReady = await snap(page);
    await page.screenshot({ path: path.join(outDir, `${label}-1-start-ready.png`) });

    const t1 = Date.now();
    await page.click("#start-camera");
    const poll = async (name, fn, max = 150000) => {
      const s = Date.now();
      while (Date.now() - s < max) {
        if (await page.evaluate(fn)) {
          out.marks[name] = Date.now() - t1;
          return;
        }
        await page.waitForTimeout(50);
      }
      out.marks[name] = "timeout";
    };
    await poll("videoDecoded", videoDecoded);
    await poll("videoVisible", videoVisible);
    await page.screenshot({ path: path.join(outDir, `${label}-2-video-visible.png`) });
    await poll("firstScored", firstScored);
    await poll("settled", settled, 30000);
    out.settledSnapshot = await snap(page);
    // Stage 2 (the needle panel appears after 10 s of settled tracking).
    await poll("stage2", () => !document.getElementById("needle-text").closest("[data-stage]")?.hidden, 40000);
    out.stage2Snapshot = await snap(page);
    out.loadMarks = await page.evaluate(() => window.__loadMarks ?? null);
    await page.screenshot({ path: path.join(outDir, `${label}-3-settled.png`), fullPage: true });
    return out;
  } finally {
    await browser.close();
  }
}

const scenarios = {
  desk: () => run("desk", { width: 1280, height: 800 }),
  m320: () => run("m320", { width: 320, height: 640 }),
  slow: () => run("slow", { width: 1280, height: 800 }, { throttle: true }),
};
const results = [];
for (const name of only.split(",")) {
  if (!scenarios[name]) throw new Error(`unknown scenario ${name}`);
  results.push(await scenarios[name]());
}
console.log(JSON.stringify({ base, results }, null, 2));
