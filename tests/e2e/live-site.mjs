// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// End-to-end check of the browser app, run by .github/workflows/live-site.yml
// against the deployed GitHub Pages site or, on push, a locally served
// candidate build. Not part of `node --test tests/js/`: it needs the internet
// (Pages, jsDelivr, Google's model bucket) and Chromium.
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

// The first-run walkthrough hides the Start buttons until the safety notice is
// acknowledged. Every check except the first-run one pre-acknowledges it.
// Keep these in step with ONBOARDING_VERSION and ACK_VERSION in docs/app/onboarding.js.
const ONBOARDED = 1;
const ACKED = 1;

async function newPage(browser, { fresh = false, guide = false, viewport = { width: 1280, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport });
  await context.grantPermissions(["camera"]);
  if (!fresh) {
    await context.addInitScript(([onboarded, ackVersion, firstRunDone]) => {
      try {
        if (sessionStorage.getItem("pg-e2e-acked")) return; // seed once per tab, so a reload keeps what the app wrote
        sessionStorage.setItem("pg-e2e-acked", "1");
        const s = JSON.parse(localStorage.getItem("posture-guard:v1")) || {};
        s.onboarded = Math.max(s.onboarded || 0, onboarded);
        s.ackVersion = Math.max(s.ackVersion || 0, ackVersion);
        if (firstRunDone) s.firstRunDone = true; // the first-run guide card has its own check
        localStorage.setItem("posture-guard:v1", JSON.stringify(s));
      } catch { /* storage unavailable */ }
    }, [ONBOARDED, ACKED, !guide]);
  }
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

  // 2a. First run: a fresh profile sees the walkthrough and safety notice, and
  // the Start buttons only work after "I understand". Help replays it.
  {
    const { page, errors } = await newPage(browser, { fresh: true });
    await page.goto(`${base}app/${bust}`);
    const first = await page.evaluate(() => ({
      card: !document.getElementById("onboarding").hidden,
      title: document.getElementById("ob-title").textContent,
      demoVisible: document.getElementById("start-demo").offsetParent !== null,
      footer: document.getElementById("safety-footer").textContent,
    }));
    check("first run: onboarding card shows and the Start buttons are hidden",
      first.card && /How it works/.test(first.title) && !first.demoVisible && /not medical advice/i.test(first.footer), first);
    await page.screenshot({ path: path.join(outDir, "onboarding-step1.png") });
    await page.click("#ob-next");
    await page.click("#ob-next");
    const safety = await page.evaluate(() => ({
      title: document.getElementById("ob-title").textContent,
      text: document.getElementById("ob-body").textContent,
      ack: !document.getElementById("ob-ack").hidden,
    }));
    check("first run: step 3 is the safety notice with an acknowledgement button",
      safety.ack && /medical advice/.test(safety.text) && /rigid posture/.test(safety.text) && /numbness/.test(safety.text), safety);
    await page.screenshot({ path: path.join(outDir, "onboarding-step3.png") });
    await page.click("#ob-ack");
    const acked = await page.evaluate(() => ({
      stored: JSON.parse(localStorage.getItem("posture-guard:v1")),
      demoVisible: document.getElementById("start-demo").offsetParent !== null,
      cardHidden: document.getElementById("onboarding").hidden,
    }));
    check("first run: acknowledging stores the versions and shows the Start buttons",
      acked.stored.ackVersion === ACKED && acked.stored.onboarded === ONBOARDED && acked.demoVisible && acked.cardHidden, acked);
    await page.reload();
    const again = await page.evaluate(() => ({
      cardHidden: document.getElementById("onboarding").hidden,
      demoVisible: document.getElementById("start-demo").offsetParent !== null,
    }));
    check("first run: the acknowledgement persists across a reload", again.cardHidden && again.demoVisible, again);
    await page.click("#help-btn");
    const help = await page.evaluate(() => ({
      open: document.getElementById("help-dialog").open,
      text: document.getElementById("help-body").textContent,
    }));
    check("help: the button reopens the walkthrough with the safety notice",
      help.open && /How it works/.test(help.text) && /not a medical device/.test(help.text), { open: help.open });
    await page.screenshot({ path: path.join(outDir, "help-dialog.png") });
    await page.keyboard.press("Escape");
    await page.click("#start-demo");
    await page.waitForFunction(() => document.getElementById("state-badge").textContent === "good posture", null, { timeout: 15000 });
    check("first run: #start-demo works after acknowledging", true);
    await page.click("#safety-link");
    check("safety notice: the footer link opens the full notice",
      await page.evaluate(() => document.getElementById("safety-dialog").open && /as-is/.test(document.getElementById("safety-list").textContent)));
    await page.keyboard.press("Escape");
    await page.click("#progress-export", { trial: true });
    await page.screenshot({ path: path.join(outDir, "app-progress-desktop.png"), fullPage: true });
    check("first run: no page errors", errors.length === 0, errors);
    await page.close();
  }

  // 2c. Practice mode stays silent
  // and records nothing, progress panel reads store.days, export and delete.
  {
    const { page, errors } = await newPage(browser, { viewport: { width: 375, height: 800 } });
    await page.addInitScript(() => {
      const realNow = performance.now.bind(performance);
      const t0 = realNow();
      performance.now = () => t0 + (realNow() - t0) * 8;
      window.__spoken = [];
      document.addEventListener("pg:speak", (e) => window.__spoken.push(e.detail));
      const s = JSON.parse(localStorage.getItem("posture-guard:v1")) || {};
      if (!sessionStorage.getItem("pg-e2e-seeded")) {
        sessionStorage.setItem("pg-e2e-seeded", "1");
        const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
        s.days = { [day(1)]: { good: 1200, bad: 400 }, [day(2)]: { good: 900, bad: 900 } };
        s.tests = [{ at: new Date().toISOString(), minutes: 10, good: 480, bad: 120 }];
        localStorage.setItem("posture-guard:v1", JSON.stringify(s));
      }
    });
    await page.goto(`${base}app/${bust}`);
    const prog = await page.evaluate(() => ({
      rows: document.querySelectorAll("#progress-days .day-row").length,
      text: document.getElementById("progress-days").textContent,
      tests: document.getElementById("progress-tests").textContent,
      suggest: document.getElementById("progress-suggest").textContent,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    check("progress: 7 days from store.days, test trend, and a light-coaching suggestion",
      prog.rows === 7 && /75%/.test(prog.text) && /50%/.test(prog.text) && /80%/.test(prog.tests) && /light coaching/.test(prog.suggest), prog);
    check("375 px: no horizontal overflow on the start screen", !prog.overflow, prog);
    await page.screenshot({ path: path.join(outDir, "app-375-start.png"), fullPage: true });
    await page.click("#start-demo");
    await page.waitForFunction(() => document.getElementById("state-badge").textContent === "good posture", null, { timeout: 15000 });
    const before = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("posture-guard:v1")).days));
    await page.click("#help-btn");
    await page.click("#help-practice");
    await page.waitForFunction(() => document.getElementById("state-badge").textContent === "practice", null, { timeout: 5000 }).catch(() => {});
    const practice = await page.evaluate(() => ({
      on: document.body.classList.contains("practicing"),
      badge: document.getElementById("state-badge").textContent,
      step: document.getElementById("practice-text").textContent,
    }));
    check("practice: Learn the cues starts a silent practice", practice.on && practice.badge === "practice", practice);
    await page.click("#practice-next");
    await page.waitForTimeout(300);
    const focus = await page.evaluate(() => document.getElementById("t-head_forward").classList.contains("focus"));
    check("practice: the step highlights the matching tile", focus);
    const miniSeen = new Set();
    let miniInk = false;
    for (let i = 0; i < 12; i++) { // sim 24 s: the demo slouches meanwhile, yet nothing may fire
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const cv = document.getElementById("practice-mini-canvas");
        const px = cv.width && cv.height ? cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data : [];
        return { t: document.getElementById("practice-needle-rotor").getAttribute("transform"), ink: px.some((v, k) => k % 4 === 3 && v > 0), w: cv.clientWidth };
      });
      miniSeen.add(m.t); miniInk = miniInk || m.ink;
    }
    check("practice: mini skeleton canvas is drawn next to the instructions", miniInk);
    check("practice: mini needle moves between good and slouch in the demo", miniSeen.size > 1, [...miniSeen]);
    const quiet = await page.evaluate((b) => ({
      spoken: window.__spoken.length,
      reminders: document.getElementById("reminder-count").textContent,
      daysSame: JSON.stringify(JSON.parse(localStorage.getItem("posture-guard:v1")).days) === b,
    }), before);
    check("practice: no speech, no reminders, nothing recorded",
      quiet.spoken === 0 && quiet.reminders === "0" && quiet.daysSame, quiet);
    await page.screenshot({ path: path.join(outDir, "app-375-practice.png"), fullPage: true });
    await page.click("#practice-stop");
    await page.waitForFunction(() => !document.body.classList.contains("practicing"));
    // Export and delete.
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#progress-export")]);
    const exported = JSON.parse(await (await import("node:fs")).promises.readFile(await download.path(), "utf8"));
    check("progress: export is whitelisted JSON", exported.schema === 1 && !!exported.days && !("calibration" in exported), Object.keys(exported));
    page.once("dialog", (d) => d.accept());
    await page.click("#progress-delete");
    await page.waitForLoadState("load");
    await page.waitForTimeout(500);
    const gone = await page.evaluate(() => ({
      stored: localStorage.getItem("posture-guard:v1"),
      card: !document.getElementById("onboarding").hidden,
    }));
    check("progress: delete clears the stored data and shows onboarding again", gone.card && !(gone.stored || "").includes("days"), gone);
    check("progress/practice: no page errors", errors.length === 0, errors);
    await page.close();
  }

  // 2e. Issues #38, #39, #46: first-run guide, controls gated on tracking,
  // 320 px reflow, banner and label semantics, optional P shortcut, focus.
  {
    const { page, errors } = await newPage(browser, { guide: true, viewport: { width: 320, height: 640 } });
    await page.goto(`${base}app/${bust}`);
    const noScroll = () => page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
    }));
    const startW = await noScroll();
    await page.screenshot({ path: path.join(outDir, "app-320-start.png"), fullPage: true });
    check("reflow: no horizontal scroll at 320 px on the start screen", startW.scrollWidth <= startW.innerWidth, startW);
    check("start screen says it works best on a laptop or desktop",
      /laptop or desktop with a webcam/i.test(await page.textContent("#start-overlay")));
    const pre = await page.evaluate(() => ({
      breath: document.getElementById("breath-check").disabled,
      good: document.getElementById("calib-good").disabled,
      bad: document.getElementById("calib-bad").disabled,
      tip: document.getElementById("calib-good").title,
      bannerRole: document.getElementById("banner").getAttribute("role"),
      bannerLive: document.getElementById("banner").getAttribute("aria-live"),
      badLabel: document.querySelector('label[for="bad-file"]')?.textContent,
      goodLabel: document.querySelector('label[for="good-file"]')?.textContent,
      mode: /Chime only still speaks/.test(document.getElementById("mode-note").textContent),
    }));
    check("controls: breath check and record buttons are disabled before start, with a tooltip",
      pre.breath && pre.good && pre.bad && /Start the webcam or demo first/.test(pre.tip), pre);
    check("a11y: banner is a polite status region", pre.bannerRole === "status" && pre.bannerLive === "polite", pre);
    check("a11y: sound file inputs have labels", pre.badLabel === "Bad sound" && pre.goodLabel === "Good sound", pre);
    check("chime-only note explains breath lines", pre.mode, pre);
    await page.click("#start-demo");
    await page.waitForTimeout(1500);
    const post = await page.evaluate(() => ({
      breath: document.getElementById("breath-check").disabled,
      good: document.getElementById("calib-good").disabled,
      bad: document.getElementById("calib-bad").disabled,
      focus: document.activeElement && document.activeElement.id,
      guide: !document.getElementById("first-run").hidden,
      framing: document.querySelector("#first-run-body .framing")?.textContent,
    }));
    check("controls: enabled after the demo starts", !post.breath && !post.good && !post.bad, post);
    check("a11y: focus moves to the status badge after Start", post.focus === "state-badge", post);
    check("first run: the guide card appears after Start with live framing",
      post.guide && /in view/.test(post.framing || ""), post);
    await page.click("#first-run-next");
    check("first run: step 2 offers calibration",
      (await page.textContent("#first-run-heading")) === "Calibrate to your posture" && await page.isVisible("#first-run-body button"));
    await page.click("#first-run-next");
    check("first run: step 3 plays the sounds and mentions keeping the tab open",
      /Leave this tab open/.test(await page.textContent("#first-run-body")) && (await page.locator("#first-run-body button").count()) === 3);
    await page.click("#first-run-next");
    const done = await page.evaluate(() => ({
      hidden: document.getElementById("first-run").hidden,
      flag: JSON.parse(localStorage.getItem("posture-guard:v1")).firstRunDone === true,
    }));
    check("first run: Done hides the guide and stores the flag", done.hidden && done.flag, done);
    await page.click("#setup-panel summary");
    await page.click("#intro-again");
    check("first run: Show the intro again reopens it", !(await page.evaluate(() => document.getElementById("first-run").hidden)));
    const dashW = await noScroll();
    await page.screenshot({ path: path.join(outDir, "app-320-dashboard.png"), fullPage: true });
    check("reflow: no horizontal scroll at 320 px on the dashboard", dashW.scrollWidth <= dashW.innerWidth, dashW);
    // P shortcut: pauses by default, ignored once turned off, and the choice is stored.
    await page.click("#first-run-skip");
    await page.keyboard.press("p");
    check("shortcut: P pauses by default", (await page.textContent("#pause")) === "Resume");
    await page.keyboard.press("p");
    await page.check("#pause-shortcut", { force: true });
    await page.uncheck("#pause-shortcut", { force: true });
    await page.locator("body").press("p");
    check("shortcut: P does nothing once turned off", (await page.textContent("#pause")) === "Pause");
    check("shortcut: the setting is stored",
      (await page.evaluate(() => JSON.parse(localStorage.getItem("posture-guard:v1")).pauseShortcut)) === false);
    // Reduced motion: no transitions on the hold bar, score bar or banner.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const motion = await page.evaluate(() => ["hold-fill", "banner", "good-bar"].map((id) =>
      getComputedStyle(document.getElementById(id)).transitionDuration));
    check("a11y: prefers-reduced-motion disables transitions", motion.every((d) => d === "0s"), motion);
    check("320 px: no page errors", errors.length === 0, errors);
    await page.close();
  }

  // 2d. Not working?: the panel waits for tracking, then reports it (faults are unit-tested).
  {
    const { page, errors } = await newPage(browser);
    await page.goto(`${base}app/${bust}`);
    check("not working: the panel invites you to start before tracking", /Start the camera/.test(await page.textContent("#setup-status")));
    await page.click("#start-demo");
    await page.waitForFunction(() => /looks good/.test(document.getElementById("setup-status").textContent), null, { timeout: 20000 });
    check("not working: the demo reports that tracking looks good", true);
    await page.click("#setup-panel summary");
    await page.waitForTimeout(500);
    const sm = await page.evaluate(() => {
      const cv = document.getElementById("setup-mini-canvas");
      return { w: cv.clientWidth, rotor: !!document.getElementById("setup-needle-rotor"),
        ink: cv.width ? cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data.some((v, k) => k % 4 === 3 && v > 0) : false };
    });
    check("not working: the panel shows a live mini skeleton and needle", sm.w > 0 && sm.rotor && sm.ink, sm);
    await page.screenshot({ path: path.join(outDir, "app-setup-ok.png") });
    check("not working: no page errors", errors.length === 0, errors);
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
    await page.waitForFunction(() => window.__spoken.some((x) => /good|posture|champion|keep|relaxed/i.test(x.text) && !/^Head|^Your|^You're leaning|^Please/.test(x.text)),
      null, { timeout: 15000 }).catch(() => {});
    const spoken = await page.evaluate(() => window.__spoken.slice());
    check("praise: spoken with the recorded voice when opted in",
      spoken.some((x) => x.engine === "kokoro" && /^(Looking good|Nice posture|You're looking good|Great, keep|Posture to die|Tall and relaxed|Spine of)/.test(x.text)),
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
    await page.click("#breath-check"); // 9 s real-time phases are on the 8x clock: ~1.2 s
    await page.waitForFunction(() => /Relaxed|bracing|holding|clearly/.test(document.getElementById("relax-status").textContent), null, { timeout: 8000 }).catch(() => {});
    const breathOut = await page.evaluate(() => ({
      status: document.getElementById("relax-status").textContent,
      lines: window.__spoken.filter((x) => /breath|shoulders|relaxed/i.test(x.text)).map((x) => `${x.engine}: ${x.text}`),
    }));
    check("breath check: prompts in, out, then gives a verdict with the recorded voice",
      /Relaxed and stacked/.test(breathOut.status) && breathOut.lines.length >= 3 && breathOut.lines.every((l) => l.startsWith("kokoro")), breathOut);
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
      await page.goto(base + bust);
      const landing = await page.evaluate(() => {
        const el = document.getElementById("webgl-warning");
        if (!el) return { banner: "element-missing", text: "" };
        return { banner: getComputedStyle(el).display, text: el.textContent };
      });
      check("no WebGL: landing page shows the warning banner",
        landing.banner === "block" && /chrome:\/\/settings/.test(landing.text) && /demo/i.test(landing.text), landing);
      await page.goto(`${base}app/${bust}`);
      const gl = await page.evaluate(() => Boolean(
        document.createElement("canvas").getContext("webgl") ||
        (typeof OffscreenCanvas !== "undefined" && new OffscreenCanvas(1, 1).getContext("webgl2"))));
      const cam = await page.evaluate(() => {
        const btn = document.getElementById("start-camera");
        const helpEl = document.getElementById("webgl-help");
        if (!btn || !helpEl) return { text: "", disabled: false, help: "element-missing" };
        return { text: btn.textContent, disabled: btn.disabled, help: getComputedStyle(helpEl).display };
      });
      check("no WebGL: camera button shows the WebGL message on load",
        /needs WebGL/i.test(cam.text) && cam.disabled && cam.help === "block", cam);
      await page.click("#start-camera", { force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const s = await page.evaluate(() => {
        const helpEl = document.getElementById("webgl-help");
        const overlayEl = document.getElementById("start-overlay");
        const video = document.getElementById("video");
        if (!helpEl || !overlayEl || !video) return { help: "element-missing", overlay: "element-missing", streams: -1 };
        return {
          help: getComputedStyle(helpEl).display,
          overlay: getComputedStyle(overlayEl).display,
          streams: video.srcObject === null ? 0 : 1,
        };
      });
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
