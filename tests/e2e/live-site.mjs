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
// 4. Webcam mode with WebGL blocked on every canvas type: the app must explain
//    how to turn it on, not open the camera, and not throw. (--disable-3d-apis
//    alone is not enough: OffscreenCanvas keeps WebGL, and the app correctly
//    runs on it.)
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

  // 2b. Praise, voice choice, pause and bug report, on the demo with an 8x
  // clock (so the 20 s first praise lands inside the demo's 20 s good half)
  // and a recording speechSynthesis stub with a robotic and a natural voice.
  {
    const { page, errors } = await newPage(browser);
    await page.addInitScript(() => {
      const realNow = performance.now.bind(performance);
      const t0 = realNow();
      performance.now = () => t0 + (realNow() - t0) * 8;
      const voices = [
        { name: "eSpeak English", lang: "en-US", localService: true, default: true },
        { name: "Google US English", lang: "en-US", localService: false, default: false },
      ];
      window.__spoken = [];
      const ss = new EventTarget();
      ss.getVoices = () => voices;
      ss.speak = () => {};
      ss.cancel = () => {};
      Object.defineProperty(window, "speechSynthesis", { value: ss, configurable: true });
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
      // The app announces each spoken line and whether it used a clip.
      document.addEventListener("pg:speak", (e) => window.__spoken.push(e.detail));
    });
    await page.goto(`${base}app/${bust}`);
    await page.waitForFunction(() => document.getElementById("voice-note").textContent.includes("Kokoro"), null, { timeout: 10000 }).catch(() => {});
    const voice = await page.evaluate(() => ({
      note: document.getElementById("voice-note").textContent,
      selected: document.getElementById("voice-pick").value,
      praiseDefault: document.getElementById("spoken-praise").checked,
    }));
    check("voice: recorded Kokoro voice is the default", voice.selected.startsWith("kokoro:") && voice.note.includes("Kokoro"), voice);
    check("voice: spoken praise is off by default", voice.praiseDefault === false, voice);
    const clip = await page.evaluate(async () => {
      const m = await (await fetch("./voice/manifest.json")).json();
      const file = m.voices.af_heart["Looking good."];
      const r = await fetch(`./voice/${file}`);
      return { file, status: r.status, type: r.headers.get("content-type"), bytes: (await r.arrayBuffer()).byteLength };
    });
    check("voice: clips are deployed", clip.status === 200 && clip.bytes > 2000, clip);
    await page.check("#spoken-praise"); // opt in, to check praise is spoken with a clip
    await page.click("#start-demo");
    await page.waitForTimeout(700); // ~5 s simulated: GOOD, counting toward the first praise
    const hold = await page.evaluate(() => ({
      cls: document.getElementById("hold-bar").className,
      text: document.getElementById("hold-text").textContent,
      width: document.getElementById("hold-fill").style.width,
    }));
    check("hold bar fills toward the next praise", hold.cls.includes("good") && /looking good/i.test(hold.text) && parseFloat(hold.width) > 0, hold);
    await page.waitForFunction(() => window.__spoken.length >= 1, null, { timeout: 15000 }).catch(() => {});
    const spoken = await page.evaluate(() => window.__spoken.slice());
    check("praise: spoken with the recorded voice when opted in",
      spoken.length >= 1 && spoken[0].engine === "kokoro" && /good|nice|posture|champion|keep/i.test(spoken[0].text),
      spoken);
    await page.keyboard.press("p");
    const pausedBadge = await page.textContent("#state-badge");
    const before = await page.evaluate(() => [window.__spoken.length, document.getElementById("reminder-count").textContent]);
    await page.waitForTimeout(4000); // sim 32 s: the whole slouch half would chime without the pause
    const after = await page.evaluate(() => [window.__spoken.length, document.getElementById("reminder-count").textContent]);
    check("pause: no reminders or speech while paused",
      pausedBadge === "paused" && before[0] === after[0] && before[1] === after[1], { pausedBadge, before, after });
    await page.click("#pause");
    await page.waitForTimeout(1500);
    const resumed = await page.textContent("#state-badge");
    check("pause: resume restarts tracking", resumed !== "paused", { resumed });
    const spokenBeforeTest = await page.evaluate(() => window.__spoken.length);
    await page.click("#test-start");
    await page.waitForTimeout(3000); // sim 24 s: the demo slouches in this window, yet nothing may fire
    const silent = await page.evaluate((n) => ({
      badge: document.getElementById("state-badge").textContent,
      testing: document.body.classList.contains("testing"),
      needleShown: getComputedStyle(document.querySelector(".panel.coaching")).display !== "none",
      spoke: window.__spoken.length - n,
      status: document.getElementById("test-status").textContent,
    }), spokenBeforeTest);
    check("silent test: hides feedback and stays quiet",
      silent.badge === "silent test" && silent.testing && !silent.needleShown && silent.spoke === 0 && /left/.test(silent.status), silent);
    await page.click("#test-start"); // stop early: not saved
    check("silent test: stopping early is not saved",
      (await page.evaluate(() => (JSON.parse(localStorage.getItem("posture-guard:v1")).tests || []).length)) === 0);
    await page.click("#report-bug").catch(() => {}); // opens a new tab; only the href matters
    const href = await page.getAttribute("#report-bug", "href");
    const issue = new URL(href);
    const body = issue.searchParams.get("body") || "";
    check("bug report: pre-fills a GitHub issue with diagnostics",
      issue.pathname === "/arii/posture-guard/issues/new" && body.includes("WebGL:") && body.includes("Browser:"),
      { href: href.slice(0, 200) });
    await page.screenshot({ path: path.join(outDir, "demo-praise-pause.png") });
    check("praise/pause/report: no page errors", errors.length === 0, errors);
    report.praise = { spoken, pausedBadge, resumed };
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
  // 4. No WebGL: a separate browser, since the flag is per launch.
  {
    const noGL = await chromium.launch({
      args: ["--disable-3d-apis", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      const { page, errors } = await newPage(noGL);
      await page.addInitScript(() => {
        const kinds = [HTMLCanvasElement, typeof OffscreenCanvas !== "undefined" ? OffscreenCanvas : null];
        for (const C of kinds.filter(Boolean)) {
          const orig = C.prototype.getContext;
          C.prototype.getContext = function (type, ...rest) {
            return /webgl/i.test(type) ? null : orig.call(this, type, ...rest);
          };
        }
      });
      await page.goto(`${base}app/${bust}`);
      const gl = await page.evaluate(() => Boolean(
        document.createElement("canvas").getContext("webgl") ||
        (typeof OffscreenCanvas !== "undefined" && new OffscreenCanvas(1, 1).getContext("webgl2"))));
      await page.click("#start-camera");
      await page.waitForTimeout(1500);
      const s = await page.evaluate(() => ({
        help: getComputedStyle(document.getElementById("webgl-help")).display,
        overlay: getComputedStyle(document.getElementById("start-overlay")).display,
        streams: document.getElementById("video").srcObject === null ? 0 : 1,
      }));
      await page.screenshot({ path: path.join(outDir, "no-webgl.png") });
      check("no WebGL: explains how to turn it on", !gl && s.help === "block" && s.overlay !== "none", { gl, ...s });
      check("no WebGL: camera not opened", s.streams === 0, s);
      check("no WebGL: no page errors", errors.length === 0, errors);
      await page.close();
    } finally {
      await noGL.close();
    }
  }
} finally {
  await browser.close();
  writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
}
process.exit(failed ? 1 : 0);
