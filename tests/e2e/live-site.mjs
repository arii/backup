// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// End-to-end check of the DEPLOYED browser app (GitHub Pages), run by
// .github/workflows/live-site.yml. Not part of `node --test tests/js/`: it
// needs the internet (Pages, jsDelivr, Google's model bucket) and Chromium.
//
//   node tests/e2e/live-site.mjs <base-url> <fake-camera.y4m> <out-dir>
//
// 1. Landing page loads and links to ./app/.
// 2. Demo mode: GOOD, then the scripted slouch triggers a reminder.
// 3. Webcam mode with Chromium's fake camera playing a photo of a person:
//    the real tasks-vision bundle, WASM and pose model load from the CDN and
//    detectForVideo finds the person (metrics shown, any state except "no one
//    in view"), and the person - who is standing upright - gets no reminder.
// Screenshots and a JSON report go to <out-dir> (uploaded as an artifact).

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [base = "https://arii.github.io/posture-guard/", y4m, outDir = "live-site-report"] =
  process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const bust = `?v=${Date.now()}`;
const report = { base, checks: [] };
let failed = false;

function check(name, ok, detail) {
  report.checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failed = true;
}

async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.grantPermissions(["camera"]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return { page, errors };
}

const ui = (page) => page.evaluate(() => ({
  badge: document.getElementById("state-badge").textContent,
  source: document.getElementById("source").textContent,
  warning: document.getElementById("warnings").textContent,
  needle: document.getElementById("needle-text").textContent,
  reminders: document.getElementById("reminder-count").textContent,
  headForward: document.getElementById("m-head_forward_deg").textContent,
  shoulderLevel: document.getElementById("m-shoulder_level_deg").textContent,
  startError: document.getElementById("start-error").textContent,
  overlay: getComputedStyle(document.getElementById("start-overlay")).display,
}));

const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
if (y4m) args.push(`--use-file-for-fake-video-capture=${y4m}`);
const browser = await chromium.launch({ args });

try {
  // 1. Landing page.
  {
    const { page, errors } = await newPage(browser);
    const resp = await page.goto(base + bust);
    const html = await page.content();
    check("landing page loads", resp.status() === 200, { status: resp.status() });
    check("landing page links to the app", html.includes('href="./app/"'));
    check("landing page has no errors", errors.length === 0, errors);
    await page.close();
  }

  // 2. Demo mode: 20 s good, then 20 s slouch; the reminder fires ~2 s into the slouch.
  {
    const { page, errors } = await newPage(browser);
    const resp = await page.goto(`${base}app/${bust}`);
    check("app page loads", resp.status() === 200, { status: resp.status() });
    await page.click("#start-demo");
    await page.waitForTimeout(5000);
    const early = await ui(page);
    check("demo starts in good posture", early.badge === "good posture", early);
    await page.waitForFunction(
      () => Number(document.getElementById("reminder-count").textContent) >= 1,
      null, { timeout: 40000 },
    );
    const slouch = await ui(page);
    check("demo slouch triggers a reminder", slouch.badge === "sit up", slouch);
    await page.screenshot({ path: path.join(outDir, "demo-slouch.png") });
    check("demo has no errors", errors.length === 0, errors);
    report.demo = { early, slouch };
    await page.close();
  }

  // 3. Webcam mode: real model from the CDN on a fake camera.
  {
    const { page, errors } = await newPage(browser);
    await page.goto(`${base}app/${bust}`);
    const t0 = Date.now();
    await page.click("#start-camera");
    await page.waitForFunction(
      () => getComputedStyle(document.getElementById("start-overlay")).display === "none" ||
        document.getElementById("start-error").textContent !== "",
      null, { timeout: 90000 },
    );
    const loaded = await ui(page);
    check("webcam mode starts (CDN bundle, WASM and model load)",
      loaded.overlay === "none" && loaded.source === "webcam", { ...loaded, seconds: (Date.now() - t0) / 1000 });
    // Give the detector a few seconds on the looping fake camera frame.
    await page.waitForTimeout(8000);
    const seen = await ui(page);
    report.webcam = { loaded, seen };
    await page.screenshot({ path: path.join(outDir, "webcam-fake-camera.png") });
    if (y4m) {
      check("pose detected on the fake camera feed",
        seen.badge !== "no one in view" && seen.badge !== "waiting" && seen.headForward !== "-", seen);
      check("upright person gets no reminder", seen.reminders === "0", seen);
    }
    check("webcam mode has no errors", errors.length === 0, errors);
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
}
process.exit(failed ? 1 : 0);
