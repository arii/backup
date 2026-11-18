// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// Records real footage of the DEPLOYED app for the demo video, plus the
// timestamps the video edits on (when the reminder fired, when it spoke, ...).
//
//   node scripts/capture.mjs [base-url] [fake-camera.y4m] [out-dir]
//
// Writes <out-dir>/footage/{demo,webcam,landing}.webm and <out-dir>/capture.json
// (Remotion props: --props=public/capture.json). Needs Chromium from Playwright
// and the internet (GitHub Pages, jsDelivr, Google's model bucket).

import { chromium } from "playwright";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const [base = "https://arii.github.io/posture-guard/", y4m, out = "public"] = process.argv.slice(2);
const footageDir = path.join(out, "footage");
mkdirSync(footageDir, { recursive: true });
const SIZE = { width: 1280, height: 800 };
const bust = () => `?v=${Date.now()}`;

const text = (page, id) => page.evaluate((i) => document.getElementById(i).textContent, id);
const reminders = (page) => text(page, "reminder-count").then(Number);

async function record(name, args, script) {
  const browser = await chromium.launch({ args });
  const rawDir = path.join(footageDir, `${name}-raw`);
  rmSync(rawDir, { recursive: true, force: true });
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: rawDir, size: SIZE },
    permissions: ["camera"],
  });
  const page = await context.newPage();
  const t0 = Date.now();
  const now = () => Math.round((Date.now() - t0) / 100) / 10; // seconds into the clip
  let marks;
  try {
    marks = await script(page, now);
  } finally {
    await context.close(); // flushes the video file
    await browser.close();
  }
  const [file] = readdirSync(rawDir).filter((f) => f.endsWith(".webm"));
  renameSync(path.join(rawDir, file), path.join(footageDir, `${name}.webm`));
  rmSync(rawDir, { recursive: true, force: true });
  console.log(`recorded ${name}.webm`, marks);
  return { src: `footage/${name}.webm`, ...marks };
}

// 1. Demo mode: 20 s upright, then 20 s slouched (the app's scripted demo).
const demo = await record("demo", [], async (page, now) => {
  await page.goto(`${base}app/${bust()}`);
  await page.waitForTimeout(1200);
  await page.click("#start-demo");
  await page.waitForFunction(
    () => document.getElementById("state-badge").textContent === "good posture", null,
    { timeout: 15000 });
  const good = now();
  await page.waitForFunction(
    () => Number(document.getElementById("reminder-count").textContent) >= 1, null,
    { timeout: 45000 });
  const chime = now();
  await page.waitForFunction(
    () => Number(document.getElementById("reminder-count").textContent) >= 2, null,
    { timeout: 20000 });
  const voice = now();
  const cue = await text(page, "fix-title");
  const fix = await text(page, "fix-how");
  await page.waitForFunction(
    () => document.getElementById("state-badge").textContent === "good posture", null,
    { timeout: 25000 });
  const recovered = now();
  await page.waitForTimeout(3000);
  return { good, chime, voice, recovered, end: now(), cue, fix };
});

// 2. Webcam mode: the real pose model on a real (fake-camera) person.
let webcam = null;
if (y4m && existsSync(y4m)) {
  webcam = await record("webcam", [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${y4m}`,
  ], async (page, now) => {
    await page.goto(`${base}app/${bust()}`);
    await page.waitForTimeout(1000);
    await page.click("#start-camera");
    await page.waitForFunction(
      () => getComputedStyle(document.getElementById("start-overlay")).display === "none", null,
      { timeout: 90000 });
    const live = now();
    // The fake feed tilts the photo after a few seconds; see if that reminds.
    let reminder = null;
    const deadline = Date.now() + 16000;
    while (Date.now() < deadline) {
      if ((await reminders(page)) >= 1) { reminder = now(); break; }
      await page.waitForTimeout(250);
    }
    const cue = await text(page, "fix-title");
    await page.waitForTimeout(3000);
    return { live, reminder, cue, end: now() };
  });
}

// 3. Landing page, scrolled top to bottom.
const landing = await record("landing", [], async (page, now) => {
  await page.goto(`${base}${bust()}`);
  await page.waitForTimeout(1500);
  const height = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
  const start = now();
  for (let y = 0; y <= height; y += 24) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(1000);
  return { start, end: now() };
});

const props = { demo, webcam, landing, userClip: null, userClipSeconds: 0 };
writeFileSync(path.join(out, "capture.json"), JSON.stringify(props, null, 2));
console.log("wrote", path.join(out, "capture.json"));
