// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// End-to-end check of the browser app, run by .github/workflows/live-site.yml
// against the deployed GitHub Pages site or, on push, a locally served
// candidate build. Not part of `node --test tests/js/`: it needs the internet
// (the Pages site, or a local server for the candidate build) and Chromium.
//
//   node tests/e2e/live-site.mjs <base-url> <fake-camera.y4m> <out-dir>
//
// 1. Landing page loads and links to ./app/.
// 2. Demo mode: GOOD, then the scripted slouch triggers a reminder.
// 3. Webcam mode with Chromium's fake camera playing a drawn cartoon figure:
//    the real tasks-vision bundle, WASM and pose model load from app/vendor/ and
//    detectForVideo finds the person (metrics shown, any state except "no one
//    in view"), and the person - who is standing upright - gets no reminder.
// 4. Webcam mode with WebGL blocked on every canvas type: the app explains how
//    to turn it on, still starts the camera on the MoveNet WASM fallback, shows
//    the reduced accuracy notice and does not throw. (--disable-3d-apis
//    alone is not enough: OffscreenCanvas keeps WebGL, and the app correctly
//    runs on it.)
// 4a. Breaks & prompts (issue #49): demo mode with ?clockScale=600 (the prompt
//    timers run 600x, 1 real second = 10 prompt minutes; see app.js). Checks the
//    eye break shows after the quiet start, one prompt at a time with the 10
//    minute gap between prompts, none while paused or in a silent test, and the
//    Breaks & prompts settings persist across a reload.
// 4b. Offline mode: opt in, wait for the ready message, go offline, reload, run
//    demo (and the webcam when a fake camera is given), then remove the copy.
// 4c. Consent (issue #51): the breath check and breathing moments ask first,
//    declining stores nothing, withdrawing and Delete my data remove the record.
// 4d. Share menu (issue #49) without navigator.share: plain links, no third-party request.
//    Share your score: too little data gives a hint; after a minute of demo a
//    1200x630 PNG card is drawn and downloadable (no camera frame in it).
// 4e. Sponsor card (issue #49): shown once after seeded sustained use, never
//    after 3 showings, Don't ask again, Maybe later, the first week, or in a silent test.
// 4f. Open Graph tags, privacy page sections and footer links (issues #49, #51).
// 5. Self-hosting (issue #45): the vendored files are served, and no request
//    leaves the site's origin (in particular none to cdn.jsdelivr.net or
//    storage.googleapis.com). CSP violations show up as console errors, which
//    every scenario already asserts are empty.
// Screenshots and a JSON report go to <out-dir> (uploaded as an artifact).

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [base = "https://arii.github.io/posture-guard/", y4m, outDir = "live-site-report"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const bust = `?v=${Date.now()}`;
const report = { base, checks: [] };
let failed = false;
const baseOrigin = new URL(base).origin;
const externalRequests = [];
const VENDORED = [
  "vision_bundle.mjs",
  "pose_landmarker_lite.task",
  "LICENSE",
  "wasm/vision_wasm_internal.js",
  "wasm/vision_wasm_internal.wasm",
  "wasm/vision_wasm_nosimd_internal.js",
  "wasm/vision_wasm_nosimd_internal.wasm",
];

/** Node-side fetch that always reads the body. An unread body leaves the
 *  socket paused, and when python's http.server then closes the connection,
 *  undici crashes the whole script with assert(!this.paused) (#58). */
async function fetchStatus(url) {
  const res = await fetch(url, { headers: { connection: "close" } });
  const bytes = (await res.arrayBuffer()).byteLength;
  return { ok: res.ok, status: res.status, type: res.headers.get("content-type") || "", bytes };
}

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

// The shoulder and breathing features need a dated consent (docs/app/consent.js).
// Every check except the consent one seeds it; keep in step with CONSENT_VERSION.
const CONSENT = { version: 1, at: "2026-01-01T00:00:00.000Z" };

async function newPage(
  browser,
  {
    fresh = false,
    guide = false,
    consent = true,
    staged = false,
    extra = null,
    viewport = { width: 1280, height: 900 },
  } = {},
) {
  const context = await browser.newContext({ viewport });
  await context.grantPermissions(["camera"]);
  if (!fresh) {
    await context.addInitScript(
      ([onboarded, ackVersion, firstRunDone, consentRecord, extraStore, staged]) => {
        try {
          if (sessionStorage.getItem("pg-e2e-acked")) return; // seed once per tab, so a reload keeps what the app wrote
          sessionStorage.setItem("pg-e2e-acked", "1");
          const s = JSON.parse(localStorage.getItem("posture-guard:v1")) || {};
          s.onboarded = Math.max(s.onboarded || 0, onboarded);
          s.ackVersion = Math.max(s.ackVersion || 0, ackVersion);
          if (firstRunDone) s.firstRunDone = true; // the first-run guide card has its own check
          if (consentRecord) s.consent = consentRecord;
          s.setupDone = true; // the setup sequence (spec task 4) is not what these checks are about
          s.revealAll = !staged; // every panel exists unless a check is about the staged reveal
          if (extraStore) Object.assign(s, extraStore);
          localStorage.setItem("posture-guard:v1", JSON.stringify(s));
        } catch {
          /* storage unavailable */
        }
      },
      [ONBOARDED, ACKED, !guide, consent ? CONSENT : null, extra, staged],
    );
  }
  const page = await context.newPage();
  page.on("request", (r) => {
    const u = r.url();
    if (/^https?:/.test(u) && new URL(u).origin !== baseOrigin) externalRequests.push(u);
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return { page, errors };
}

const ui = (page) =>
  page.evaluate(() => ({
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
    await page.waitForFunction(() => Number(document.getElementById("reminder-count").textContent) >= 1, null, {
      timeout: 40000,
    });
    const slouch = await ui(page);
    check("demo slouch triggers a reminder", slouch.badge === "sit up", slouch);
    await page.screenshot({ path: path.join(outDir, "demo-slouch.png") });
    check("demo has no errors", errors.length === 0, errors);
    report.demo = { early, slouch };
    await page.close();
  }

  // 2b. Breaks & prompts on an accelerated prompt clock.
  {
    const { page, errors } = await newPage(browser);
    await page.addInitScript(() => {
      window.__shown = [];
      window.__overlap = [];
      let cur = null;
      setInterval(() => {
        const el = document.getElementById("prompt-card");
        const banner = document.getElementById("banner");
        if (!el) return;
        const id = el.classList.contains("show") ? el.dataset.prompt : null;
        if (id && id !== cur) window.__shown.push({ id, t: performance.now() });
        cur = id;
        // a non-guide prompt must never share the screen with a breath check banner
        if (id && id !== "guide" && banner.classList.contains("show") && banner.classList.contains("relax")) {
          window.__overlap.push(id);
        }
      }, 40);
    });
    await page.goto(`${base}app/?clockScale=600&v=${Date.now()}`);
    const shownIds = () => page.evaluate(() => window.__shown.map((x) => x.id));
    await page.click("#start-demo");
    await page.waitForTimeout(400);
    check("prompts: none in the first 5 minutes of a session", (await shownIds()).length === 0);
    await page.waitForSelector("#prompt-card.show[data-prompt=eye]", { timeout: 20000 });
    const eye = await page.evaluate(() => ({
      text: document.getElementById("prompt-text").textContent,
      role: document.getElementById("prompt-text").getAttribute("role"),
      live: document.getElementById("prompt-text").getAttribute("aria-live"),
      snooze: document.getElementById("prompt-snooze").textContent,
      notnow: document.getElementById("prompt-notnow").textContent,
      bar: !document.getElementById("prompt-bar").hidden,
    }));
    check(
      "prompts: the eye break shows the 20-20-20 text, a countdown bar and Snooze / Not now",
      /20 feet away for 20 seconds/.test(eye.text) &&
        eye.role === "status" &&
        eye.live === "polite" &&
        /Snooze 10 min/.test(eye.snooze) &&
        /Not now/.test(eye.notnow) &&
        eye.bar,
      eye,
    );
    await page.screenshot({ path: path.join(outDir, "prompt-eye-break.png") });
    await page.waitForFunction(() => /eyes had a rest/.test(document.getElementById("prompt-text").textContent), null, {
      timeout: 30000,
    });
    check("prompts: the eye break countdown finishes", true);
    await page.waitForSelector("#prompt-card.show[data-prompt=move]", { timeout: 30000 });
    const move = await page.evaluate(() => ({
      text: document.getElementById("prompt-text").textContent,
      breathe: !document.getElementById("prompt-action").hidden,
      shown: window.__shown.map((x) => x.id),
    }));
    check(
      "prompts: the move break follows, one at a time, with a Breathe with me choice",
      /stand up and move/.test(move.text) && move.breathe && move.shown.join() === "eye,move",
      move,
    );
    await page.click("#prompt-done");
    const gaps = await page.evaluate(() => window.__shown.slice(1).map((x, i) => x.t - window.__shown[i].t));
    check(
      "prompts: at least 10 prompt minutes (1 s here) between prompts",
      gaps.every((g) => g >= 800) && (await page.evaluate(() => window.__overlap.length)) === 0,
      { gaps },
    );
    // Paused: nothing shows, however much prompt time passes.
    await page.click("#pause");
    const beforePause = (await shownIds()).length;
    await page.waitForTimeout(3000);
    check(
      "prompts: none while paused",
      (await shownIds()).length === beforePause &&
        (await page.evaluate(() => !document.getElementById("prompt-card").classList.contains("show"))),
    );
    await page.click("#pause");
    // Silent test: nothing shows either.
    await page.click("#test-start");
    const beforeTest = (await shownIds()).length;
    await page.waitForTimeout(3000);
    check(
      "prompts: none during a silent test",
      (await shownIds()).length === beforeTest &&
        (await page.evaluate(() => !document.getElementById("prompt-card").classList.contains("show"))),
    );
    await page.click("#test-start");
    // Breaks & prompts panel toggles persist.
    await page.uncheck("#eye-breaks");
    await page.selectOption("#move-minutes", "45");
    await page.check("#breathing-moments");
    await page.check("#breathe-cues");
    await page.reload();
    const panel = await page.evaluate(() => ({
      eye: document.getElementById("eye-breaks").checked,
      move: document.getElementById("move-minutes").value,
      moments: document.getElementById("breathing-moments").checked,
      cues: document.getElementById("breathe-cues").checked,
      stored: JSON.parse(localStorage.getItem("posture-guard:v1")),
    }));
    check(
      "prompts: Breaks & prompts settings persist across a reload",
      !panel.eye &&
        panel.move === "45" &&
        panel.moments &&
        panel.cues &&
        panel.stored.eyeBreaks === false &&
        panel.stored.moveBreakMinutes === 45,
      panel,
    );
    await page.screenshot({ path: path.join(outDir, "breaks-panel.png"), fullPage: true });
    check("prompts: no page errors", errors.length === 0, errors);
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
    check(
      "first run: onboarding card shows and the Start buttons are hidden",
      first.card && /How it works/.test(first.title) && !first.demoVisible && /not medical advice/i.test(first.footer),
      first,
    );
    await page.screenshot({ path: path.join(outDir, "onboarding-step1.png") });
    await page.click("#ob-next");
    await page.click("#ob-next");
    const safety = await page.evaluate(() => ({
      title: document.getElementById("ob-title").textContent,
      text: document.getElementById("ob-body").textContent,
      ack: !document.getElementById("ob-ack").hidden,
    }));
    check(
      "first run: step 3 is the safety notice with an acknowledgement button",
      safety.ack &&
        /medical advice/.test(safety.text) &&
        /rigid posture/.test(safety.text) &&
        /numbness/.test(safety.text),
      safety,
    );
    await page.screenshot({ path: path.join(outDir, "onboarding-step3.png") });
    await page.click("#ob-ack");
    const acked = await page.evaluate(() => ({
      stored: JSON.parse(localStorage.getItem("posture-guard:v1")),
      demoVisible: document.getElementById("start-demo").offsetParent !== null,
      cardHidden: document.getElementById("onboarding").hidden,
    }));
    check(
      "first run: acknowledging stores the versions and shows the Start buttons",
      acked.stored.ackVersion === ACKED &&
        acked.stored.onboarded === ONBOARDED &&
        acked.demoVisible &&
        acked.cardHidden,
      acked,
    );
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
    check(
      "help: the button reopens the walkthrough with the safety notice",
      help.open && /How it works/.test(help.text) && /not a medical device/.test(help.text),
      { open: help.open },
    );
    await page.screenshot({ path: path.join(outDir, "help-dialog.png") });
    await page.keyboard.press("Escape");
    await page.click("#start-demo");
    await page.waitForFunction(() => document.getElementById("state-badge").textContent === "good posture", null, {
      timeout: 15000,
    });
    check("first run: #start-demo works after acknowledging", true);
    await page.click("#safety-link");
    check(
      "safety notice: the footer link opens the full notice",
      await page.evaluate(
        () =>
          document.getElementById("safety-dialog").open &&
          /as-is/.test(document.getElementById("safety-list").textContent),
      ),
    );
    await page.keyboard.press("Escape");
    await page.click("#reveal-all"); // a fresh profile starts staged; this is the "I want it all" path
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
    check(
      "progress: 7 days from store.days, test trend, and a light-coaching suggestion",
      prog.rows === 7 &&
        /75%/.test(prog.text) &&
        /50%/.test(prog.text) &&
        /80%/.test(prog.tests) &&
        /light coaching/.test(prog.suggest),
      prog,
    );
    check("375 px: no horizontal overflow on the start screen", !prog.overflow, prog);
    await page.screenshot({ path: path.join(outDir, "app-375-start.png"), fullPage: true });
    await page.click("#start-demo");
    await page.waitForFunction(() => document.getElementById("state-badge").textContent === "good posture", null, {
      timeout: 15000,
    });
    const before = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("posture-guard:v1")).days));
    await page.click("#help-btn");
    await page.click("#help-practice");
    await page
      .waitForFunction(() => document.getElementById("state-badge").textContent === "practice", null, { timeout: 5000 })
      .catch(() => {});
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
    for (let i = 0; i < 12; i++) {
      // sim 24 s: the demo slouches meanwhile, yet nothing may fire
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const cv = document.getElementById("practice-mini-canvas");
        const px = cv.width && cv.height ? cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data : [];
        return {
          t: document.getElementById("practice-needle-rotor").getAttribute("transform"),
          ink: px.some((v, k) => k % 4 === 3 && v > 0),
          w: cv.clientWidth,
        };
      });
      miniSeen.add(m.t);
      miniInk = miniInk || m.ink;
    }
    check("practice: mini skeleton canvas is drawn next to the instructions", miniInk);
    check("practice: mini needle moves between good and slouch in the demo", miniSeen.size > 1, [...miniSeen]);
    const quiet = await page.evaluate(
      (b) => ({
        spoken: window.__spoken.length,
        reminders: document.getElementById("reminder-count").textContent,
        daysSame: JSON.stringify(JSON.parse(localStorage.getItem("posture-guard:v1")).days) === b,
      }),
      before,
    );
    check(
      "practice: no speech, no reminders, nothing recorded",
      quiet.spoken === 0 && quiet.reminders === "0" && quiet.daysSame,
      quiet,
    );
    await page.screenshot({ path: path.join(outDir, "app-375-practice.png"), fullPage: true });
    await page.click("#practice-stop");
    await page.waitForFunction(() => !document.body.classList.contains("practicing"));
    // Learn the cues ends with a "Try a breath check" button (finishing the last step shows it).
    await page.click("#help-btn");
    await page.click("#help-practice");
    for (let i = 0; i < 12 && (await page.evaluate(() => document.body.classList.contains("practicing"))); i++) {
      await page.click("#practice-next");
    }
    check(
      "practice: finishing the last step offers Try a breath check",
      (await page.isVisible("#practice-breath")) &&
        /Try a breath check/.test(await page.textContent("#practice-breath")),
    );
    // Export and delete.
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#progress-export")]);
    const exported = JSON.parse(await (await import("node:fs")).promises.readFile(await download.path(), "utf8"));
    check(
      "progress: export is whitelisted JSON",
      exported.schema === 1 && !!exported.days && !("calibration" in exported),
      Object.keys(exported),
    );
    page.once("dialog", (d) => d.accept());
    await page.click("#progress-delete");
    await page.waitForLoadState("load");
    await page.waitForTimeout(500);
    const gone = await page.evaluate(() => ({
      stored: localStorage.getItem("posture-guard:v1"),
      card: !document.getElementById("onboarding").hidden,
    }));
    check(
      "progress: delete clears the stored data and shows onboarding again",
      gone.card && !(gone.stored || "").includes("days"),
      gone,
    );
    check("progress/practice: no page errors", errors.length === 0, errors);
    await page.close();
  }

  // 2e. Issues #38, #39, #46: first-run guide, controls gated on tracking,
  // 320 px reflow, banner and label semantics, optional P shortcut, focus.
  {
    const { page, errors } = await newPage(browser, { guide: true, viewport: { width: 320, height: 640 } });
    await page.goto(`${base}app/${bust}`);
    const noScroll = () =>
      page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
    const startW = await noScroll();
    await page.screenshot({ path: path.join(outDir, "app-320-start.png"), fullPage: true });
    check(
      "reflow: no horizontal scroll at 320 px on the start screen",
      startW.scrollWidth <= startW.innerWidth,
      startW,
    );
    check(
      "start screen says it works best on a laptop or desktop",
      /laptop or desktop with a webcam/i.test(await page.textContent("#start-overlay")),
    );
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
    check(
      "controls: breath check and record buttons are disabled before start, with a tooltip",
      pre.breath && pre.good && pre.bad && /Start the webcam or demo first/.test(pre.tip),
      pre,
    );
    check("a11y: banner is a polite status region", pre.bannerRole === "status" && pre.bannerLive === "polite", pre);
    check("a11y: sound file inputs have labels", pre.badLabel === "Bad sound" && pre.goodLabel === "Good sound", pre);
    check("chime-only note explains breath lines", pre.mode, pre);
    await page.click("#start-demo");
    await page.waitForTimeout(1500);
    const post = await page.evaluate(() => ({
      breath: document.getElementById("breath-check").disabled,
      good: document.getElementById("calib-good").disabled,
      bad: document.getElementById("calib-bad").disabled,
      focus: document.activeElement?.id,
      guide: !document.getElementById("first-run").hidden,
      framing: document.querySelector("#first-run-body .framing")?.textContent,
    }));
    check("controls: enabled after the demo starts", !post.breath && !post.good && !post.bad, post);
    check("a11y: focus moves to the status badge after Start", post.focus === "state-badge", post);
    check(
      "first run: the guide card appears after Start with live framing",
      post.guide && /in view/.test(post.framing || ""),
      post,
    );
    await page.click("#first-run-next");
    check(
      "first run: step 2 offers calibration",
      (await page.textContent("#first-run-heading")) === "Calibrate to your posture" &&
        (await page.isVisible("#first-run-body button")),
    );
    await page.click("#first-run-next");
    check(
      "first run: step 3 is Choose your coach, with voice, breaks and sample buttons",
      (await page.textContent("#first-run-heading")) === "Choose your coach" &&
        (await page.locator("#coach-voice, #coach-level, #coach-eye, #coach-move, #coach-moments").count()) === 5 &&
        (await page.locator("#first-run-body button").count()) === 3,
    );
    await page.selectOption("#coach-move", "45");
    await page.uncheck("#coach-eye");
    const coach = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("posture-guard:v1"));
      return { move: s.moveBreakMinutes, eye: s.eyeBreaks };
    });
    check("first run: coach choices change the real settings", coach.move === 45 && coach.eye === false, coach);
    await page.click("#first-run-next");
    check(
      "first run: last step says to leave the tab open and has Share and a silent test",
      /Leave this tab open/.test(await page.textContent("#first-run-body")) &&
        /Pause any time/.test(await page.textContent("#first-run-body")) &&
        (await page.locator("#first-run-body button").allTextContents()).join("|") ===
          "Share BackUp|Start a silent test",
    );
    await page.click("#first-run-next");
    const done = await page.evaluate(() => ({
      hidden: document.getElementById("first-run").hidden,
      flag: JSON.parse(localStorage.getItem("posture-guard:v1")).firstRunDone === true,
    }));
    check("first run: Done hides the guide and stores the flag", done.hidden && done.flag, done);
    await page.click("#setup-panel summary");
    await page.click("#intro-again");
    check(
      "first run: Show the intro again reopens it",
      !(await page.evaluate(() => document.getElementById("first-run").hidden)),
    );
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
    check(
      "shortcut: the setting is stored",
      (await page.evaluate(() => JSON.parse(localStorage.getItem("posture-guard:v1")).pauseShortcut)) === false,
    );
    // Reduced motion: no transitions on the hold bar, score bar or banner.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const motion = await page.evaluate(() =>
      ["hold-fill", "banner", "good-bar"].map((id) => getComputedStyle(document.getElementById(id)).transitionDuration),
    );
    check(
      "a11y: prefers-reduced-motion disables transitions",
      motion.every((d) => d === "0s"),
      motion,
    );
    check("320 px: no page errors", errors.length === 0, errors);
    await page.close();
  }

  // 2d. Not working?: the panel waits for tracking, then reports it (faults are unit-tested).
  {
    const { page, errors } = await newPage(browser);
    await page.goto(`${base}app/${bust}`);
    check(
      "not working: the panel invites you to start before tracking",
      /Start the camera/.test(await page.textContent("#setup-status")),
    );
    await page.click("#start-demo");
    await page.waitForFunction(() => /looks good/.test(document.getElementById("setup-status").textContent), null, {
      timeout: 20000,
    });
    check("not working: the demo reports that tracking looks good", true);
    await page.click("#setup-panel summary");
    await page.waitForTimeout(500);
    const sm = await page.evaluate(() => {
      const cv = document.getElementById("setup-mini-canvas");
      return {
        w: cv.clientWidth,
        rotor: !!document.getElementById("setup-needle-rotor"),
        ink: cv.width
          ? cv
              .getContext("2d")
              .getImageData(0, 0, cv.width, cv.height)
              .data.some((v, k) => k % 4 === 3 && v > 0)
          : false,
      };
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
      window.SpeechSynthesisUtterance = class {
        constructor(t) {
          this.text = t;
        }
      };
      // The app announces each spoken line and whether it used a clip.
      document.addEventListener("pg:speak", (e) => window.__spoken.push(e.detail));
    });
    await page.goto(`${base}app/${bust}`);
    await page
      .waitForFunction(() => document.getElementById("voice-note").textContent.includes("Kokoro"), null, {
        timeout: 10000,
      })
      .catch(() => {});
    const voice = await page.evaluate(() => ({
      note: document.getElementById("voice-note").textContent,
      selected: document.getElementById("voice-pick").value,
      praiseDefault: document.getElementById("spoken-praise").checked,
    }));
    check(
      "voice: recorded Kokoro voice is the default",
      voice.selected.startsWith("kokoro:") && voice.note.includes("Kokoro"),
      voice,
    );
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
    check(
      "hold bar fills toward the next praise",
      hold.cls.includes("good") && /looking good/i.test(hold.text) && parseFloat(hold.width) > 0,
      hold,
    );
    await page
      .waitForFunction(
        () =>
          window.__spoken.some(
            (x) =>
              /good|posture|champion|keep|relaxed/i.test(x.text) && !/^Head|^Your|^You're leaning|^Please/.test(x.text),
          ),
        null,
        { timeout: 15000 },
      )
      .catch(() => {});
    const spoken = await page.evaluate(() => window.__spoken.slice());
    check(
      "praise: spoken with the recorded voice when opted in",
      spoken.some(
        (x) =>
          x.engine === "kokoro" &&
          /^(Looking good|Nice posture|You're looking good|Great, keep|Posture to die|Tall and relaxed|Spine of)/.test(
            x.text,
          ),
      ),
      spoken,
    );
    await page.keyboard.press("p");
    const pausedBadge = await page.textContent("#state-badge");
    const before = await page.evaluate(() => [
      window.__spoken.length,
      document.getElementById("reminder-count").textContent,
    ]);
    await page.waitForTimeout(4000); // sim 32 s: the whole slouch half would chime without the pause
    const after = await page.evaluate(() => [
      window.__spoken.length,
      document.getElementById("reminder-count").textContent,
    ]);
    check(
      "pause: no reminders or speech while paused",
      pausedBadge === "paused" && before[0] === after[0] && before[1] === after[1],
      { pausedBadge, before, after },
    );
    await page.click("#pause");
    await page.waitForTimeout(1500);
    const resumed = await page.textContent("#state-badge");
    check("pause: resume restarts tracking", resumed !== "paused", { resumed });
    await page.click("#breath-check"); // 9 s real-time phases are on the 8x clock: ~1.2 s
    await page
      .waitForFunction(
        () => /Relaxed|bracing|holding|clearly/.test(document.getElementById("relax-status").textContent),
        null,
        { timeout: 8000 },
      )
      .catch(() => {});
    const breathOut = await page.evaluate(() => ({
      status: document.getElementById("relax-status").textContent,
      lines: window.__spoken
        .filter((x) => /breath|shoulders|relaxed/i.test(x.text))
        .map((x) => `${x.engine}: ${x.text}`),
    }));
    check(
      "breath check: prompts in, out, then gives a verdict with the recorded voice",
      /Relaxed and stacked/.test(breathOut.status) &&
        breathOut.lines.length >= 3 &&
        breathOut.lines.every((l) => l.startsWith("kokoro")),
      breathOut,
    );
    const spokenBeforeTest = await page.evaluate(() => window.__spoken.length);
    await page.click("#test-start");
    await page.waitForTimeout(3000); // sim 24 s: the demo slouches in this window, yet nothing may fire
    const silent = await page.evaluate(
      (n) => ({
        badge: document.getElementById("state-badge").textContent,
        testing: document.body.classList.contains("testing"),
        needleShown: getComputedStyle(document.querySelector(".panel.coaching")).display !== "none",
        spoke: window.__spoken.length - n,
        status: document.getElementById("test-status").textContent,
      }),
      spokenBeforeTest,
    );
    check(
      "silent test: hides feedback and stays quiet",
      silent.badge === "silent test" &&
        silent.testing &&
        !silent.needleShown &&
        silent.spoke === 0 &&
        /left/.test(silent.status),
      silent,
    );
    await page.click("#test-start"); // stop early: not saved
    check(
      "silent test: stopping early is not saved",
      (await page.evaluate(() => (JSON.parse(localStorage.getItem("posture-guard:v1")).tests || []).length)) === 0,
    );
    await page.click("#report-bug").catch(() => {}); // opens a new tab; only the href matters
    const href = await page.getAttribute("#report-bug", "href");
    const issue = new URL(href);
    const body = issue.searchParams.get("body") || "";
    check(
      "bug report: pre-fills a GitHub issue with diagnostics",
      issue.pathname === "/arii/posture-guard/issues/new" && body.includes("WebGL:") && body.includes("Browser:"),
      { href: href.slice(0, 200) },
    );
    await page.screenshot({ path: path.join(outDir, "demo-praise-pause.png") });
    check("praise/pause/report: no page errors", errors.length === 0, errors);
    report.praise = { spoken, pausedBadge, resumed };
    await page.close();
  }

  // 3. Webcam mode: real model from app/vendor/ on a fake camera.
  {
    const { page, errors } = await newPage(browser);
    const modelFetches = {};
    page.on("request", (r) => {
      const m = r.url().match(/(pose_landmarker_lite\.task|vision_wasm(?:_nosimd)?_internal\.wasm)/);
      if (m) modelFetches[m[1]] = (modelFetches[m[1]] || 0) + 1;
    });
    await page.goto(`${base}app/${bust}`);
    await page.evaluate(() => {
      // Record every state each start-up step goes through.
      window.__steps = new Set();
      const seen = window.__steps;
      const note = () => {
        for (const li of document.querySelectorAll("#load-steps li")) seen.add(`${li.dataset.step}:${li.className}`);
        if (!document.getElementById("load-steps").hidden) seen.add("list:shown");
        const detail = document.querySelector('#load-steps [data-step="download"] .load-detail').textContent;
        if (/of \d+(\.\d)? MB/.test(detail)) seen.add("download:bytes");
      };
      const opts = { subtree: true, attributes: true, childList: true, characterData: true };
      new MutationObserver(note).observe(document.getElementById("start-overlay"), opts);
    });
    const t0 = Date.now();
    await page.click("#start-camera");
    await page.waitForFunction(
      () =>
        getComputedStyle(document.getElementById("start-overlay")).display === "none" ||
        document.getElementById("start-error").textContent !== "",
      null,
      { timeout: 90000 },
    );
    const loaded = await ui(page);
    const steps = await page.evaluate(() => ({
      seen: [...window.__steps],
      hiddenAfter: document.getElementById("load-steps").hidden,
    }));
    const wanted = ["list:shown", "camera:active", "download:active", "download:bytes", "start:active"];
    check(
      "start-up: shows camera, download (with MB progress) and start steps, then hides them",
      wanted.every((k) => steps.seen.includes(k)) && steps.hiddenAfter,
      steps,
    );
    check(
      "start-up: the model and WASM are downloaded once, not twice",
      Object.keys(modelFetches).length === 2 && Object.values(modelFetches).every((n) => n === 1),
      modelFetches,
    );
    check(
      "webcam mode starts (vendored bundle, WASM and model load)",
      loaded.overlay === "none" && loaded.source === "webcam",
      { ...loaded, seconds: (Date.now() - t0) / 1000 },
    );
    // Give the detector a few seconds on the looping fake camera frame.
    await page.waitForTimeout(8000);
    const seen = await ui(page);
    report.webcam = { loaded, seen };
    await page.screenshot({ path: path.join(outDir, "webcam-fake-camera.png") });
    if (y4m) {
      check(
        "pose detected on the fake camera feed",
        seen.badge !== "no one in view" && seen.badge !== "waiting" && seen.headForward !== "-",
        seen,
      );
      check("upright person gets no reminder", seen.reminders === "0", seen);
    }
    check("webcam mode has no errors", errors.length === 0, errors);
    await page.close();
  }
  // 3b. Live preview: the video shows within 1.5 s of the click while the model is still downloading.
  if (y4m) {
    const { page, errors } = await newPage(browser);
    let release = () => {};
    const held = new Promise((r) => {
      release = r;
    });
    await page.route(/pose_landmarker_lite\.task/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${base}app/${bust}`);
    await page.click("#start-camera");
    const t0 = Date.now();
    const shown = await page
      .waitForFunction(
        () => {
          const v = document.getElementById("video");
          if (!v || v.readyState < 2 || v.paused) return false;
          const r = v.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!top && !top.closest("#start-overlay");
        },
        null,
        { timeout: 1500 },
      )
      .then(() => Date.now() - t0)
      .catch(() => -1);
    const during = await page.evaluate(() => ({
      classes: document.getElementById("start-overlay").className,
      status: document.getElementById("start-status").textContent,
      steps: [...document.querySelectorAll("#load-steps li")].map((li) => `${li.dataset.step}:${li.className}`),
      marks: window.__loadMarks,
    }));
    check("live preview: video visible within 1.5 s of the click while the model route is held", shown >= 0, {
      shown,
      ...during,
    });
    check(
      "live preview: card is compact, camera step done, download still active",
      /compact/.test(during.classes) &&
        during.steps.includes("camera:done") &&
        during.steps.includes("download:active") &&
        /Camera is on\./.test(during.status),
      during,
    );
    release();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.getElementById("start-overlay")).display === "none" ||
        document.getElementById("start-error").textContent !== "",
      null,
      { timeout: 90000 },
    );
    const after = await page.evaluate(() => ({
      source: document.getElementById("source").textContent,
      marks: window.__loadMarks,
    }));
    check(
      "live preview: after the route is released tracking starts and every load mark is recorded",
      after.source === "webcam" &&
        ["click", "streamPlaying", "downloadDone", "warmUpDone"].every((k) => after.marks?.[k] !== undefined),
      after,
    );
    check("live preview has no errors", errors.length === 0, errors);
    await page.close();
  }
  // 4. No WebGL: a separate browser, since the flag is per launch.
  {
    const noGL = await chromium.launch({
      args: [
        "--disable-3d-apis",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        ...(y4m ? [`--use-file-for-fake-video-capture=${y4m}`] : []),
      ],
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
      check(
        "no WebGL: landing page shows the warning banner",
        landing.banner === "block" &&
          /chrome:\/\/settings/.test(landing.text) &&
          /fallback|simpler/i.test(landing.text),
        landing,
      );
      await page.goto(`${base}app/${bust}`);
      const gl = await page.evaluate(() =>
        Boolean(
          document.createElement("canvas").getContext("webgl") ||
            (typeof OffscreenCanvas !== "undefined" && new OffscreenCanvas(1, 1).getContext("webgl2")),
        ),
      );
      const cam = await page.evaluate(() => {
        const btn = document.getElementById("start-camera");
        const helpEl = document.getElementById("webgl-help");
        if (!btn || !helpEl) return { text: "", disabled: true, help: "element-missing" };
        return { text: btn.textContent, disabled: btn.disabled, help: getComputedStyle(helpEl).display };
      });
      check(
        "no WebGL: camera button stays enabled and the notice explains the fallback",
        !gl && !cam.disabled && /webcam/i.test(cam.text) && cam.help === "block",
        cam,
      );
      const t0 = Date.now();
      await page.click("#start-camera");
      await page.waitForFunction(
        () =>
          getComputedStyle(document.getElementById("start-overlay")).display === "none" ||
          document.getElementById("start-error").textContent !== "",
        null,
        { timeout: 120000 },
      );
      const s = await ui(page);
      const note = await page.evaluate(() => {
        const el = document.getElementById("lowpower-note");
        return { display: getComputedStyle(el).display, text: el.textContent };
      });
      await page.waitForTimeout(8000); // let MoveNet run on the looping fake camera frame
      const seen = await ui(page);
      await page.screenshot({ path: path.join(outDir, "no-webgl.png") });
      report.noWebgl = { s, note, seen, seconds: (Date.now() - t0) / 1000 };
      check(
        "no WebGL: webcam starts on the MoveNet fallback",
        s.overlay === "none" && s.source === "webcam" && s.startError === "",
        s,
      );
      check(
        "no WebGL: shows the reduced accuracy notice",
        note.display === "block" && /less accurate/i.test(note.text),
        note,
      );
      if (y4m) {
        check(
          "no WebGL: fallback finds the person on the fake camera feed",
          seen.badge !== "no one in view" && seen.badge !== "waiting" && seen.headForward !== "-",
          seen,
        );
      }
      check("no WebGL: no page errors", errors.length === 0, errors);
      await page.close();
    } finally {
      await noGL.close();
    }
  }
  // 6. A custom sound survives a reload under the CSP (restoreSound must not
  //    use fetch(data:), which connect-src 'self' blocks).
  {
    const { page, errors } = await newPage(browser);
    await page.goto(base + "app/" + bust);
    const rate = 8000,
      n = 800; // 0.1 s of silence as 16-bit mono PCM WAV
    const wav = Buffer.alloc(44 + n * 2);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + n * 2, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(n * 2, 40);
    await page.setInputFiles("#bad-file", { name: "chime.wav", mimeType: "audio/wav", buffer: wav });
    await page
      .waitForFunction(() => JSON.parse(localStorage.getItem("posture-guard:v1") || "{}").badSound, null, {
        timeout: 5000,
      })
      .catch(() => {});
    const stored = await page.evaluate(() => !!JSON.parse(localStorage.getItem("posture-guard:v1") || "{}").badSound);
    check("custom sound: an uploaded sound is stored", stored);
    await page.reload();
    await page.click("#start-demo"); // restoreSound runs when a session begins
    await page.waitForTimeout(1500);
    const kept = await page.evaluate(() => !!JSON.parse(localStorage.getItem("posture-guard:v1") || "{}").badSound);
    check("custom sound: survives a reload (not blocked by the CSP)", kept);
    check("custom sound: no page errors", errors.length === 0, errors);
    await page.close();
  }
  // 4a. Sound packs: clean by default; Spooky synthesizes a bell and a ghost glide and persists.
  {
    const { page, errors } = await newPage(browser);
    await page.addInitScript(() => {
      window.__osc = [];
      const orig = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        const o = orig.call(this);
        window.__osc.push(o);
        return o;
      };
    });
    await page.goto(`${base}app/${bust}`);
    const def = await page.inputValue("#sound-pack");
    const osc = async (sel) => {
      await page.evaluate(() => {
        window.__osc.length = 0;
      });
      await page.click(sel);
      await page.waitForTimeout(200);
      return page.evaluate(() => window.__osc.length);
    };
    const clean = await osc("#test-bad");
    await page.selectOption("#sound-pack", "spooky");
    const spookyBad = await osc("#test-bad");
    const spookyGood = await osc("#test-good");
    await page.reload();
    const kept = await page.inputValue("#sound-pack");
    check(
      "sound pack: clean is the default and Spooky plays a bell and a ghost glide",
      def === "clean" && clean === 2 && spookyBad === 14 && spookyGood === 2 && kept === "spooky",
      { def, clean, spookyBad, spookyGood, kept },
    );
    check("sound pack: no page errors", errors.length === 0, errors);
    await page.close();
  }
  // 4b. Offline mode (issue #49): opt in, go offline, reload, run, remove.
  {
    const { page, errors } = await newPage(browser);
    const ctx = page.context();
    await page.goto(`${base}app/${bust}`);
    const supported = await page.evaluate(() => "serviceWorker" in navigator && "caches" in window);
    if (!supported) {
      console.log("SKIP offline mode: service workers unsupported in this browser");
    } else {
      const swBefore = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
      check("offline: no service worker is registered until the user opts in", swBefore === 0, { swBefore });
      await page.click("#offline-enable");
      await page
        .waitForFunction(
          () =>
            /^Offline mode is ready\. You can disconnect Wi-Fi now\./.test(
              document.getElementById("offline-status").textContent,
            ),
          null,
          { timeout: 90000 },
        )
        .catch(() => {});
      const status = await page.evaluate(() => document.getElementById("offline-status").textContent);
      check(
        "offline: ready message appears and says video is never stored",
        /^Offline mode is ready\. You can disconnect Wi-Fi now\./.test(status) && /video is never stored/i.test(status),
        status,
      );
      await page.screenshot({ path: path.join(outDir, "offline-ready.png") });
      await page.reload(); // let the worker take control of the page before going offline
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
      await ctx.setOffline(true);
      const failedReqs = [];
      page.on("requestfailed", (r) => failedReqs.push(r.url()));
      const resp = await page.goto(`${base}app/?offline=1`).catch((e) => ({ err: String(e) }));
      check("offline: the app reloads with the network off", !!resp && !resp.err, resp?.err);
      await page.click("#start-demo");
      await page.waitForTimeout(3000);
      const off = await ui(page);
      check("offline: demo mode runs", off.badge === "good posture", off);
      if (y4m) {
        await page.reload();
        await page.click("#start-camera");
        await page
          .waitForFunction(
            () =>
              document.getElementById("source").textContent === "webcam" &&
              document.getElementById("m-head_forward_deg").textContent !== "-",
            null,
            { timeout: 60000 },
          )
          .catch(() => {});
        const cam = await ui(page);
        check(
          "offline: webcam mode starts and pose detection finds the person without a network",
          !cam.startError && cam.source === "webcam" && cam.headForward !== "-",
          cam,
        );
      }
      check("offline: no failed requests", failedReqs.length === 0, failedReqs.slice(0, 5));
      check("offline: no page errors", errors.length === 0, errors);
      await ctx.setOffline(false);
      await page.reload();
      await page.click("#offline-remove");
      await page.waitForFunction(
        () => /Offline copy removed/.test(document.getElementById("offline-status").textContent),
        null,
        { timeout: 10000 },
      );
      const left = await page.evaluate(async () => ({
        regs: (await navigator.serviceWorker.getRegistrations()).length,
        caches: (await caches.keys()).filter((k) => k.startsWith("posture-guard-")).length,
      }));
      check(
        "offline: Remove offline copy unregisters the worker and deletes the cache",
        left.regs === 0 && left.caches === 0,
        left,
      );
    }
    await page.close();
  }
  // 4c. Issue #51: consent gates the shoulder and breathing features.
  {
    const { page, errors } = await newPage(browser, { consent: false });
    await page.goto(`${base}app/${bust}`);
    await page.click("#start-demo");
    await page.waitForTimeout(1500);
    check(
      "consent: relax reminders box is off and the status says off until the user opts in",
      !(await page.isChecked("#relax-reminders")) && /Off\./.test(await page.textContent("#consent-status")),
      await page.textContent("#consent-status"),
    );
    await page.click("#breath-check");
    check(
      "consent: the breath check asks first and does not start",
      await page.evaluate(
        () =>
          document.getElementById("consent-dialog").open &&
          !/Breathe in slowly/.test(document.getElementById("relax-status").textContent),
      ),
    );
    const dialog = await page.textContent("#consent-dialog");
    check(
      "consent: the dialog explains what, where, kept, identify and withdraw",
      /measured/.test(dialog) &&
        /only in this browser tab/.test(dialog) &&
        /identify/.test(dialog) &&
        /withdraw/i.test(dialog) &&
        /Consumer Health Data/.test(dialog),
      dialog.slice(0, 200),
    );
    check("consent: Turn on is disabled until the box is checked", await page.isDisabled("#consent-agree"));
    await page.screenshot({ path: path.join(outDir, "consent-dialog.png") });
    await page.click("#consent-cancel");
    check(
      "consent: declining stores nothing",
      await page.evaluate(() => !JSON.parse(localStorage.getItem("posture-guard:v1") || "{}").consent),
    );
    await page.check("#breathing-moments");
    check(
      "consent: the breathing moments box also asks and resets when declined",
      await page.evaluate(() => document.getElementById("consent-dialog").open),
    );
    await page.click("#consent-cancel");
    check("consent: breathing moments stay off", !(await page.isChecked("#breathing-moments")));
    await page.click("#breath-check");
    await page.check("#consent-check");
    await page.click("#consent-agree");
    await page
      .waitForFunction(() => /Breathe in slowly/.test(document.getElementById("relax-status").textContent), null, {
        timeout: 5000,
      })
      .catch(() => {});
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem("posture-guard:v1")).consent);
    check(
      "consent: agreeing records a dated consent and runs the breath check",
      rec &&
        rec.version === 1 &&
        !Number.isNaN(Date.parse(rec.at)) &&
        /Breathe in slowly/.test(await page.textContent("#relax-status")),
      rec,
    );
    await page.click("#consent-withdraw");
    check(
      "consent: withdrawing removes the record",
      (await page.evaluate(() => !JSON.parse(localStorage.getItem("posture-guard:v1")).consent)) &&
        !(await page.isChecked("#relax-reminders")),
    );
    page.on("dialog", (d) => d.accept());
    await page.click("#consent-open");
    await page.check("#consent-check");
    await page.click("#consent-agree");
    await page.click("#progress-delete");
    await page.waitForLoadState("load");
    await page.waitForTimeout(500);
    check(
      "consent: Delete my data removes the consent record",
      await page.evaluate(() => !JSON.parse(localStorage.getItem("posture-guard:v1") || "{}").consent),
    );
    check("consent: no page errors", errors.length === 0, errors);
    await page.close();
  }

  // 4d. Issue #49 part 4: Share menu without navigator.share, plain links only.
  {
    const { page, errors } = await newPage(browser);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    });
    await page.goto(`${base}app/${bust}`);
    const before = externalRequests.length;
    await page.click("#share-btn");
    const links = await page.evaluate(() =>
      Object.fromEntries(
        ["bluesky", "linkedin", "x", "email", "mastodon"].map((id) => {
          const a = document.getElementById(`share-${id}`);
          return [id, { href: a.href, hidden: a.hidden, rel: a.rel }];
        }),
      ),
    );
    const hosts = ["bluesky", "linkedin", "x"].map((k) => new URL(links[k].href).hostname).join();
    check(
      "share: menu opens with Bluesky, LinkedIn, X and email links, no third-party host before a click",
      hosts === "bsky.app,www.linkedin.com,x.com" &&
        links.email.href.startsWith("mailto:") &&
        links.mastodon.hidden &&
        /noopener/.test(links.bluesky.rel) &&
        externalRequests.length === before,
      links,
    );
    check(
      "share: the text and link are shown",
      /Nothing is uploaded/.test(await page.textContent("#share-text")) &&
        /\/posture-guard\/|^http/.test(await page.inputValue("#share-link")),
    );
    await page.fill("#share-instance", "https://evil.example/x");
    check(
      "share: an invalid Mastodon server shows a hint and no link",
      (await page.evaluate(() => document.getElementById("share-mastodon").hidden)) &&
        /server name/.test(await page.textContent("#share-msg")),
    );
    await page.fill("#share-instance", "fosstodon.org");
    const masto = await page.evaluate(() => {
      const a = document.getElementById("share-mastodon");
      return { hidden: a.hidden, host: new URL(a.href).hostname };
    });
    check(
      "share: a valid Mastodon server gives a link to that host",
      !masto.hidden && masto.host === "fosstodon.org",
      masto,
    );
    await page.screenshot({ path: path.join(outDir, "share-dialog.png") });
    check("share: no page errors", errors.length === 0, errors);
    await page.close();
  }

  // 4d2. Share your score card (issue #49 part 4).
  {
    const { page, errors } = await newPage(browser);
    await page.goto(`${base}app/${bust}`);
    await page.click("#share-btn");
    await page.click("#share-card-btn");
    check(
      "share card: too little tracked time gives a hint and no card",
      /at least a minute/.test(await page.textContent("#share-msg")) &&
        (await page.evaluate(() => document.getElementById("share-card-wrap").hidden)),
    );
    await page.click("#share-close");
    await page.click("#start-demo");
    await page.waitForTimeout(66000);
    await page.click("#share-btn");
    await page.click("#share-card-btn");
    const card = await page.evaluate(() => {
      const c = document.getElementById("share-card");
      return {
        shown: !document.getElementById("share-card-wrap").hidden,
        w: c.width,
        h: c.height,
        label: c.getAttribute("aria-label"),
      };
    });
    check(
      "share card: a 1200x630 card with alt text is shown after a minute of tracking",
      card.shown && card.w === 1200 && card.h === 630 && /good posture this session/.test(card.label || ""),
      card,
    );
    await page.waitForTimeout(300);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#share-card-download")]);
    check("share card: Download PNG saves backup-score.png", dl.suggestedFilename() === "backup-score.png");
    await page.locator("#share-card").screenshot({ path: path.join(outDir, "share-card.png") });
    check("share card: no page errors", errors.length === 0, errors);
    await page.close();
  }

  // 4e. Issue #49 part 5: sponsor card gating (seeded store, accelerated clock).
  {
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const used = (extra = {}) => ({
      usage: { firstSeen: day(30), sessions: 8 },
      days: {
        [day(20)]: { good: 3000, bad: 600 },
        [day(10)]: { good: 3000, bad: 600 },
        [day(3)]: { good: 3000, bad: 600 },
      },
      // keep the other prompts out of the way: only the sponsor card is under test
      eyeBreaks: false,
      moveBreakMinutes: 0,
      relaxReminders: false,
      ...extra,
    });
    const shownIn = async (extra, ms) => {
      const { page, errors } = await newPage(browser, { extra: used(extra) });
      await page.goto(`${base}app/?clockScale=600&v=${Date.now()}`);
      await page.click("#start-demo");
      const seen = await page
        .waitForFunction(() => !document.getElementById("sponsor-card").hidden, null, { timeout: ms })
        .then(
          () => true,
          () => false,
        );
      return { page, errors, seen };
    };
    {
      const { page, errors, seen } = await shownIn({}, 20000);
      check("sponsor: card appears after sustained use, in the session panel", seen);
      if (seen) {
        const info = await page.evaluate(() => ({
          text: document.getElementById("sponsor-text").textContent,
          link: document.getElementById("sponsor-link").href,
          buttons: [...document.querySelectorAll("#sponsor-card button")].map((b) => b.textContent),
          stored: JSON.parse(localStorage.getItem("posture-guard:v1")).sponsor,
          inPanel: !!document.getElementById("sponsor-card").closest(".panel"),
          video: document.getElementById("sponsor-card").closest(".stage") === null,
        }));
        check(
          "sponsor: text, links and buttons, counted once",
          /tracked about \d+ hours/.test(info.text) &&
            info.link === "https://github.com/sponsors/arii" &&
            info.buttons.join("|") === "Share instead|Maybe later|Don\u2019t ask again" &&
            info.stored.shown === 1 &&
            info.inPanel &&
            info.video,
          info,
        );
        await page.screenshot({ path: path.join(outDir, "sponsor-card.png") });
        await page.click("#sponsor-never");
        const after = await page.evaluate(() => ({
          hidden: document.getElementById("sponsor-card").hidden,
          sp: JSON.parse(localStorage.getItem("posture-guard:v1")).sponsor,
        }));
        check("sponsor: Don't ask again hides it and is stored", after.hidden && after.sp.never === true, after);
      }
      check("sponsor: no page errors", errors.length === 0, errors);
      await page.close();
    }
    for (const [name, extra] of [
      ["after 3 showings", { sponsor: { shown: 3 } }],
      ["after Don't ask again", { sponsor: { never: true } }],
      ["within 30 days of Maybe later", { sponsor: { shown: 1, laterOn: day(5) } }],
      ["in the first week", { usage: { firstSeen: day(2), sessions: 8 } }],
      ["with too few sessions", { usage: { firstSeen: day(30), sessions: 2 } }],
    ]) {
      const { page, seen } = await shownIn(extra, 4000);
      check(`sponsor: not shown ${name}`, !seen);
      await page.close();
    }
    {
      const { page } = await newPage(browser, { extra: used() });
      await page.goto(`${base}app/?clockScale=600&v=${Date.now()}`);
      await page.click("#start-demo");
      await page.click("#test-start");
      await page.waitForTimeout(4000);
      check(
        "sponsor: not shown during a silent test",
        await page.evaluate(() => document.getElementById("sponsor-card").hidden),
      );
      await page.close();
    }
  }

  // 4f. Landing, Open Graph tags, privacy sections (issues #49, #51).
  {
    const { page, errors } = await newPage(browser);
    await page.goto(base + bust);
    const og = await page.evaluate(() =>
      Object.fromEntries(
        ["og:title", "og:description", "og:image", "twitter:card", "twitter:image"].map((k) => {
          const m = document.querySelector(`meta[property="${k}"], meta[name="${k}"]`);
          return [k, m?.content];
        }),
      ),
    );
    check(
      "landing: Open Graph and Twitter card tags are present",
      Object.values(og).every(Boolean) && og["twitter:card"] === "summary_large_image",
      og,
    );
    const img = await fetchStatus(`${base}assets/og-image.png${bust}`);
    check("landing: og-image.png is served", img.ok && /image\/png/.test(img.type), { status: img.status });
    check(
      "landing: footer links to the Consumer Health Data Privacy Policy",
      (await page.locator('footer a[href="privacy.html#consumer-health-data"]').count()) === 1,
    );
    await page.goto(`${base}privacy.html${bust}`);
    const sections = await page.evaluate(() => ({
      chd: /Consumer Health Data Privacy Policy/.test(
        document.getElementById("consumer-health-data")?.textContent || "",
      ),
      bio: /do not retain any face geometry/.test(
        document.getElementById("biometric")?.nextElementSibling?.textContent || "",
      ),
      sponsor: /sponsor prompt/.test(document.body.textContent),
      offline: /Make available offline/.test(document.body.textContent),
    }));
    check(
      "privacy page has the consumer health data and biometric retention sections",
      sections.chd && sections.bio && sections.sponsor && sections.offline,
      sections,
    );
    await page.goto(`${base}app/${bust}`);
    check(
      "app footer links to the Consumer Health Data Privacy Policy and Sponsor",
      (await page.locator('footer a[href="../privacy.html#consumer-health-data"]').count()) === 1 &&
        (await page.locator('footer a[href="https://github.com/sponsors/arii"]').count()) === 1,
    );
    check("landing and privacy pages have no errors", errors.length === 0, errors);
    await page.close();
  }

  // 4g. Staged reveal (spec progressive-loading, requirement 4): panels appear as tracking settles.
  {
    // Visible checkboxes and radios, and visible words in <main> below the stage (the guide card and the manual "Not working?" help excluded).
    const density = (page) =>
      page.evaluate(() => {
        const vis = (e) => {
          const r = e.getBoundingClientRect();
          const st = getComputedStyle(e);
          return (
            r.width > 0 &&
            r.height > 0 &&
            st.visibility !== "hidden" &&
            st.display !== "none" &&
            !e.closest("[hidden]") &&
            !e.closest("details:not([open]) > :not(summary)")
          );
        };
        const checks = [...document.querySelectorAll("input[type=checkbox],input[type=radio]")].filter(vis).length;
        let words = 0;
        const walker = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const p = t.parentElement;
          if (!p || ["SCRIPT", "STYLE"].includes(p.tagName) || p.closest(".stage, #first-run, #setup-panel") || !vis(p))
            continue;
          words += t.textContent.trim().split(/\s+/).filter(Boolean).length;
        }
        return { checks, words };
      });
    const shown = (page, sel) => page.locator(sel).isVisible();
    const STAGED_IDS = [
      "good-pct",
      "needle-text",
      "calib-good",
      "mode",
      "eye-breaks",
      "move-minutes",
      "breathing-moments",
      "relax-reminders",
      "specific-cues",
      "pause-shortcut",
      "spoken-praise",
      "voice-pick",
      "sound-pack",
      "test-start",
      "progress-panel",
      "offline-panel",
      "breaks-panel",
      "share-btn",
      "consent-open",
    ];

    // Stage 0: before tracking, at most 2 checkboxes and the staged panels are out of the tab order.
    {
      const { page, errors } = await newPage(browser, { staged: true });
      await page.goto(`${base}app/${bust}`);
      await page.waitForSelector("#start-camera:visible");
      const d0 = await density(page);
      check("staged reveal: stage 0 shows at most 2 checkboxes", d0.checks <= 2, d0);
      check(
        "staged reveal: stage 0 hides the dashboard panels with the hidden attribute",
        await page.evaluate(() => [...document.querySelectorAll("[data-stage]")].every((e) => e.hidden)),
      );
      const missing = await page.evaluate(
        (ids) => ids.filter((id) => !document.getElementById(id) && !document.getElementsByName(id).length),
        STAGED_IDS,
      );
      check("staged reveal: hidden controls stay in the DOM", missing.length === 0, missing);
      check(
        "staged reveal: 'Show all settings' is offered before tracking",
        (await page.locator("#reveal-all").textContent()).trim() === "Show all settings",
      );
      await page.screenshot({ path: path.join(outDir, "reveal-stage0.png") });
      check("staged reveal: stage 0 has no errors", errors.length === 0, errors);
      await page.close();
    }

    // Stage 1 to 2 on a clock 10x faster (settle after about 1 s), first-run guide skipped.
    {
      const { page, errors } = await newPage(browser, { staged: true, extra: { firstRunDone: false } });
      await page.goto(`${base}app/?clockScale=10&v=${Date.now()}`);
      await page.click("#start-demo");
      await page.waitForFunction(() => !document.querySelector("#good-pct").closest("[data-stage]").hidden, null, {
        timeout: 5000,
      });
      check("staged reveal: 'This session' appears with the first scored frame", true);
      await page.waitForFunction(() => !document.querySelector("#needle-text").closest("[data-stage]").hidden, null, {
        timeout: 8000,
      });
      const note = await page.locator("#reveal-note").textContent();
      check("staged reveal: stage 2 is announced once in #reveal-note", /Added: .*posture needle/.test(note), note);
      check(
        "staged reveal: stage 2 does not show reminders yet",
        !(await shown(page, "#breaks-panel")) && !(await shown(page, "#progress-panel")),
      );
      // The guide card is its own thing (spec task 4 moves it); measure what stage 2 adds.
      const skip = page.locator("#first-run-skip");
      if (await skip.isVisible()) await skip.click();
      const d2 = await density(page);
      check("staged reveal: at most 2 checkboxes at stage 2", d2.checks <= 2, d2);
      check("staged reveal: at most 150 visible words below the stage at stage 2", d2.words <= 150, d2);
      await page.screenshot({ path: path.join(outDir, "reveal-stage2.png") });
      check("staged reveal: no errors through stage 2", errors.length === 0, errors);
      await page.close();
    }

    // clockScale=600: every stage within seconds; the stage never goes back; focus stays put.
    {
      const { page, errors } = await newPage(browser, { staged: true, extra: { firstRunDone: false } });
      await page.goto(`${base}app/?clockScale=600&v=${Date.now()}`);
      await page.click("#start-demo");
      await page.waitForFunction(() => !document.getElementById("breaks-panel").hidden, null, { timeout: 8000 });
      check(
        "staged reveal: with ?clockScale=600 the settings panels reveal in the demo",
        (await shown(page, "#breaks-panel")) && (await shown(page, "#test-start")),
      );
      check(
        "staged reveal: the settings groups stay closed",
        await page.evaluate(() => [...document.querySelectorAll("details[data-group]")].every((d) => !d.open)),
      );
      check(
        "staged reveal: a reveal does not move focus",
        await page.evaluate(() => !document.getElementById("reveal-note").contains(document.activeElement)),
      );
      // Stage 3 and 4 panels are checked first; stage 5 (progress, offline) waits for a later session.
      check("staged reveal: progress and offline wait for a later session", !(await shown(page, "#progress-panel")));
      check("staged reveal: no errors with a fast clock", errors.length === 0, errors);
      await page.close();
    }

    // Show all settings: everything now, persisted, reversible.
    {
      const { page, errors } = await newPage(browser, { staged: true });
      await page.goto(`${base}app/${bust}`);
      await page.click("#reveal-all");
      const all = await page.evaluate(() => ({
        hiddenLeft: [...document.querySelectorAll("[data-stage]")].filter((e) => e.hidden).length,
        stored: JSON.parse(localStorage.getItem("posture-guard:v1")).revealAll,
        label: document.getElementById("reveal-all").textContent.trim(),
        pressed: document.getElementById("reveal-all").getAttribute("aria-pressed"),
        groupsOpen: [...document.querySelectorAll("details[data-group]")].every((d) => d.open),
      }));
      check(
        "staged reveal: Show all settings reveals every panel and persists",
        all.hiddenLeft === 0 && all.stored === true && all.label === "Simplify the page" && all.pressed === "true",
        all,
      );
      check("staged reveal: Show all settings opens the settings groups", all.groupsOpen, all);
      await page.setViewportSize({ width: 320, height: 640 });
      check(
        "staged reveal: no horizontal scroll at 320 px with everything shown",
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      await page.screenshot({ path: path.join(outDir, "reveal-all-320.png"), fullPage: true });
      await page.reload();
      check("staged reveal: Show all settings survives a reload", await shown(page, "#breaks-panel"));
      await page.click("#reveal-all");
      check(
        "staged reveal: Simplify the page hides the panels again",
        !(await shown(page, "#breaks-panel")) &&
          (await page.evaluate(() => JSON.parse(localStorage.getItem("posture-guard:v1")).revealAll)) === false,
      );
      check("staged reveal: show all has no errors", errors.length === 0, errors);
      await page.close();
    }

    // 320 px at stage 0 and after the demo has revealed the stages.
    {
      const { page } = await newPage(browser, { staged: true, viewport: { width: 320, height: 640 } });
      await page.goto(`${base}app/?clockScale=600&v=${Date.now()}`);
      const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      check("staged reveal: no horizontal scroll at 320 px, stage 0", await fits());
      await page.click("#start-demo");
      await page.waitForFunction(() => !document.getElementById("breaks-panel").hidden, null, { timeout: 8000 });
      check("staged reveal: no horizontal scroll at 320 px, stage 4", await fits());
      await page.screenshot({ path: path.join(outDir, "reveal-320-stage4.png"), fullPage: true });
      await page.close();
    }
  }

  // 5. Self-hosting: vendored files are served, nothing left the origin.
  {
    const missing = [];
    for (const f of VENDORED) {
      const res = await fetchStatus(`${base}app/vendor/${f}${bust}`);
      if (!res.ok) missing.push(`${f} ${res.status}`);
    }
    check("vendored MediaPipe files are served", missing.length === 0, missing);
    check(
      "no request to a third-party host (jsDelivr, Google, ...)",
      externalRequests.length === 0,
      externalRequests.slice(0, 5),
    );
  }
} finally {
  await browser.close();
  writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
}
process.exit(failed ? 1 : 0);
