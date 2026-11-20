// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Browser shell for BackUp: webcam + MediaPipe Pose Landmarker in the
// page, posture-core.js for scoring/state/needle/calibration, Web Audio for
// chimes, recorded Kokoro clips (speechSynthesis fallback) for speech, localStorage for settings,
// calibration and daily totals. No frame or landmark leaves the browser.

import { DEFAULTS, LEFT_EAR, Nudge, PostureEngine, Reason, State, TRACKED } from "./posture-core.js";
import {
  BREAK_LINES,
  BREATHE_LINES,
  DEFAULT_PROMPT,
  PRAISE,
  RECOVERY_PRAISE,
  RELAX_LINES,
  TEST_LINE,
  VOICES,
} from "./voice-lines.js";
import { BracingMonitor, BreathCheck, neckRatio } from "./relax.js";
import { createMoveNetDetector } from "./movenet-adapter.js";
import { LoadSteps, downloadAll, nextPaint } from "./loading.js";
import { SOUND_PACKS, playSpooky } from "./sound-packs.js";
import { BREAKS, BreakTracker } from "./breaks.js";
import { BreatheGuide, BreathingMoments, GUIDE_SAFETY } from "./breathing.js";
import { PromptScheduler } from "./prompts.js";
import { MINI_SCALE, miniViewsToDraw, needleTransform } from "./mini-view.js";
import {
  DIAGNOSIS_TEXT,
  Diagnosis,
  markOnboarded,
  needsAckOnly,
  ONBOARDING_STEPS,
  PRACTICE_STEPS,
  RELAX_SAFETY,
  SAFETY_POINTS,
  SAFETY_SHORT,
  SetupCheck,
  shouldShowOnboarding,
} from "./onboarding.js";
import { exportJson, summarize } from "./progress.js";
import { NEEDS_TRACKING_TIP, cameraErrorMessage, isPauseShortcut, resolveSettings } from "./settings.js";
import { BUG_LINK_TIP, buildBugReportBody, clearStoredData, sanitizeError, webglSummary } from "./privacy.js";
import {
  META_URL,
  CACHE_PREFIX,
  cacheNameFor,
  isOfflineReady,
  offlineMessage,
  offlineState,
  progressPercent,
} from "./offline.js";
import {
  CONSENT_CHECKBOX,
  CONSENT_POINTS,
  CONSENT_TITLE,
  consentStatus,
  hasConsent,
  recordConsent,
  withdrawConsent,
} from "./consent.js";
import {
  SHARE_TEXT,
  cardAltText,
  drawScoreCard,
  nativeSharePayload,
  scoreCardData,
  normalizeInstance,
  shareLinks,
  shareUrl,
} from "./share.js";
import {
  SPONSOR,
  SPONSOR_URL,
  answerSponsor,
  markSponsorShown,
  refundSponsorShown,
  recordSession,
  shouldOfferSponsor,
  sponsorText,
} from "./sponsor.js";
import { COACH_INTRO, DONE_INTRO } from "./onboarding.js";
import { FeedbackPolicy, MILESTONE_TEXT, normalizeLevel } from "./feedback.js";

// Self-hosted under docs/app/vendor/ (see vendor/README.md for versions and hashes).
const TASKS_VISION = new URL("./vendor", import.meta.url).href;
const MODEL_URL = `${TASKS_VISION}/pose_landmarker_lite.task`;
// Fallback for browsers without WebGL: TF.js MoveNet on the WASM backend, fetched only when needed.
const MOVENET_DIR = `${TASKS_VISION}/movenet`;
const VISIBLE_FPS = 15; // detection rate while the tab is visible
const HIDDEN_TICK_MS = 200; // ~5 fps from a worker timer while hidden
const DEMO_CYCLE_S = 20; // synthetic demo: 20 s good, 20 s slouch
const STORE = "posture-guard:v1";

const $ = (id) => document.getElementById(id);
const video = $("video");
const canvas = $("overlay");
const ctx = canvas.getContext("2d");

// -- persistence --------------------------------------------------------------

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
}
const store = loadStore();
let deleted = false; // "Delete my data" ran: never write the store back
function save() {
  if (deleted) return;
  try {
    localStorage.setItem(STORE, JSON.stringify(store));
  } catch {
    /* quota: keep in memory */
  }
}
const todayKey = () => new Date().toISOString().slice(0, 10);

// -- settings -----------------------------------------------------------------

const settings = {
  mode: store.mode || "chime_and_voice",
  voiceText: store.voiceText || DEFAULT_PROMPT,
  specificCues: store.specificCues !== false, // default on
  spokenPraise: store.spokenPraise === true, // default off: opt in
  soundPack: SOUND_PACKS[store.soundPack] ? store.soundPack : "clean",
  voiceDelay: DEFAULTS.state.voice_delay_s,
  voiceRepeat: DEFAULTS.state.voice_repeat_cooldown_s,
};
document.querySelectorAll("input[name=mode]").forEach((el) => {
  el.checked = el.value === settings.mode;
  el.addEventListener("change", () => {
    settings.mode = el.value;
    store.mode = el.value;
    save();
  });
});
$("sound-pack").value = settings.soundPack;
$("sound-pack").addEventListener("change", (e) => {
  settings.soundPack = SOUND_PACKS[e.target.value] ? e.target.value : "clean";
  store.soundPack = settings.soundPack;
  save();
  playBad(); // a preview of the new pack's reminder
});
$("specific-cues").checked = settings.specificCues;
$("specific-cues").addEventListener("change", (e) => {
  settings.specificCues = e.target.checked;
  store.specificCues = settings.specificCues;
  save();
});
$("spoken-praise").checked = settings.spokenPraise;
$("spoken-praise").addEventListener("change", (e) => {
  settings.spokenPraise = e.target.checked;
  store.spokenPraise = settings.spokenPraise;
  save();
});
$("voice-text").value = settings.voiceText;
$("voice-text").addEventListener("change", (e) => {
  settings.voiceText = e.target.value.trim() || DEFAULT_PROMPT;
  store.voiceText = settings.voiceText;
  save();
});

settings.coachingLevel = normalizeLevel(store.coachingLevel);
const policy = new FeedbackPolicy(settings.coachingLevel);
$("coaching-level").value = settings.coachingLevel;
$("coaching-level").addEventListener("change", (e) => {
  settings.coachingLevel = normalizeLevel(e.target.value);
  policy.setLevel(settings.coachingLevel);
  store.coachingLevel = settings.coachingLevel;
  save();
});

function allowed(nudge) {
  if (settings.mode === "silent") return false;
  return !(settings.mode === "chime_only" && nudge === Nudge.VOICE);
}

// -- engine -------------------------------------------------------------------

const engine = new PostureEngine(DEFAULTS, {
  voiceTimings: () => [settings.voiceDelay, settings.voiceRepeat],
});
if (store.calibration) engine.calibration.load(store.calibration);
let savedCalVersion = engine.calibration.version;

// -- audio --------------------------------------------------------------------

let audioCtx = null;
const custom = { bad: null, good: null }; // AudioBuffers

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// harmonics: [[k, amplitude], ...] for a custom timbre; omitted = pure sine.
function tones(freqs, seconds, harmonics = null) {
  const ac = ensureAudio();
  let wave = null;
  if (harmonics) {
    const n = Math.max(...harmonics.map(([k]) => k)) + 1;
    const real = new Float32Array(n);
    const imag = new Float32Array(n); // sine terms
    for (const [k, amp] of harmonics) imag[k] = amp;
    wave = ac.createPeriodicWave(real, imag); // peak-normalized
  }
  let t = ac.currentTime + 0.02;
  freqs.forEach((f, i) => {
    const dur = seconds[i];
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    if (wave) osc.setPeriodicWave(wave);
    else osc.type = "sine";
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur); // ~exp(-3t) decay
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    t += dur;
  });
}

function playBuffer(buffer) {
  const ac = ensureAudio();
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.connect(ac.destination);
  src.start();
}

// A falling "uh-oh" reminder (E5 -> B-flat 4, a tritone
// down, reedy odd harmonics) and a rising C-major arpeggio reward.
const BAD_HARMONICS = [
  [1, 1.0],
  [3, 0.35],
  [5, 0.15],
];
// An uploaded sound wins, then the chosen pack (clean by default).
const playBad = () =>
  custom.bad
    ? playBuffer(custom.bad)
    : settings.soundPack === "spooky"
      ? playSpooky(ensureAudio(), "bad")
      : tones([659.25, 466.16], [0.18, 0.42], BAD_HARMONICS);
const playGood = () =>
  custom.good
    ? playBuffer(custom.good)
    : settings.soundPack === "spooky"
      ? playSpooky(ensureAudio(), "good")
      : tones([523.25, 659.25, 783.99, 1046.5], [0.2, 0.2, 0.2, 0.2]);

// -- voice --------------------------------------------------------------------
// Default: clips pre-rendered with Kokoro-82M (docs/app/voice, see
// voice-lines.js), which sound like a person. Lines without a clip (a custom
// prompt) and the "System:" choices use speechSynthesis; for those, rank the
// installed voices and avoid OS fallbacks like eSpeak, which sound robotic.

const ROBOTIC = /espeak|e-speak|mbrola|festival|pico|flite|rhvoice/i;
function voiceScore(v, lang) {
  let s = 0;
  if (/natural|neural|online/i.test(v.name)) s += 8;
  if (/^google/i.test(v.name)) s += 6;
  if (/premium|enhanced|siri/i.test(v.name)) s += 5;
  if (/samantha|ava|allison|karen|daniel|serena|aria|jenny|guy|libby|sonia/i.test(v.name)) s += 2;
  if (!v.localService) s += 1; // network voices are usually the neural ones
  if (ROBOTIC.test(v.name)) s -= 10;
  if (v.lang && v.lang.toLowerCase() === lang.toLowerCase()) s += 3;
  else if (v.lang && v.lang.slice(0, 2).toLowerCase() === lang.slice(0, 2).toLowerCase()) s += 2;
  else s -= 20; // wrong language: never pick it automatically
  return s;
}

const KOKORO = "kokoro:";
let clipManifest = null; // { voices: { af_heart: { text: "af_heart/x.mp3" } } }
const clipCache = new Map(); // url -> Promise<AudioBuffer>
let clipSource = null; // the clip playing now, so a new line can cut it off
let voices = [];

fetch("./voice/manifest.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => {
    clipManifest = m?.voices ? m : null;
    refreshVoices();
  })
  .catch(() => {});

const kokoroVoices = () => Object.keys(VOICES).filter((id) => clipManifest?.voices[id]);
/** Selected voice: "kokoro:<id>" or a system voice name. Default: first Kokoro voice. */
function selectedVoice() {
  const want = store.voiceName;
  if (want?.startsWith(KOKORO) && kokoroVoices().includes(want.slice(KOKORO.length))) return want;
  if (want && voices.some((v) => v.name === want)) return want;
  return kokoroVoices().length ? KOKORO + kokoroVoices()[0] : (voices[0]?.name ?? "");
}
function chosenVoice() {
  // best or selected system voice (for fallback speech)
  const sel = selectedVoice();
  return voices.find((v) => v.name === sel) || voices[0] || null;
}

function refreshVoices() {
  const lang = navigator.language || "en-US";
  voices =
    "speechSynthesis" in window
      ? window.speechSynthesis
          .getVoices()
          .slice()
          .sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang))
      : [];
  const pick = $("voice-pick");
  pick.replaceChildren();
  for (const id of kokoroVoices()) pick.add(new Option(VOICES[id], KOKORO + id));
  for (const v of voices) pick.add(new Option(`System: ${v.name} (${v.lang})`, v.name));
  const sel = selectedVoice();
  pick.value = sel;
  const best = voices[0];
  $("voice-note").textContent = sel.startsWith(KOKORO)
    ? "Recorded natural voice (Kokoro). A custom spoken prompt uses your browser's voice."
    : !voices.length
      ? "No voice available in this browser."
      : best && voiceScore(best, lang) <= 0
        ? "Only basic system voices are installed here, so they may sound robotic. Pick a natural voice above."
        : `Using ${(chosenVoice() || best).name}.`;
}
if ("speechSynthesis" in window) {
  refreshVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
}
$("voice-pick").addEventListener("change", (e) => {
  store.voiceName = e.target.value;
  save();
  refreshVoices();
});

function loadClip(url) {
  if (!clipCache.has(url)) {
    clipCache.set(
      url,
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => ensureAudio().decodeAudioData(b)),
    );
  }
  return clipCache.get(url);
}

function stopSpeech() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (clipSource) {
    try {
      clipSource.stop();
    } catch {
      /* already ended */
    }
    clipSource = null;
  }
}

function speakSystem(text) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = chosenVoice();
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  window.speechSynthesis.speak(u);
}

function speak(text) {
  if (test || practice || paused) return; // a line queued just before a pause or silent test must not play
  stopSpeech();
  const sel = selectedVoice();
  const file = sel.startsWith(KOKORO) ? clipManifest?.voices[sel.slice(KOKORO.length)]?.[text] : null;
  document.dispatchEvent(new CustomEvent("pg:speak", { detail: { text, engine: file ? "kokoro" : "system" } }));
  if (!file) return speakSystem(text);
  loadClip(`./voice/${file}`)
    .then((buffer) => {
      if (paused || test || practice) return;
      const ac = ensureAudio();
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(ac.destination);
      src.onended = () => {
        if (clipSource === src) clipSource = null;
      };
      clipSource = src;
      src.start();
    })
    .catch(() => speakSystem(text)); // clip missing or undecodable
}

let praiseIndex = 0;
const nextPraise = () => PRAISE[praiseIndex++ % PRAISE.length];
let recoveryIndex = 0;
const nextRecovery = () => RECOVERY_PRAISE[recoveryIndex++ % RECOVERY_PRAISE.length];

async function decodeFile(file) {
  const ac = ensureAudio();
  return ac.decodeAudioData(await file.arrayBuffer());
}

async function restoreSound(kind) {
  const dataUrl = store[`${kind}Sound`];
  if (!dataUrl) return;
  try {
    // Decode the base64 payload directly: fetch(data:) is blocked by connect-src 'self'.
    const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    custom[kind] = await ensureAudio().decodeAudioData(bytes.buffer);
  } catch {
    delete store[`${kind}Sound`];
    save();
  }
}

for (const kind of ["bad", "good"]) {
  $(`${kind}-file`).addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      custom[kind] = await decodeFile(file);
      if (file.size < 1_500_000) {
        // small enough to keep across reloads
        store[`${kind}Sound`] = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        save();
      }
    } catch (err) {
      showError(`could not decode ${file.name}: ${err.message || err}`);
    }
  });
}
$("test-bad").addEventListener("click", () => playBad());
$("test-voice").addEventListener("click", () => {
  ensureAudio();
  speak(TEST_LINE);
});
$("test-good").addEventListener("click", () => playGood());
$("clear-sounds").addEventListener("click", () => {
  custom.bad = custom.good = null;
  delete store.badSound;
  delete store.goodSound;
  save();
  $("bad-file").value = "";
  $("good-file").value = "";
});

let notifyEnabled = false;
$("notify").addEventListener("click", async () => {
  if (!("Notification" in window)) return showError("notifications are not supported here");
  notifyEnabled = (await Notification.requestPermission()) === "granted";
  $("notify").textContent = notifyEnabled ? "Notifications on" : "Notifications blocked";
});

const BANNERS = {
  [Nudge.POSITIVE_CHIME]: "Nice posture!",
  [Nudge.RECOVERY]: "Back to good posture",
};
let reminderCount = 0;
let bannerTimer = null;

/** Banner text for a reminder: what is off and how to fix it when the engine
 *  has a cue for this frame, the generic wording otherwise. */
function reminderText(nudge, cue) {
  if (nudge === Nudge.CHIME) return cue ? `${cue.title}: ${cue.fix}` : "Reminder: sit up";
  if (nudge === Nudge.VOICE) return cue ? `${cue.title}: ${cue.fix}` : `Reminder: ${settings.voiceText}`;
  return BANNERS[nudge];
}

let episode = 0; // counts slouch episodes, for the coaching policy
let lastBad = false;

function showReminderNote(on) {
  $("reminder-note").classList.toggle("show", on);
}

function fire(nudge, cue) {
  if (test || practice) return; // silent test or practice: withhold every cue
  if (breath.active) return; // a breath check is talking; posture cues wait ~9 s
  const reminder = nudge === Nudge.CHIME || nudge === Nudge.VOICE;
  const nowS = performance.now() / 1000;
  if (reminder) {
    const verdict = policy.onReminder(nowS, { episodeId: episode, voice: nudge === Nudge.VOICE });
    if (verdict.capped) {
      showReminderNote(true);
      return;
    } // too many in an hour: stay quiet
    if (nudge === Nudge.VOICE && !verdict.voice) nudge = Nudge.CHIME; // light: chime instead of voice
    reminderCount += 1;
    prompts.notePosture(pclock); // a posture reminder owns the screen: other prompts wait
  } else if (nudge === Nudge.POSITIVE_CHIME && !policy.onPraise("timed")) {
    return; // light coaching: no timed praise
  }
  const praise = nudge === Nudge.POSITIVE_CHIME ? nextPraise() : nudge === Nudge.RECOVERY ? nextRecovery() : null;
  const text = praise || reminderText(nudge, cue);
  const banner = $("banner");
  banner.textContent = text;
  banner.classList.toggle("positive", !reminder);
  banner.classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove("show"), cue ? 5000 : 2500);
  if (!allowed(nudge)) return; // silent / chime-only: still a visible event
  if (nudge === Nudge.VOICE) speak(settings.specificCues && cue ? cue.say : settings.voiceText);
  else if (nudge === Nudge.CHIME) playBad();
  else {
    playGood();
    // Spoken praise rides on "Chime + voice": after the arpeggio (~0.8 s).
    if (praise && settings.spokenPraise && settings.mode === "chime_and_voice") {
      setTimeout(() => speak(praise), custom.good ? 400 : 850);
    }
  }
  if (notifyEnabled && document.hidden && reminder) {
    new Notification("BackUp", { body: text, silent: true });
  }
}

// -- calibration UI -----------------------------------------------------------

$("calib-good").addEventListener("click", () => engine.calibration.start("good"));
$("calib-bad").addEventListener("click", () => engine.calibration.start("bad"));
$("calib-reset").addEventListener("click", () => {
  engine.calibration.reset();
  delete store.calibration;
  save();
});

function renderCalibration() {
  const c = engine.calibration.status;
  $("calib-error").textContent = c.error || "";
  if (c.active) {
    $("calib-status").textContent =
      `Recording ${c.active === "bad" ? "slouch" : "good"} posture... hold still (${c.remaining_s.toFixed(1)} s)`;
  } else if (c.good || c.bad) {
    $("calib-status").textContent =
      `good: ${c.good ? c.good_samples + " frames" : "not recorded"} \u00b7 slouch: ` +
      `${c.bad ? c.bad_samples + " frames" : "not recorded"}` +
      (c.calibrated ? " \u00b7 needle calibrated" : "");
  }
  if (engine.calibration.version !== savedCalVersion) {
    savedCalVersion = engine.calibration.version;
    if (c.good || c.bad) {
      store.calibration = { good: c.good, bad: c.bad, good_samples: c.good_samples, bad_samples: c.bad_samples };
    } else delete store.calibration;
    save();
  }
}

// -- session stats ------------------------------------------------------------

const session = { good: 0, bad: 0, streak: 0, best: 0, lastT: null };
store.days = store.days || {};

// -- relax, don't brace -----------------------------------------------------------
// Good posture should be a relaxed stack, not a squeeze. relax.js watches the
// ears-to-shoulders gap for shoulders creeping up while posture reads good,
// and runs the breath check ("if your shoulders rise when you breathe in, you
// are bracing"). See relax.js for the measurement.

// -- consent for shoulder and breathing features -------------------------------------
// Breath check, "Breathe with me", breathing moments and shoulder-creep
// reminders read shoulder, neck and nose landmarks. They stay off until the
// user opts in (a dated record in the store, see consent.js). Posture tracking
// itself does not need it.

let consentThen = null; // runs after the user agrees
function renderConsentStatus() {
  $("consent-status").textContent = consentStatus(store);
  $("consent-withdraw").hidden = !hasConsent(store);
  $("consent-open").hidden = hasConsent(store);
}
/** True when consent exists. Otherwise opens the consent dialog and runs `then` after the user agrees. */
function requireConsent(then) {
  if (hasConsent(store)) return true;
  consentThen = then || null;
  $("consent-check").checked = false;
  $("consent-agree").disabled = true;
  $("consent-dialog").showModal();
  return false;
}
$("consent-title").textContent = CONSENT_TITLE;
$("consent-label").append(CONSENT_CHECKBOX);
$("consent-list").replaceChildren(
  ...CONSENT_POINTS.map((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    return li;
  }),
);
$("consent-check").addEventListener("change", (e) => {
  $("consent-agree").disabled = !e.target.checked;
});
$("consent-agree").addEventListener("click", () => {
  recordConsent(store);
  save();
  $("consent-dialog").close();
  renderConsentStatus();
  renderPromptSettings();
  const then = consentThen;
  consentThen = null;
  if (then) then();
});
$("consent-cancel").addEventListener("click", () => {
  consentThen = null;
  $("consent-dialog").close();
  renderPromptSettings();
});
$("consent-dialog").addEventListener("close", () => {
  if (!hasConsent(store)) renderPromptSettings();
});
$("consent-open").addEventListener("click", () => requireConsent(null));
$("consent-withdraw").addEventListener("click", () => {
  withdrawConsent(store);
  save();
  guide.cancel();
  breath.cancel?.();
  if (card) hideCard();
  prompts.dismiss(pclock, "done");
  renderConsentStatus();
  renderPromptSettings();
});

const bracing = new BracingMonitor();
const breath = new BreathCheck();
const AUTO_BREATH_S = 20 * 60; // coached good-posture time between automatic checks
let goodSinceBreath = 0;
let relaxLastT = null;
Object.assign(settings, resolveSettings(store)); // relaxReminders and pauseShortcut: on for new users, stored choices kept

/** Relax lines are spoken unless the mode is silent (chime-only still talks
 *  here: a breath check without words is not a check). */
function sayRelax(line) {
  if (settings.mode !== "silent") speak(line);
}

function showRelaxBanner(text) {
  const banner = $("banner");
  banner.textContent = text;
  banner.classList.remove("positive");
  banner.classList.add("show", "relax");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove("show", "relax"), 6000);
}

const VERDICT_TEXT = {
  rose: "Shoulders rose on the breath in: you were bracing. Let them hang and breathe into your belly.",
  held: "Shoulders dropped when you let go: you were holding them up. That lower spot is where they belong.",
  relaxed: "Relaxed and stacked. Your shoulders stayed put through the breath.",
  unclear: "Couldn't see your shoulders clearly. Face the camera and try again.",
};

function startBreathCheck() {
  if (test || practice || paused || breath.active || guide.active || !loopsStarted) return;
  if (!requireConsent(startBreathCheck)) return;
  ensureAudio();
  goodSinceBreath = 0;
  breath.start(performance.now() / 1000, bracing.value);
  $("relax-status").textContent = "Breathe in slowly...";
  sayRelax(RELAX_LINES.inhale);
  showRelaxBanner("Breath check: slow, deep breath in");
}

function relaxStep(landmarks, state, now) {
  if (test || practice) {
    relaxLastT = null;
    return;
  }
  if (!hasConsent(store)) {
    relaxLastT = null;
    $("relax-shoulders").textContent = "off until you opt in";
    return;
  }
  const ratio = neckRatio(landmarks);
  const good = state === State.GOOD;
  const flagged = bracing.update(ratio, now, good && !breath.active);
  if (flagged && settings.relaxReminders && !breath.active) {
    showRelaxBanner(RELAX_LINES.bracing);
    sayRelax(RELAX_LINES.bracing);
    store.bracingCount = (store.bracingCount || 0) + 1;
    save();
    prompts.enqueue("offer", pclock); // offer "Breathe with me" (scheduler rules apply)
  }
  if (breath.active) {
    const step = breath.update(bracing.value, now);
    if (step === "exhale") {
      $("relax-status").textContent = "Breathe out and let your shoulders drop...";
      sayRelax(RELAX_LINES.exhale);
      showRelaxBanner("Breathe out, let your shoulders drop");
    } else if (step) {
      if (step.kind !== "unclear" && step.kind !== "rose") bracing.pinRelaxed(step.relaxed);
      $("relax-status").textContent = VERDICT_TEXT[step.kind];
      sayRelax(RELAX_LINES[step.kind]);
      $("banner").classList.remove("show", "relax");
    }
  } else if (good && settings.relaxReminders && relaxLastT !== null) {
    goodSinceBreath += Math.min(1, Math.max(0, now - relaxLastT));
    if (goodSinceBreath >= AUTO_BREATH_S) prompts.enqueue("breath", pclock); // the scheduler decides when
  }
  relaxLastT = now;
  const ref = bracing.reference;
  const v = bracing.value;
  $("relax-shoulders").textContent =
    ref === null || v === null ? "learning your relaxed shoulders..." : v < ref * 0.88 ? "creeping up" : "relaxed";
}

// Controls that need frames from the camera or the demo stay disabled until tracking starts.
const NEEDS_TRACKING = ["breath-check", "breathe-with-me", "calib-good", "calib-bad"];
const READY_TITLE = {
  "breath-check": "Breathe in: if your shoulders rise, you are bracing",
  "breathe-with-me": "One minute of easy breathing, then a breath check",
};
function setTrackingControls(on) {
  for (const id of NEEDS_TRACKING) {
    const el = $(id);
    el.disabled = !on;
    if (!on) el.title = NEEDS_TRACKING_TIP;
    else if (READY_TITLE[id]) el.title = READY_TITLE[id];
    else el.removeAttribute("title");
  }
  $("pre-start-note").hidden = on;
}

$("breath-check").addEventListener("click", startBreathCheck);
$("relax-reminders").addEventListener("change", (e) => {
  const on = e.target.checked;
  const apply = () => {
    settings.relaxReminders = on;
    store.relaxReminders = on;
    save();
    renderPromptSettings();
  };
  if (on && !requireConsent(apply)) return;
  apply();
});

// -- breaks and prompts ---------------------------------------------------------
// Everything that is not a posture reminder goes through one PromptScheduler
// (prompts.js): eye break (20-20-20), move break, breathing moments, the auto
// breath check and the "Breathe with me" offer. One card at a time, none in the
// first 5 min, at most one per 10 min, none while paused, in a silent test or
// during a breath check. Prompt timers run on a prompt clock that only advances
// while tracking is running (paused or hidden gaps never count).
//
// Testing hook: ?clockScale=N (1..1000) makes that prompt clock run N times
// faster, so an end-to-end test can see a 20 minute eye break in seconds. It
// scales only the prompt timers: tracking, reminders and countdowns stay real.

const CLOCK_SCALE = (() => {
  const n = Number(new URLSearchParams(location.search).get("clockScale"));
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : 1;
})();
const DISMISS_KEY = { eye: "eye", move: "move", breathing: "breathing", offer: "breathing" };
const dismissed = settings.promptsDismissed;

function promptEnabled(id) {
  if (dismissed[DISMISS_KEY[id]]) return false;
  if (id === "eye") return settings.eyeBreaks;
  if (id === "move") return settings.moveBreakMinutes > 0;
  if (id === "breathing") return settings.breathingMoments && hasConsent(store);
  if (id === "breath" || id === "offer") return settings.relaxReminders && hasConsent(store);
  return true;
}

const prompts = new PromptScheduler({ isEnabled: promptEnabled });
const breaks = new BreakTracker(settings);
const moments = new BreathingMoments();
const guide = new BreatheGuide();
let pclock = 0; // prompt clock (scaled by clockScale)
let preal = 0; // real seconds of running tracking (card timers, guide)
let plast = null;
let pstreak = 0; // good-posture streak on the prompt clock
let card = null; // the prompt on screen: { id, text, t, finished }

function renderPromptSettings() {
  $("eye-breaks").checked = settings.eyeBreaks && !dismissed.eye;
  $("move-minutes").value = String(dismissed.move ? 0 : settings.moveBreakMinutes);
  $("breathing-moments").checked = settings.breathingMoments && !dismissed.breathing && hasConsent(store);
  $("relax-reminders").checked = settings.relaxReminders && hasConsent(store);
  $("breathe-cues").checked = settings.breatheCues;
  $("prompts-reset").hidden = !Object.keys(dismissed).length;
}
function savePromptSettings() {
  store.eyeBreaks = settings.eyeBreaks;
  store.moveBreakMinutes = settings.moveBreakMinutes;
  store.breathingMoments = settings.breathingMoments;
  store.breatheCues = settings.breatheCues;
  store.promptsDismissed = { ...dismissed };
  save();
  renderPromptSettings();
}
$("eye-breaks").addEventListener("change", (e) => {
  settings.eyeBreaks = e.target.checked;
  if (e.target.checked) delete dismissed.eye;
  breaks.setEyeBreaks(settings.eyeBreaks);
  savePromptSettings();
});
$("move-minutes").addEventListener("change", (e) => {
  breaks.setMoveMinutes(e.target.value);
  settings.moveBreakMinutes = breaks.moveMinutes;
  if (settings.moveBreakMinutes > 0) delete dismissed.move;
  savePromptSettings();
});
$("breathing-moments").addEventListener("change", (e) => {
  const on = e.target.checked;
  const apply = () => {
    settings.breathingMoments = on;
    if (on) delete dismissed.breathing;
    savePromptSettings();
  };
  if (on && !requireConsent(apply)) return; // asks first; renderPromptSettings resets the box if declined
  apply();
});
$("breathe-cues").addEventListener("change", (e) => {
  settings.breatheCues = e.target.checked;
  savePromptSettings();
});
$("prompts-reset").addEventListener("click", () => {
  for (const k of Object.keys(dismissed)) delete dismissed[k];
  savePromptSettings();
});
renderPromptSettings();
renderConsentStatus();

function breaksTakenToday() {
  const b = store.breaksToday;
  return b && b.day === todayKey() ? b.n : 0;
}
function countBreak() {
  store.breaksToday = { day: todayKey(), n: breaksTakenToday() + 1 };
  save();
}

/** Prompts speak only on "Chime + voice" (they are never required to be heard). */
function sayPrompt(line) {
  if (settings.mode === "chime_and_voice") speak(line);
}

const CARD_UI = {
  eye: { bar: true, snooze: true, never: true },
  move: { action: true, done: true, snooze: true, never: true },
  breathing: { action: true, never: true },
  offer: { action: true, never: true },
  guide: { bar: true, stop: true },
};

function renderCard() {
  const el = $("prompt-card");
  if (!card) {
    el.classList.remove("show");
    el.dataset.prompt = "";
    return;
  }
  const ui = CARD_UI[card.id];
  $("prompt-text").textContent = card.text;
  $("prompt-bar").hidden = !ui.bar;
  $("prompt-action").hidden = !ui.action;
  $("prompt-done").hidden = !ui.done || card.finished;
  $("prompt-snooze").hidden = !ui.snooze || card.finished;
  $("prompt-never").hidden = !ui.never || card.finished;
  $("prompt-notnow").hidden = card.finished;
  $("prompt-notnow").textContent = ui.stop ? "Stop" : "Not now";
  el.dataset.prompt = card.id;
  el.classList.add("show");
}

function setCardFill(f) {
  const pct = Math.round(Math.min(1, Math.max(0, f)) * 100);
  $("prompt-fill").style.width = `${pct}%`;
  $("prompt-bar").setAttribute("aria-valuenow", String(pct));
}

function hideCard() {
  card = null;
  renderCard();
}

/** The user (or a timeout) ends the card. how: done | snooze | notnow | never. */
function endCard(how) {
  if (card && card.id === "guide") {
    guide.cancel();
    hideCard();
    return;
  }
  const id = prompts.dismiss(pclock, how);
  if (how === "never" && DISMISS_KEY[id]) {
    dismissed[DISMISS_KEY[id]] = true;
    savePromptSettings();
  }
  hideCard();
}

/** Drop whatever prompt is on screen (pause, silent test, practice). */
function cancelPrompts() {
  hideSponsor();
  guide.cancel();
  if (card) endCard("done");
  prompts.dismiss(pclock, "done");
}

function showPrompt(item) {
  if (item.id === "share") {
    showSponsor();
    return;
  }
  if (item.id === "breath") {
    // the auto breath check has its own UI
    prompts.dismiss(pclock, "done");
    startBreathCheck();
    return;
  }
  const text =
    item.id === "eye"
      ? BREAK_LINES.eye
      : item.id === "move"
        ? BREAK_LINES.move
        : item.id === "offer"
          ? BREATHE_LINES.offer
          : moments.take(pclock);
  card = { id: item.id, text, t: 0, finished: false };
  setCardFill(0);
  renderCard();
  if (item.id !== "offer") sayPrompt(text);
}

function startGuide() {
  if (test || practice || paused || breath.active || guide.active || !loopsStarted) return;
  if (!requireConsent(startGuide)) return;
  ensureAudio();
  if (card) endCard("done");
  guide.start(preal);
  card = { id: "guide", text: `${BREATHE_LINES.intro}`, t: 0, finished: false };
  setCardFill(0);
  renderCard();
  if (settings.breatheCues && settings.mode !== "silent") speak(BREATHE_LINES.intro);
}

function guideStep() {
  const g = guide.update(preal);
  if (!g) return;
  if (g.phase === "done") {
    hideCard();
    if (settings.breatheCues && settings.mode !== "silent") speak(BREATHE_LINES.done);
    startBreathCheck(); // ends with the existing breath check: do the shoulders stay down?
    return;
  }
  setCardFill(g.fill);
  if (g.phaseStart) {
    card.text = `${g.phase === "in" ? "Breathe in..." : "Breathe out slowly..."} ${GUIDE_SAFETY}`;
    $("prompt-text").textContent = card.text;
    if (settings.breatheCues && settings.mode !== "silent" && g.cycle < 2) {
      speak(g.phase === "in" ? BREATHE_LINES.in : BREATHE_LINES.out);
    }
  }
}

/** Runs every tracked frame (real `now` in seconds). */
function promptStep(state, now) {
  if (test || practice || paused) {
    plast = null;
    return;
  }
  const dt = plast === null ? 0 : Math.min(1, Math.max(0, now - plast));
  plast = now;
  preal += dt;
  pclock += dt * CLOCK_SCALE;
  const present = state !== State.NO_PERSON;
  if (breaks.update(present, pclock)) countBreak();
  pstreak = state === State.GOOD ? pstreak + dt * CLOCK_SCALE : 0;
  if (!present && card && card.id !== "guide") endCard("done"); // no prompt while away
  if (!present && sponsorCard) {
    refundSponsorShown(store);
    save();
    hideSponsor();
  } // walking away is not an answer
  if (
    shouldOfferSponsor(store, {
      nowMs: Date.now(),
      good: pstreak >= SPONSOR.good_streak_s,
      silent: !!test || !!practice || paused,
    })
  ) {
    prompts.enqueue("share", pclock);
  }
  for (const kind of breaks.due(present)) prompts.enqueue(kind, pclock);
  if (settings.breathingMoments && moments.due(pstreak, pclock)) prompts.enqueue("breathing", pclock);
  if (sponsorCard) {
    sponsorCard.t += dt;
    if (sponsorCard.t >= 120) answerSponsorCard("later"); // ignoring it counts as "Maybe later"
  } else if (guide.active) guideStep();
  else if (card) {
    card.t += dt;
    if (card.id === "eye") {
      setCardFill(card.t / BREAKS.eye_look_s);
      if (!card.finished && card.t >= BREAKS.eye_look_s) {
        card.finished = true;
        card.text = BREAK_LINES.eyeDone;
        breaks.taken("eye");
        renderCard();
        sayPrompt(BREAK_LINES.eyeDone);
      }
      if (card.finished && card.t >= BREAKS.eye_look_s + 3) endCard("done");
    } else if (card.t >= 60) {
      endCard("notnow"); // ignoring a prompt counts as "Not now"
    }
  } else {
    const item = prompts.poll(pclock, {
      paused,
      test: !!test || !!practice,
      breathCheck: breath.active || guide.active,
    });
    if (item) showPrompt(item);
  }
}

$("prompt-action").addEventListener("click", () => startGuide());
$("prompt-done").addEventListener("click", () => {
  if (card && card.id === "move") breaks.taken("move");
  endCard("done");
});
$("prompt-snooze").addEventListener("click", () => endCard("snooze"));
$("prompt-notnow").addEventListener("click", () => endCard("notnow"));
$("prompt-never").addEventListener("click", () => endCard("never"));
$("breathe-with-me").addEventListener("click", startGuide);

// -- sponsor card (lowest priority prompt, never spoken, at most 3 times ever) -----
// A small non-modal card in the session panel. Gating is in sponsor.js; the
// counts it uses live only in this browser's store.

let sponsorCard = null; // { t } while on screen
$("sponsor-link").href = SPONSOR_URL;

function showSponsor() {
  const still = shouldOfferSponsor(store, {
    nowMs: Date.now(),
    good: pstreak >= SPONSOR.good_streak_s,
    silent: !!test || !!practice || paused,
  });
  if (!still) {
    prompts.dismiss(pclock, "done");
    return;
  } // conditions changed while it waited
  markSponsorShown(store);
  save();
  sponsorCard = { t: 0 };
  $("sponsor-text").textContent = sponsorText(store);
  $("sponsor-card").hidden = false;
}
function hideSponsor() {
  if (!sponsorCard) return;
  sponsorCard = null;
  $("sponsor-card").hidden = true;
  prompts.dismiss(pclock, "done");
}
function answerSponsorCard(how) {
  if (how !== "done") {
    answerSponsor(store, how, Date.now());
    save();
  }
  hideSponsor();
}
$("sponsor-later").addEventListener("click", () => answerSponsorCard("later"));
$("sponsor-never").addEventListener("click", () => answerSponsorCard("never"));
$("sponsor-link").addEventListener("click", () => answerSponsorCard("never")); // they acted: do not ask again
$("sponsor-share").addEventListener("click", () => {
  answerSponsorCard("later");
  openShare();
});

// -- share (Web Share API, else a menu of plain links; nothing third-party is loaded) --
function renderShareLinks() {
  const links = shareLinks(shareUrl(location.href), { instance: $("share-instance").value });
  for (const [id, href] of Object.entries(links)) {
    const a = $(`share-${id}`);
    if (a) a.href = href;
  }
  $("share-mastodon").hidden = !links.mastodon;
}
function openShare() {
  const url = shareUrl(location.href);
  $("share-native").hidden = typeof navigator.share !== "function";
  $("share-link").value = url;
  $("share-text").textContent = SHARE_TEXT;
  $("share-msg").textContent = "";
  $("share-card-wrap").hidden = true;
  renderShareLinks();
  $("share-dialog").showModal();
}
$("share-btn").addEventListener("click", openShare);
$("share-native").addEventListener("click", async () => {
  try {
    await navigator.share(nativeSharePayload(shareUrl(location.href)));
  } catch (e) {
    if (e?.name !== "AbortError") $("share-msg").textContent = "The share menu was blocked. Use the links below.";
  }
});
$("share-close").addEventListener("click", () => $("share-dialog").close());
// The score card is drawn from this session's two numbers only. No video frame is read.
let cardBlob = null;
$("share-card-btn").addEventListener("click", () => {
  const d = scoreCardData(session);
  if (!d) {
    $("share-msg").textContent = "Track at least a minute of posture first, then your score card is ready.";
    return;
  }
  const canvas = $("share-card");
  drawScoreCard(canvas.getContext("2d"), d);
  canvas.setAttribute("aria-label", cardAltText(d));
  $("share-card-wrap").hidden = false;
  $("share-msg").textContent = "";
  cardBlob = null;
  canvas.toBlob((b) => {
    cardBlob = b;
    const file = b && new File([b], "backup-score.png", { type: "image/png" });
    $("share-card-share").hidden = !(file && navigator.canShare?.({ files: [file] }));
  }, "image/png");
});
$("share-card-download").addEventListener("click", () => {
  if (!cardBlob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(cardBlob);
  a.download = "backup-score.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("share-card-share").addEventListener("click", async () => {
  if (!cardBlob) return;
  try {
    await navigator.share({
      files: [new File([cardBlob], "backup-score.png", { type: "image/png" })],
      text: SHARE_TEXT,
    });
  } catch (e) {
    if (e?.name !== "AbortError")
      $("share-msg").textContent = "Sharing the image was blocked. Use Download PNG instead.";
  }
});
$("share-instance").addEventListener("input", () => {
  renderShareLinks();
  const v = $("share-instance").value.trim();
  $("share-msg").textContent = v && !normalizeInstance(v) ? "Enter just the server name, such as mastodon.social." : "";
});
$("share-copy").addEventListener("click", async () => {
  const text = `${SHARE_TEXT} ${$("share-link").value}`;
  try {
    await navigator.clipboard.writeText(text);
    $("share-msg").textContent = "Copied.";
  } catch {
    $("share-link").select();
    $("share-msg").textContent = "Copy was blocked. The link is selected: press Ctrl+C (or Cmd+C).";
  }
});

function resetPromptSession() {
  prompts.startSession(pclock);
  breaks.reset();
  moments.last = null;
  pstreak = 0;
  plast = null;
}

// -- silent test ("Test me") ---------------------------------------------------
// A retention test in motor-learning terms: same tracking and state machine,
// but every cue is withheld (no sounds, speech, banners, needle, hold bar or
// live score), so the score reflects the habit rather than the reminders.
// Results are kept per test; coached time keeps feeding store.days.

store.tests = store.tests || [];
let test = null; // { minutes, elapsed, good, bad } while a test runs

function startTest() {
  if (test) return finishTest(true);
  if (practice) stopPractice();
  test = { minutes: Number($("test-minutes").value) || 10, elapsed: 0, good: 0, bad: 0 };
  breath.cancel();
  cancelPrompts();
  stopSpeech();
  document.body.classList.add("testing");
  $("banner").classList.remove("show");
  $("test-start").textContent = "Stop test";
  $("test-progress-wrap").style.display = "";
  renderTest();
}

function finishTest(stoppedEarly) {
  const t = test;
  test = null;
  document.body.classList.remove("testing");
  $("test-start").textContent = "Start silent test";
  $("test-progress-wrap").style.display = "none";
  const tracked = t.good + t.bad;
  if (!stoppedEarly && tracked >= 30) {
    store.tests.push({
      at: new Date().toISOString(),
      minutes: t.minutes,
      good: Math.round(t.good),
      bad: Math.round(t.bad),
    });
    store.tests = store.tests.slice(-50);
    save();
    $("test-status").textContent = `Done: ${pctOf(t)}% good posture with no reminders.`;
    renderProgress();
    playGood();
  } else {
    $("test-status").textContent = stoppedEarly
      ? "Test stopped, not saved."
      : "Not enough tracked time to score; not saved.";
  }
  renderTest();
}

const pctOf = (r) => (r.good + r.bad > 0 ? Math.round((100 * r.good) / (r.good + r.bad)) : null);

function renderTest() {
  if (test) {
    const left = Math.max(0, test.minutes * 60 - test.elapsed);
    $("test-status").textContent = `Silent test running: ${mmss(left)} left. Sit and work as usual.`;
    $("test-progress").style.width = `${Math.min(100, (100 * test.elapsed) / (test.minutes * 60)).toFixed(1)}%`;
  }
  const tests = store.tests;
  const coached = Object.values(store.days).reduce((a, d) => ({ good: a.good + d.good, bad: a.bad + d.bad }), {
    good: 0,
    bad: 0,
  });
  const parts = [];
  if (tests.length) {
    const first = tests[0],
      last = tests[tests.length - 1];
    parts.push(
      tests.length === 1
        ? `Silent test: <b>${pctOf(last)}%</b> good`
        : `Silent tests: first <b>${pctOf(first)}%</b> &rarr; latest <b>${pctOf(last)}%</b> (${tests.length} tests)`,
    );
  } else {
    parts.push("No silent tests yet. Take one now for a baseline, then again after a few days of coaching.");
  }
  if (coached.good + coached.bad > 0) parts.push(`With coaching: <b>${pctOf(coached)}%</b> good`);
  $("test-compare").innerHTML = parts.join(" &middot; ");
}

$("test-start").addEventListener("click", () => {
  ensureAudio();
  startTest();
});

const DAY_SAVE_S = 15;
let lastDaySave = 0;

/** Effort-based praise at 5, 15, 30 and 60 continuous good minutes (banner and chime;
 *  spoken only when spoken praise is on, using the existing praise clips). */
function fireMilestone(minute) {
  if (test || practice || paused || breath.active || !policy.onPraise("milestone")) return;
  const banner = $("banner");
  banner.textContent = MILESTONE_TEXT[minute];
  banner.classList.remove("relax");
  banner.classList.add("positive", "show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove("show"), 6000);
  if (!allowed(Nudge.POSITIVE_CHIME)) return;
  playGood();
  if (settings.spokenPraise && settings.mode === "chime_and_voice") {
    const line = nextPraise();
    setTimeout(() => speak(line), custom.good ? 400 : 850);
  }
}

function account(state, now) {
  if (session.lastT !== null) {
    const dt = Math.min(1, Math.max(0, now - session.lastT)); // cap gaps (sleep, hidden stalls)
    if (test) {
      test.elapsed += dt;
      if (state === State.GOOD) test.good += dt;
      else if (state === State.BAD_CHIME || state === State.BAD_VOICE) test.bad += dt;
      session.lastT = now;
      if (test.elapsed >= test.minutes * 60) finishTest(false);
      return;
    }
    if (practice) {
      session.lastT = now;
      return;
    } // practice records nothing
    const dayKey = todayKey();
    store.days[dayKey] = store.days[dayKey] || { good: 0, bad: 0 };
    const day = store.days[dayKey];
    if (state === State.GOOD) {
      session.good += dt;
      day.good += dt;
      session.streak += dt;
      session.best = Math.max(session.best, session.streak);
      const milestone = policy.onGood(now, dt);
      if (milestone !== null) fireMilestone(milestone);
    } else if (state === State.BAD_CHIME || state === State.BAD_VOICE) {
      session.bad += dt;
      day.bad += dt;
      session.streak = 0;
      policy.onBad();
    }
    if (now - lastDaySave >= DAY_SAVE_S) {
      lastDaySave = now;
      save();
    } // keep daily totals across reloads
  }
  session.lastT = now;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function renderStats() {
  const tracked = session.good + session.bad;
  const pct = tracked > 0 ? Math.round((100 * session.good) / tracked) : null;
  $("good-pct").textContent = pct === null ? "-" : `${pct}%`;
  $("good-bar").style.width = `${pct ?? 0}%`;
  $("best-streak").textContent = mmss(session.best);
  $("reminder-count").textContent = String(reminderCount);
  $("breaks-count").textContent = String(breaksTakenToday());
  const day = store.days[todayKey()];
  $("today").textContent = day ? `${mmss(day.good)} good, ${mmss(day.bad)} slouched` : "nothing tracked yet";
}

// -- rendering ----------------------------------------------------------------

const STATE_LABELS = {
  [State.GOOD]: "good posture",
  [State.BAD_CHIME]: "sit up",
  [State.BAD_VOICE]: "sit up",
  [State.NO_PERSON]: "no one in view",
  [State.UNRELIABLE]: "tracking unsure",
};

const WIRE = { good: "#4cc36a", drift: "#ffb340", bad: "#ff5c5c", slate: "#8b95a3" };
const SKELETON = [
  [7, 8],
  [7, 11],
  [8, 12],
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
];

function wireColor(state, result) {
  if (state === State.BAD_CHIME || state === State.BAD_VOICE) return WIRE.bad;
  if (result.kind !== "scored") return WIRE.slate;
  const cfg = DEFAULTS.scoring;
  if (
    Math.abs(result.head_forward_deg) > cfg.head_forward_deg ||
    Math.abs(result.head_tilt_deg) > cfg.head_tilt_deg ||
    Math.abs(result.shoulder_level_deg) > cfg.shoulder_level_deg
  )
    return WIRE.drift;
  return state === State.GOOD ? WIRE.good : WIRE.slate;
}

function drawSkeleton(landmarks, color, cv = canvas, c = ctx, scale = 1) {
  cv.width = cv.clientWidth;
  cv.height = cv.clientHeight;
  const w = cv.width;
  const h = cv.height;
  c.clearRect(0, 0, w, h);
  if (!landmarks) return;
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = 4 * scale;
  for (const [a, b] of SKELETON) {
    const p = landmarks[a],
      q = landmarks[b];
    if (![p.x, p.y, q.x, q.y].every(Number.isFinite)) continue;
    c.beginPath();
    c.moveTo(p.x * w, p.y * h);
    c.lineTo(q.x * w, q.y * h);
    c.stroke();
  }
  const le = landmarks[7],
    re = landmarks[8];
  if ([le.x, le.y, re.x, re.y].every(Number.isFinite)) {
    // head outline between the ears
    const r = Math.hypot((re.x - le.x) * w, (re.y - le.y) * h) * 0.75;
    c.beginPath();
    c.arc(((le.x + re.x) / 2) * w, ((le.y + re.y) / 2) * h - r * 0.35, r, 0, 2 * Math.PI);
    c.stroke();
  }
  for (const i of TRACKED) {
    const p = landmarks[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    c.beginPath();
    c.arc(p.x * w, p.y * h, 6 * scale, 0, 2 * Math.PI);
    c.fill();
  }
}

function causeFor(result, landmarks) {
  if (landmarks && landmarks[LEFT_EAR].y < 0.1) return "head near the top edge - lower the camera or sit lower";
  if (result.kind !== "unreliable") return "";
  switch (result.reason) {
    case Reason.NO_POSE:
      return "no one in view - sit facing the camera";
    case Reason.LOW_VISIBILITY:
      return `low confidence - ${result.detail}`;
    case Reason.FRAMING_OUT_OF_BAND:
      return result.detail.startsWith("too close") ? "too close - move back a little" : "too far - move closer";
    case Reason.NON_FINITE:
      return "tracking glitch - holding the last state";
    default:
      return result.detail;
  }
}

/** The "what to fix" box: shown while a reminder is active or a metric is past
 *  its threshold; quiet (and green) when posture is good. */
function renderFix(state, result, cue, hold) {
  const box = $("fix-box");
  const bad = state === State.BAD_CHIME || state === State.BAD_VOICE;
  const drifting = result.kind === "scored" && wireColor(state, result) === WIRE.drift;
  let title,
    how = "",
    cls = "";
  if ((bad || drifting) && cue) {
    title = cue.title;
    how = cue.fix;
    cls = "active";
  } else if (bad) {
    title = "Almost there";
    cls = "active"; // the hold bar shows how long is left
  } else if (state === State.GOOD) {
    title = "Looking good";
    how = "Stay soft: shoulders heavy, breathing easy.";
    cls = "ok";
  } else {
    title = "What to fix shows up here";
  }
  $("fix-title").textContent = title;
  $("fix-how").textContent = how;
  box.className = `fix ${cls}`;
  for (const metric of ["head_forward", "head_tilt", "shoulder_level", "trunk_lean"]) {
    $(`t-${metric}`).classList.toggle("focus", cls === "active" && cue !== null && cue.metric === metric);
  }
  renderHold(hold);
}

// Fill-on-hold bar: fills while you hold a posture, so "hold it" shows how
// long is left instead of saying "a few seconds".
const HOLD_TEXT = {
  recover: (s) => `Hold it… reminder clears in ${s}`,
  confirm: (s) => `Hold it… good posture in ${s}`,
  slipping: (s) => `Slouching… reminder in ${s}`,
  praise: (s) => `Good posture held… next “looking good” in ${s}`,
};
function renderHold(hold) {
  const bar = $("hold-bar");
  if (!hold) {
    bar.className = "hold idle";
    return;
  }
  const secs = hold.remaining >= 10 ? `${Math.ceil(hold.remaining)} s` : `${hold.remaining.toFixed(1)} s`;
  bar.className = `hold ${hold.kind === "slipping" ? "warn" : "good"}`;
  $("hold-fill").style.width = `${(hold.fraction * 100).toFixed(1)}%`;
  $("hold-text").textContent = HOLD_TEXT[hold.kind](secs);
  bar.setAttribute("aria-valuenow", String(Math.round(hold.fraction * 100)));
}

// Compact live views inside the practice and setup panels, so the skeleton and
// needle sit next to the instructions. Hidden and skipped during the silent test.
const MINI_VIEWS = ["practice", "setup"].map((pre) => {
  const cv = $(`${pre}-mini-canvas`);
  return { pre, cv, c: cv.getContext("2d"), rotor: $(`${pre}-needle-rotor`), root: $(`${pre}-mini`) };
});

function renderMiniViews(landmarks, color, needle) {
  const open = { practice: !!practice, setup: $("setup-panel").open };
  const draw = new Set(
    miniViewsToDraw(
      MINI_VIEWS.map((m) => m.pre),
      open,
      needle,
    ),
  );
  for (const m of MINI_VIEWS) {
    if (!draw.has(m.pre)) continue;
    drawSkeleton(landmarks, color, m.cv, m.c, MINI_SCALE);
    m.rotor.setAttribute("transform", needleTransform(needle));
  }
}

// -- load marks -----------------------------------------------------------------
// performance.now() at each start-up milestone, kept for the bug-report
// diagnostics and for e2e (window.__loadMarks). Only the first hit counts.
const loadMarks = {};
window.__loadMarks = loadMarks;
function markLoad(name) {
  if (loadMarks.click !== undefined && loadMarks[name] === undefined) loadMarks[name] = Math.round(performance.now());
}

function render(out, landmarks) {
  const { result, transition, needle, cue, hold } = out;
  if (result.kind === "scored") {
    markLoad("firstScored");
    if (transition.state !== State.NO_PERSON) markLoad("settled");
  }
  renderFix(transition.state, result, cue, hold);
  if (practice) renderPractice(result);
  const badge = $("state-badge");
  // NO_PERSON is also the start state: it lasts until posture is clearly good
  // or clearly bad, so a tracked person sitting in the in-between band would
  // otherwise read "no one in view" while being scored.
  badge.textContent =
    transition.state === State.NO_PERSON && result.kind === "scored"
      ? "settling in"
      : STATE_LABELS[transition.state] || transition.state;
  badge.className = `badge ${transition.state}`;
  const settling = !test && !practice && badge.textContent === "settling in";
  $("settling-note").hidden = !settling;
  badge.title = settling ? $("settling-note").textContent : "";
  if (test) {
    badge.textContent = "silent test";
    badge.className = "badge testing";
  }
  if (practice) {
    badge.textContent = "practice";
    badge.className = "badge practice";
  }
  $("warnings").textContent = causeFor(result, landmarks);
  const cfg = DEFAULTS.scoring;
  for (const key of ["head_forward_deg", "head_tilt_deg", "shoulder_level_deg", "trunk_lean_deg"]) {
    const el = $(`m-${key}`);
    let v = result.kind === "scored" ? result[key] : null;
    if (key === "trunk_lean_deg" && result.kind === "scored" && !result.trunk_lean_available) v = null;
    el.textContent = v === null ? "-" : `${Math.round(v)}\u00b0`;
    el.classList.toggle("over", v !== null && Math.abs(v) > cfg[key]);
  }
  if (needle !== null) {
    $("needle-rotor").setAttribute("transform", needleTransform(needle));
    // The threshold needle averages all metrics, so a single-metric slouch
    // sits mid-dial: the label follows the state machine, the needle shows how far.
    const bad = transition.state === State.BAD_CHIME || transition.state === State.BAD_VOICE;
    const label = bad
      ? "slouching"
      : needle > -0.3 || wireColor(transition.state, result) === WIRE.drift
        ? "drifting"
        : "upright";
    $("needle-text").textContent = label + (engine.needleCalibrated ? " \u00b7 calibrated" : "");
  }
  drawSkeleton(landmarks, test ? WIRE.slate : wireColor(transition.state, result));
  renderMiniViews(landmarks, test ? WIRE.slate : wireColor(transition.state, result), test ? null : needle);
  renderTest();
  renderCalibration();
  updateFirstRunLive(result, landmarks);
  renderStats();
  if (Date.now() - lastProgressRender > 10000) renderProgress();
}

// -- frame loop ----------------------------------------------------------------

let poseLandmarker = null;
let demo = false;
let lastProcessed = 0;
let lastVideoMs = -1;
let fpsEma = 0;
let lastFrameT = null;

function demoPose(t) {
  const slouch = Math.floor(t / DEMO_CYCLE_S) % 2 === 1;
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const wobble = Math.sin(t * 1.7) * 0.003;
  lm[11] = { x: 0.6 + wobble, y: 0.62, visibility: 0.99 }; // unmirrored: left shoulder on the right
  lm[12] = { x: 0.4 + wobble, y: 0.62, visibility: 0.99 };
  lm[23] = { x: 0.56, y: 0.95, visibility: 0.9 };
  lm[24] = { x: 0.44, y: 0.95, visibility: 0.9 };
  const ex = slouch ? -0.02 : 0,
    ey = slouch ? 0.09 : 0;
  lm[7] = { x: 0.54 + ex + wobble, y: 0.46 + ey, visibility: 0.99 };
  lm[8] = { x: 0.46 + ex + wobble, y: 0.46 + ey, visibility: 0.99 };
  return lm;
}

// -- pause ----------------------------------------------------------------------
// Paused: no pose tracking, no reminders or praise, no stats, and the camera
// track is disabled (the picture goes black; most browsers turn the camera
// light off). Resuming starts fresh so paused time can never fire a reminder.

let paused = false;

function setPaused(on) {
  if (!loopsStarted || on === paused) return;
  paused = on;
  save(); // flush daily totals when pausing
  const stream = video.srcObject;
  if (stream)
    stream.getVideoTracks().forEach((t) => {
      t.enabled = !on;
    });
  if (on) {
    if (practice) stopPractice();
    breath.cancel();
    cancelPrompts();
    stopSpeech();
    $("banner").classList.remove("show");
    const badge = $("state-badge");
    badge.textContent = "paused";
    badge.className = "badge paused";
    $("fps").textContent = "-";
  } else {
    engine.restart();
    bracing.reset();
    relaxLastT = null;
    plast = null;
    session.lastT = null;
    lastFrameT = null;
    fpsEma = 0;
    setup.reset();
  }
  $("pause").textContent = on ? "Resume" : "Pause";
  $("pause").setAttribute("aria-pressed", String(on));
}

$("pause").addEventListener("click", () => setPaused(!paused));
// WCAG 2.1.4: the single-key shortcut can be turned off.
const PAUSE_TITLE = "Pause tracking and all sounds";
function renderPauseShortcut() {
  $("pause-shortcut").checked = settings.pauseShortcut;
  $("pause").title = settings.pauseShortcut
    ? `${PAUSE_TITLE} (shortcut: P, can be turned off under Reminders & sounds)`
    : PAUSE_TITLE;
}
renderPauseShortcut();
$("pause-shortcut").addEventListener("change", (e) => {
  settings.pauseShortcut = e.target.checked;
  store.pauseShortcut = settings.pauseShortcut;
  save();
  renderPauseShortcut();
});
document.addEventListener("keydown", (e) => {
  if (isPauseShortcut(e, settings.pauseShortcut)) setPaused(!paused);
});

function step() {
  if (paused) return;
  const nowMs = performance.now();
  const now = nowMs / 1000;
  let landmarks = null;
  if (demo) {
    landmarks = demoPose(now);
  } else {
    if (!poseLandmarker || video.readyState < 2) return;
    // detectForVideo needs strictly increasing timestamps.
    const ts = Math.max(nowMs, lastVideoMs + 1);
    lastVideoMs = ts;
    let res;
    try {
      res = poseLandmarker.detectForVideo(video, ts);
    } catch (err) {
      stopCamera(err); // e.g. the GPU context was lost: stop instead of throwing every frame
      return;
    }
    const first = res.landmarks?.[0];
    // Some tasks-vision builds omit visibility; absent means "detected".
    landmarks = first ? first.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 })) : null;
  }
  const out = engine.process(landmarks, now);
  const slouching = out.transition.state === State.BAD_CHIME || out.transition.state === State.BAD_VOICE;
  if (slouching && !lastBad) episode += 1; // a new slouch episode
  lastBad = slouching;
  for (const nudge of out.nudges) fire(nudge, out.cue);
  account(out.transition.state, now);
  relaxStep(landmarks, out.transition.state, now);
  promptStep(out.transition.state, now);
  if (lastFrameT !== null) {
    const inst = 1 / Math.max(1e-3, now - lastFrameT);
    fpsEma = fpsEma ? 0.9 * fpsEma + 0.1 * inst : inst;
    $("fps").textContent = fpsEma.toFixed(0);
  }
  lastFrameT = now;
  if (!document.hidden) {
    // a throttled background tab has a low fps that says nothing about the setup
    const { result } = out;
    renderSetup(
      setup.update(
        {
          reason: result.kind === "unreliable" ? result.reason : null,
          state: out.transition.state,
          fps: fpsEma,
          metricsPresent: result.kind === "scored",
        },
        now,
      ),
    );
  }
  showReminderNote(policy.isCapped(now));
  if (!document.hidden) render(out, landmarks);
}

function visibleLoop() {
  if (!document.hidden && performance.now() - lastProcessed >= 1000 / VISIBLE_FPS - 2) {
    lastProcessed = performance.now();
    step();
  }
  requestAnimationFrame(visibleLoop);
}

// Background tabs pause requestAnimationFrame and throttle page timers; a
// worker's timer keeps ticking, so tracking (and reminders) continue at ~5 fps.
// The state machine is frame-rate independent, so the slower rate is fine.
function startHiddenTicker() {
  const src = `setInterval(() => postMessage(0), ${HIDDEN_TICK_MS});`;
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
  worker.onmessage = () => {
    if (document.hidden) step();
  };
}

// MediaPipe's web runtime uploads every camera frame through WebGL, even with
// the CPU delegate, so without WebGL it cannot run at all (it fails later, on
// the first frame, with "Cannot read properties of undefined (reading
// 'activeTexture')"). Probe first, on a throwaway canvas, and hand MediaPipe
// a fresh canvas of the kind that worked: OffscreenCanvas first (what it uses
// by default), then a regular canvas. null means no WebGL at all.
function webglCanvas() {
  const works = (canvas) => {
    try {
      return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      return false;
    }
  };
  if (typeof OffscreenCanvas !== "undefined" && works(new OffscreenCanvas(1, 1))) {
    return new OffscreenCanvas(1, 1);
  }
  if (works(document.createElement("canvas"))) return document.createElement("canvas");
  return null;
}

function showWebGLHelp(show) {
  $("webgl-help").classList.toggle("show", show);
}

const CAMERA_LABEL = $("start-camera").textContent;

/** Without WebGL the camera still works, through the slower MoveNet fallback; say so up front. */
function applyWebGLState() {
  const ok = Boolean(webglCanvas());
  $("start-camera").textContent = CAMERA_LABEL;
  showWebGLHelp(!ok);
  return ok;
}

/**
 * Pose detector for browsers without WebGL: MoveNet Lightning on the TF.js
 * WASM backend. The sync wrapper lives in movenet-adapter.js.
 */
let moveNetDetector = null; // TF.js detector, built once and reused across retries

async function loadMoveNet(onProgress = () => {}, onDownloaded = () => {}, gate = Promise.resolve()) {
  if (moveNetDetector) return createMoveNetDetector(moveNetDetector);
  // Warm the HTTP cache with byte-level progress; TF.js then reads from it.
  const files = [
    "movenet_bundle.mjs",
    "tfjs-backend-wasm-simd.wasm",
    "model.json",
    "group1-shard1of2.bin",
    "group1-shard2of2.bin",
  ];
  await downloadAll(
    files.map((f) => new URL(`${MOVENET_DIR}/${f}`, location.href).href),
    onProgress,
  );
  onDownloaded();
  await gate; // building the detector blocks the page; let the live video paint first
  const tfm = await import(`${MOVENET_DIR}/movenet_bundle.mjs`);
  tfm.setWasmPaths({
    "tfjs-backend-wasm.wasm": `${MOVENET_DIR}/tfjs-backend-wasm.wasm`,
    "tfjs-backend-wasm-simd.wasm": `${MOVENET_DIR}/tfjs-backend-wasm-simd.wasm`,
    "tfjs-backend-wasm-threaded-simd.wasm": `${MOVENET_DIR}/tfjs-backend-wasm-simd.wasm`,
  });
  if (!(await tfm.tf.setBackend("wasm"))) throw new Error("The WASM backend did not start");
  await tfm.tf.ready();
  const detector = await tfm.createDetector(tfm.SupportedModels.MoveNet, {
    modelType: tfm.movenet.modelType.SINGLEPOSE_LIGHTNING,
    modelUrl: `${MOVENET_DIR}/model.json`,
    enableSmoothing: true,
  });
  moveNetDetector = detector;
  return createMoveNetDetector(detector);
}

async function loadModel(canvas, onProgress = () => {}, onDownloaded = () => {}, gate = Promise.resolve()) {
  const { FilesetResolver, PoseLandmarker } = await import(`${TASKS_VISION}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${TASKS_VISION}/wasm`);
  // Download the model and the runtime with progress, then hand both over as
  // buffers so nothing is fetched twice. The bundle passes a pre-existing
  // self.Module to the Emscripten loader, which uses Module.wasmBinary
  // instead of fetching the .wasm file.
  const [model, wasm] = await downloadAll([MODEL_URL, new URL(fileset.wasmBinaryPath, location.href).href], onProgress);
  onDownloaded();
  await gate; // creating the model blocks the page; let the live video paint first
  const options = (delegate) => ({
    baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    canvas,
  });
  const create = async (delegate) => {
    self.Module = { wasmBinary: new Uint8Array(wasm) };
    try {
      return await PoseLandmarker.createFromOptions(fileset, options(delegate));
    } finally {
      self.Module = undefined; // the bundle clears it on success; make sure on failure too
    }
  };
  try {
    return await create("GPU");
  } catch {
    return await create("CPU");
  }
}

let lowAccuracy = false; // tracking runs on the MoveNet fallback

/** Run one detection before showing the dashboard: the first call compiles
 *  the model for the GPU (or CPU) and can block for seconds. Doing it here,
 *  under "Start the model", means the page never sits frozen on a blank
 *  dashboard. Throws if the detector fails on a real frame. */
async function warmUp(detector, isMoveNet) {
  await nextPaint();
  if (video.readyState < 2) return;
  if (isMoveNet) {
    if (moveNetDetector) await moveNetDetector.estimatePoses(video, { flipHorizontal: false });
    return;
  }
  const ts = Math.max(performance.now(), lastVideoMs + 1);
  lastVideoMs = ts;
  detector.detectForVideo(video, ts);
}

const loadSteps = new LoadSteps();

function showError(message) {
  $("start-error").textContent = message;
  if (message) logProblem(message);
}

// -- bug reports ----------------------------------------------------------------
// "Report a bug" opens GitHub's new-issue form pre-filled with what a
// maintainer needs: browser, WebGL, app state, settings and recent errors.
// No login or backend; the user reviews and submits it on GitHub. Never
// includes video, images, landmarks or stored sounds.

const ISSUE_URL = "https://github.com/arii/posture-guard/issues/new";
// Issue title from a "HH:MM:SS message" entry: drop the time, cut at a word boundary.
function bugTitle(entry, max = 71) {
  const msg = entry.slice(9);
  if (msg.length <= max) return msg;
  const cut = msg.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trimEnd()}...`;
}

const problems = []; // last few errors, newest last

function logProblem(message) {
  problems.push(`${new Date().toISOString().slice(11, 19)} ${sanitizeError(message)}`);
  if (problems.length > 8) problems.shift();
}
window.addEventListener("error", (e) => logProblem(e.message || e.error || "error"));
window.addEventListener("unhandledrejection", (e) => logProblem(`unhandled: ${e.reason?.message || e.reason}`));

function webglInfo() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return typeof OffscreenCanvas !== "undefined" && webglCanvas() ? "offscreen only" : "unavailable";
    return webglSummary(gl); // no GPU renderer string: it adds to a browser fingerprint
  } catch (err) {
    return `probe failed: ${sanitizeError(err.message || err)}`;
  }
}

function bugReportUrl() {
  const cal = engine.calibration.status;
  const v = chosenVoice();
  const diag = [
    `- Page: ${location.origin}${location.pathname}`,
    `- Browser: ${navigator.userAgent}`,
    `- Language: ${navigator.language} | Screen: ${screen.width}x${screen.height} @${devicePixelRatio}x`,
    `- WebGL: ${webglInfo()}`,
    `- Source: ${$("source").textContent} | State: ${$("state-badge").textContent} | fps: ${$("fps").textContent} | paused: ${paused}`,
    `- Mode: ${settings.mode} | specific cues: ${settings.specificCues} | spoken praise: ${settings.spokenPraise}`,
    `- Voice: ${selectedVoice() || "none"}${v ? ` | system fallback ${v.name} (${v.lang})` : ""} | ${voices.length} system voices | clips ${clipManifest ? "loaded" : "missing"}`,
    `- Calibration: good ${cal.good ? "recorded" : "no"}, slouch ${cal.bad ? "recorded" : "no"}, needle ${cal.calibrated ? "calibrated" : "default"}`,
    `- Custom sounds: bad ${custom.bad ? "yes" : "no"}, good ${custom.good ? "yes" : "no"}`,
    `- Reminders this session: ${reminderCount}`,
    `- Load marks (ms): ${JSON.stringify(loadMarks)}`,
  ].join("\n");
  const body = buildBugReportBody({ diag, problems });
  const title = problems.length ? `Bug: ${bugTitle(problems[problems.length - 1])}` : "Bug: ";
  const params = new URLSearchParams({ title, body: body.slice(0, 6000), labels: "bug" });
  return `${ISSUE_URL}?${params}`;
}

// Fill the link at click time so it carries the current state.
for (const link of [$("report-bug"), ...document.querySelectorAll(".report-bug-link")]) {
  link.title = BUG_LINK_TIP;
  link.addEventListener("click", () => {
    link.href = bugReportUrl();
  });
}

/** Tracking failed after it started: release the camera, bring the start
 *  screen back with the reason, and leave the demo available. */
function stopCamera(err) {
  setPaused(false);
  if (practice) stopPractice();
  setup.reset();
  $("pause").disabled = true;
  setTrackingControls(false);
  poseLandmarker = null;
  const stream = video.srcObject;
  if (stream) for (const t of stream.getTracks()) t.stop();
  video.srcObject = null;
  lowAccuracy = false;
  $("lowpower-note").style.display = "none";
  showWebGLHelp(!webglCanvas());
  showError(`Tracking stopped: ${err.message || err}. Reload to try again, or try the demo.`);
  $("start-status").textContent = "";
  loadSteps.finish();
  $("start-overlay").classList.remove("compact");
  $("start-overlay").style.display = "";
  $("start-camera").disabled = $("start-demo").disabled = false;
  applyWebGLState();
}

let loopsStarted = false;

function begin(source) {
  $("source").textContent = source;
  $("start-overlay").style.display = "none";
  showWebGLHelp(false);
  $("lowpower-note").style.display = lowAccuracy ? "block" : "none";
  restoreSound("bad");
  restoreSound("good");
  $("pause").disabled = false;
  $("test-start").disabled = false;
  setTrackingControls(true);
  $("state-badge").focus(); // the Start button is gone: move focus to the status badge
  maybeStartFirstRun();
  if (loopsStarted) return; // a retry after stopCamera reuses the running loops
  loopsStarted = true;
  recordSession(store, Date.now());
  save();
  resetPromptSession();
  requestAnimationFrame(visibleLoop);
  startHiddenTicker();
}

/** The model load started by the last click, kept so a retry after a camera
 *  problem does not download it again. Dropped if it failed. */
let preloaded = null;

function preloadModel(canvas, gate) {
  if (preloaded && !preloaded.failed) return preloaded;
  const entry = { kind: canvas ? "mediapipe" : "movenet", downloaded: false, failed: false, promise: null };
  const onDownloaded = () => {
    entry.downloaded = true;
    markLoad("downloadDone");
    loadSteps.done("download");
  };
  const progress = (got, total) => loadSteps.progress(got, total);
  entry.promise = canvas ? loadModel(canvas, progress, onDownloaded, gate) : loadMoveNet(progress, onDownloaded, gate);
  entry.promise.catch(() => {
    entry.failed = true; // handled where it is awaited; this only stops an unhandled rejection
  });
  preloaded = entry;
  return entry;
}

/** Frames are playing: show the video and shrink the card to a strip under it. */
function showLivePreview() {
  $("start-overlay").classList.add("compact");
  $("start-status").textContent = "Camera is on. Loading the pose model, no video leaves your computer.";
}

$("start-camera").addEventListener("click", async () => {
  ensureAudio(); // inside the click: browsers only allow audio after a gesture
  for (const k of Object.keys(loadMarks)) delete loadMarks[k];
  loadMarks.click = Math.round(performance.now());
  engine.setDriftBaselineEnabled(true); // back from the demo: real tracking adapts again
  $("start-camera").disabled = $("start-demo").disabled = true;
  showError("");
  showWebGLHelp(false);
  $("start-status").textContent = "";
  $("start-overlay").classList.remove("compact");
  loadSteps.open();
  // The model waits for this before its first long, blocking step (see loadModel).
  // It opens once the live video has painted, or when the start fails.
  let openGate = () => {};
  const gate = new Promise((r) => {
    openGate = r;
  });
  try {
    // MediaPipe needs WebGL; without it (or if it fails to start) use the MoveNet fallback.
    const canvas = webglCanvas();
    lowAccuracy = false;
    // Start the download first and let it run while the browser asks for the camera.
    // getUserMedia is still only called here, after the click.
    loadSteps.start("camera");
    const entry = preloadModel(canvas, gate);
    if (!canvas) loadSteps.label("download", "WebGL is off: downloading the simpler pose model");
    if (entry.downloaded) loadSteps.done("download");
    else loadSteps.start("download");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    markLoad("streamPlaying");
    loadSteps.done("camera");
    showLivePreview();
    await nextPaint();
    openGate();
    if (canvas) {
      try {
        poseLandmarker = await entry.promise;
        loadSteps.start("start", { elapsed: true });
        await warmUp(poseLandmarker, false);
      } catch (err) {
        poseLandmarker = null;
        logProblem(`MediaPipe did not start, using the fallback: ${err.message || err}`);
      }
    }
    if (!poseLandmarker) {
      let detector;
      if (canvas) {
        loadSteps.label("download", "The main model didn't start: downloading the simpler one");
        loadSteps.start("download");
        preloaded = null; // the failed MediaPipe entry must not be reused
        detector = await preloadModel(null).promise;
      } else {
        detector = await entry.promise;
      }
      loadSteps.start("start", { elapsed: true });
      poseLandmarker = detector;
      await warmUp(detector, true);
      lowAccuracy = true;
    }
    markLoad("warmUpDone");
    loadSteps.done("start");
    loadSteps.finish();
    $("start-overlay").classList.remove("compact");
    begin("webcam");
  } catch (err) {
    openGate();
    loadSteps.fail();
    $("start-overlay").classList.remove("compact");
    $("start-status").textContent = "";
    const stream = video.srcObject;
    if (stream) for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
    poseLandmarker = null;
    showError(cameraErrorMessage(err));
    $("start-camera").disabled = $("start-demo").disabled = false;
    applyWebGLState();
    $("start-camera").textContent = "Try again"; // a retry reuses the model that is already loading
  }
});

// Probe as soon as the page loads, before any click.
applyWebGLState();

$("start-demo").addEventListener("click", () => {
  ensureAudio();
  loadSteps.finish();
  demo = true;
  engine.setDriftBaselineEnabled(false); // synthetic poses: no desk baseline to adapt (#67)
  video.style.display = "none";
  $("demo-note").style.display = "block";
  begin("demo");
});

// -- first-run guide ------------------------------------------------------------
// Shown once, on the first Start (store.firstRunDone): check framing, record
// good and slouch posture, then hear what the sounds mean. "Show the intro
// again" in the Not working? panel brings it back.

const FIRST_RUN = [
  {
    key: "framing",
    title: "Check your framing",
    intro: "Camera at eye level, about an arm's length away, head and shoulders in frame, light in front of you.",
  },
  {
    key: "calibrate",
    title: "Calibrate to your posture",
    intro: "Sit well and record 3 s, then slouch your usual way and record 3 s. Skip it to use the defaults.",
  },
  { key: "coach", title: "Choose your coach", intro: COACH_INTRO },
  { key: "done", title: "You're set", intro: DONE_INTRO },
];
const firstRun = { step: 0, open: false };
let firstRunLive = null; // the element updated every frame on the current step

function firstRunButton(label, onClick, secondary = true) {
  const b = document.createElement("button");
  b.textContent = label;
  if (secondary) b.className = "secondary";
  b.addEventListener("click", onClick);
  return b;
}

/** The "Choose your coach" controls. Each one drives the real setting (same
 *  element, same change handler), so nothing is stored twice. */
function coachControls() {
  const row = (text, control) => {
    const l = document.createElement("label");
    l.className = "note";
    l.style.display = "block";
    l.append(control, ` ${text}`);
    return l;
  };
  const select = (src, extra = []) => {
    const el = document.createElement("select");
    for (const o of [...src.options, ...extra]) el.add(new Option(o.text, o.value));
    return el;
  };
  const check = (src) => {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.checked = src.checked;
    el.addEventListener("change", () => {
      src.checked = el.checked;
      src.dispatchEvent(new Event("change"));
      $("consent-dialog").addEventListener(
        "close",
        () => {
          el.checked = src.checked;
        },
        { once: true },
      );
    });
    return el;
  };
  const voice = select($("voice-pick"), [new Option("Off (chime only, no voice)", "__off")]);
  voice.id = "coach-voice";
  voice.setAttribute("aria-label", "Voice");
  voice.value = settings.mode === "chime_and_voice" ? $("voice-pick").value : "__off";
  voice.addEventListener("change", () => {
    const radio = document.querySelector(
      `input[name=mode][value=${voice.value === "__off" ? "chime_only" : "chime_and_voice"}]`,
    );
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
    if (voice.value !== "__off") {
      $("voice-pick").value = voice.value;
      $("voice-pick").dispatchEvent(new Event("change"));
    }
  });
  const level = select($("coaching-level"));
  level.id = "coach-level";
  level.setAttribute("aria-label", "Reminder style");
  level.value = $("coaching-level").value;
  level.addEventListener("change", () => {
    $("coaching-level").value = level.value;
    $("coaching-level").dispatchEvent(new Event("change"));
  });
  const eye = check($("eye-breaks"));
  eye.id = "coach-eye";
  const move = select($("move-minutes"));
  move.id = "coach-move";
  move.setAttribute("aria-label", "Stand up and move");
  move.value = $("move-minutes").value;
  move.addEventListener("change", () => {
    $("move-minutes").value = move.value;
    $("move-minutes").dispatchEvent(new Event("change"));
  });
  const moments = check($("breathing-moments"));
  moments.id = "coach-moments";
  const samples = document.createElement("div");
  samples.className = "btn-row";
  samples.append(
    firstRunButton("Play the reminder", () => {
      ensureAudio();
      playBad();
    }),
    firstRunButton("Play the praise chime", () => {
      ensureAudio();
      playGood();
    }),
    firstRunButton("Play a voice sample", () => {
      ensureAudio();
      speak(TEST_LINE);
    }),
  );
  return [
    row("Voice", voice),
    row("Reminder style", level),
    row("Eye break every 20 minutes", eye),
    row("Stand up and move", move),
    row("Occasional breathing moments (asks for your OK first)", moments),
    samples,
  ];
}

function renderFirstRun() {
  const step = FIRST_RUN[firstRun.step];
  $("first-run-count").textContent = `Step ${firstRun.step + 1} of ${FIRST_RUN.length}`;
  $("first-run-heading").textContent = step.title;
  const body = $("first-run-body");
  const intro = document.createElement("div");
  intro.className = "note";
  intro.style.marginTop = "0";
  intro.textContent = step.intro;
  const parts = [intro];
  firstRunLive = null;
  if (step.key === "framing") {
    firstRunLive = document.createElement("div");
    firstRunLive.className = "framing";
    firstRunLive.setAttribute("aria-live", "polite");
    parts.push(firstRunLive);
  } else if (step.key === "calibrate") {
    firstRunLive = document.createElement("div");
    firstRunLive.className = "note";
    firstRunLive.setAttribute("aria-live", "polite");
    const row = document.createElement("div");
    row.className = "btn-row";
    row.append(
      firstRunButton("Record good posture", () => engine.calibration.start("good"), false),
      firstRunButton("Record slouch posture", () => engine.calibration.start("bad"), false),
    );
    parts.push(row, firstRunLive);
  } else if (step.key === "coach") {
    parts.push(...coachControls());
  } else {
    const row = document.createElement("div");
    row.className = "btn-row";
    row.append(
      firstRunButton("Share BackUp", () => openShare(), false),
      firstRunButton("Start a silent test", () => {
        closeFirstRun();
        $("test-start").scrollIntoView({ block: "center" });
        $("test-start").focus();
      }),
    );
    parts.push(row);
  }
  body.replaceChildren(...parts);
  $("first-run-back").hidden = firstRun.step === 0;
  $("first-run-next").textContent = firstRun.step === FIRST_RUN.length - 1 ? "Done" : "Next";
  $("first-run-skip").hidden = firstRun.step === FIRST_RUN.length - 1;
}

function openFirstRun(step = 0) {
  firstRun.open = true;
  firstRun.step = step;
  $("first-run").hidden = false;
  renderFirstRun();
}

function closeFirstRun() {
  firstRun.open = false;
  firstRunLive = null;
  $("first-run").hidden = true;
  if (!store.firstRunDone) {
    store.firstRunDone = true;
    save();
  }
}

function maybeStartFirstRun() {
  if (!store.firstRunDone && !firstRun.open) openFirstRun();
}

/** Per-frame text for the guide: live framing on step 1, calibration status on step 2. */
function updateFirstRunLive(result, landmarks) {
  if (!firstRun.open || !firstRunLive) return;
  if (FIRST_RUN[firstRun.step].key === "framing") {
    const ok = result.kind === "scored";
    firstRunLive.className = ok ? "framing ok" : "framing";
    firstRunLive.textContent = ok
      ? "Head and shoulders in view \u2713"
      : causeFor(result, landmarks) || "Looking for you...";
  } else if (FIRST_RUN[firstRun.step].key === "calibrate") {
    firstRunLive.textContent = $("calib-status").textContent;
  }
}

$("first-run-next").addEventListener("click", () => {
  if (firstRun.step >= FIRST_RUN.length - 1) {
    closeFirstRun();
    $("state-badge").focus();
    return;
  }
  firstRun.step += 1;
  renderFirstRun();
  $("first-run-heading").tabIndex = -1;
  $("first-run-heading").focus();
});
$("first-run-back").addEventListener("click", () => {
  firstRun.step = Math.max(0, firstRun.step - 1);
  renderFirstRun();
  $("first-run-heading").tabIndex = -1;
  $("first-run-heading").focus();
});
$("first-run-skip").addEventListener("click", () => {
  closeFirstRun();
  $("state-badge").focus();
});
$("intro-again").addEventListener("click", () => {
  if (!loopsStarted) {
    $("practice-msg").textContent = "Start the webcam or the demo first, then the intro can show your live framing.";
    return;
  }
  openFirstRun();
  $("first-run").scrollIntoView({ block: "nearest" });
  $("first-run-heading").tabIndex = -1;
  $("first-run-heading").focus();
});

// -- onboarding, safety notice and help -----------------------------------------
// First run: a three-step card in the start overlay (how it works, what you will
// see and hear, safety notice). The Start buttons stay hidden until the notice is
// acknowledged (store.ackVersion). Help replays it any time. Text lives in
// onboarding.js; see .kiro/specs/onboarding-and-setup.

const LAST_STEP = ONBOARDING_STEPS.length - 1;
const ob = { step: needsAckOnly(store) ? LAST_STEP : 0, ackOnly: needsAckOnly(store) };

function fillList(ul, points) {
  ul.replaceChildren(
    ...points.map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }),
  );
}

function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[ob.step];
  const last = ob.step === LAST_STEP;
  $("ob-count").textContent = ob.ackOnly ? "Safety notice" : `Step ${ob.step + 1} of ${ONBOARDING_STEPS.length}`;
  $("ob-title").textContent = step.title;
  fillList($("ob-body"), step.points);
  $("ob-back").hidden = ob.step === 0 || ob.ackOnly;
  $("ob-next").hidden = last;
  $("ob-ack").hidden = !last;
}

function showStartControls() {
  const need = shouldShowOnboarding(store);
  $("onboarding").hidden = !need;
  $("start-intro").hidden = need;
  $("start-title").hidden = $("start-tagline").hidden = need; // make room for the card
  $("start-actions").hidden = need;
  if (need) renderOnboardingStep();
}

$("ob-next").addEventListener("click", () => {
  ob.step = Math.min(LAST_STEP, ob.step + 1);
  renderOnboardingStep();
  $("ob-title").focus();
});
$("ob-back").addEventListener("click", () => {
  ob.step = Math.max(0, ob.step - 1);
  renderOnboardingStep();
  $("ob-title").focus();
});
$("ob-ack").addEventListener("click", () => {
  markOnboarded(store);
  save();
  showStartControls();
  ($("start-camera").disabled ? $("start-demo") : $("start-camera")).focus();
});
showStartControls();

function openHelp() {
  const body = $("help-body");
  body.replaceChildren();
  for (const step of ONBOARDING_STEPS) {
    const h = document.createElement("h3");
    h.textContent = step.title;
    const ul = document.createElement("ul");
    fillList(ul, step.points);
    body.append(h, ul);
  }
  $("help-msg").textContent = "";
  $("help-dialog").showModal();
}
$("help-btn").addEventListener("click", openHelp);
$("help-close").addEventListener("click", () => $("help-dialog").close());
$("help-notworking").addEventListener("click", () => {
  $("help-dialog").close();
  $("setup-panel").open = true;
  $("setup-panel").scrollIntoView({ block: "nearest" });
  $("setup-panel").querySelector("summary").focus();
});
$("help-practice").addEventListener("click", () => {
  const msg = startPractice();
  $("help-msg").textContent = msg;
  if (!msg) {
    $("help-dialog").close();
    $("practice-next").focus();
  }
});

fillList($("safety-list"), SAFETY_POINTS);
$("safety-footer").textContent = SAFETY_SHORT;
$("relax-safety").textContent = RELAX_SAFETY;
$("safety-link").addEventListener("click", (e) => {
  e.preventDefault();
  $("safety-dialog").showModal();
});
$("safety-close").addEventListener("click", () => $("safety-dialog").close());

// -- setup check ("Not working?") ----------------------------------------------------

const setup = new SetupCheck();
let setupShown = null;

function renderSetup({ diagnosis, fixes }) {
  if (diagnosis === setupShown) return;
  setupShown = diagnosis;
  const status = $("setup-status");
  status.textContent = DIAGNOSIS_TEXT[diagnosis];
  status.className = diagnosis === Diagnosis.OK ? "ok" : diagnosis === Diagnosis.CHECKING ? "" : "fault";
  fillList($("setup-fixes"), fixes);
  if (fixes.length) $("setup-panel").open = true;
}

// -- learn the cues (practice) ---------------------------------------------------------
// Steps through each cue and lights the matching tile. Silent like the retention
// test: no sounds, no reminders, and nothing is added to the daily totals.

let practice = null; // { i } while practising
let practiceLive = "";

function renderPracticeStep() {
  const step = PRACTICE_STEPS[practice.i];
  $("practice-count").textContent = `Step ${practice.i + 1} of ${PRACTICE_STEPS.length}`;
  $("practice-text").textContent = step.text;
  $("practice-next").textContent = practice.i === PRACTICE_STEPS.length - 1 ? "Finish" : "Next";
  practiceLive = "";
}

function startPractice() {
  if (!loopsStarted) return "Start the webcam or the demo first, then you can practise the cues.";
  if (paused) return "Resume tracking first.";
  if (test) return "Stop the silent test first.";
  if (practice) return "";
  $("practice-breath").hidden = true;
  breath.cancel();
  stopSpeech();
  $("banner").classList.remove("show");
  cancelPrompts();
  practice = { i: 0 };
  document.body.classList.add("practicing");
  renderPracticeStep();
  return "";
}

function stopPractice() {
  practice = null;
  document.body.classList.remove("practicing");
  for (const metric of ["head_forward", "head_tilt", "shoulder_level", "trunk_lean"])
    $(`t-${metric}`).classList.remove("focus");
  engine.restart(); // practice postures must not carry into a reminder
  bracing.reset();
  relaxLastT = null;
  session.lastT = null;
  setup.reset();
}

function renderPractice(result) {
  const step = PRACTICE_STEPS[practice.i];
  const cfg = DEFAULTS.scoring;
  let live;
  if (!step.metric) {
    live = "Hold this for a moment. The tiles show your angles.";
  } else {
    const v =
      result.kind === "scored" && (step.metric !== "trunk_lean" || result.trunk_lean_available)
        ? result[`${step.metric}_deg`]
        : null;
    live =
      v !== null && Math.abs(v) > cfg[`${step.metric}_deg`]
        ? "That is what this cue looks like. Sit tall again, then press Next."
        : "Try it. The highlighted tile lights up when it is past your threshold.";
  }
  if (live !== practiceLive) {
    practiceLive = live;
    $("practice-live").textContent = live;
  }
  $("fix-title").textContent = "Practice";
  $("fix-how").textContent = "";
  $("fix-box").className = "fix active";
  $("hold-bar").className = "hold idle";
  for (const metric of ["head_forward", "head_tilt", "shoulder_level", "trunk_lean"]) {
    $(`t-${metric}`).classList.toggle("focus", metric === step.metric);
  }
}

$("practice-start").addEventListener("click", () => {
  const msg = startPractice();
  $("practice-msg").textContent = msg;
  if (!msg) $("practice-next").focus();
});
$("practice-next").addEventListener("click", () => {
  if (!practice) return;
  if (practice.i >= PRACTICE_STEPS.length - 1) {
    stopPractice();
    $("practice-msg").textContent = "Practice finished. Want to try a breath check next?";
    $("practice-breath").hidden = false;
    return;
  }
  practice.i += 1;
  renderPracticeStep();
});
$("practice-stop").addEventListener("click", () => {
  stopPractice();
  $("practice-msg").textContent = "Practice stopped.";
});
$("practice-breath").addEventListener("click", () => {
  $("practice-breath").hidden = true;
  $("practice-msg").textContent = "";
  startBreathCheck();
});

// -- your progress -----------------------------------------------------------------------
// A personal review of coached time per day and the silent-test trend. Aggregation
// is in progress.js. No streaks, no ranking; see .kiro/specs/progress-review.

let lastProgressRender = 0;
const minutesText = (s) =>
  s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`;

function renderProgress() {
  lastProgressRender = Date.now();
  const s = summarize(store, Date.now());
  $("progress-empty").textContent = s.empty
    ? "Nothing tracked yet. Your progress will appear after your first session."
    : "";
  const days = $("progress-days");
  days.hidden = s.empty;
  days.replaceChildren(
    ...s.days.map((d) => {
      const row = document.createElement("div");
      row.className = "day-row";
      row.setAttribute("role", "listitem");
      const label = document.createElement("span");
      label.textContent = new Date(`${d.date}T00:00:00Z`).toLocaleDateString(undefined, {
        weekday: "short",
        timeZone: "UTC",
      });
      const bar = document.createElement("div");
      bar.className = "score-bar";
      const fill = document.createElement("div");
      fill.style.width = `${d.pct ?? 0}%`;
      bar.append(fill);
      const text = document.createElement("span");
      text.textContent = d.pct === null ? "no data" : `${d.pct}% \u00b7 ${minutesText(d.good_s)} good`;
      if (d.pct === null) text.className = "nodata";
      row.setAttribute("aria-label", `${d.date}: ${text.textContent}`);
      row.append(label, bar, text);
      return row;
    }),
  );
  $("progress-total").textContent = s.empty
    ? ""
    : `Total good posture time so far: ${minutesText(s.cumulative_good_s)}.`;
  const parts = [];
  if (s.tests.length)
    parts.push(`Silent tests, oldest to newest: ${s.tests.map((t) => `${t.pct}%`).join(" \u2192 ")}.`);
  else if (!s.empty) parts.push("No silent tests yet. Take one for a baseline.");
  if (s.coached_pct_7d !== null) parts.push(`With coaching over the last 7 days: ${s.coached_pct_7d}%.`);
  $("progress-tests").textContent = parts.join(" ");
  const suggest = s.try_light && settings.coachingLevel !== "light";
  $("progress-suggest").textContent = suggest
    ? "Your latest silent score is at least as good as your coached score. You could try light coaching."
    : "";
  $("progress-light").hidden = !suggest;
}

$("progress-light").addEventListener("click", () => {
  $("coaching-level").value = "light";
  $("coaching-level").dispatchEvent(new Event("change"));
  renderProgress();
  $("progress-msg").textContent = "Switched to light coaching. Change it back under Reminders & sounds.";
});

$("progress-export").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([exportJson(store)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "posture-guard-progress.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("progress-msg").textContent = "Exported your daily totals and silent tests.";
});

$("progress-delete").addEventListener("click", () => {
  if (
    !window.confirm(
      "Delete all BackUp data stored in this browser (settings, calibration, daily totals, tests, uploaded sounds and the offline copy)? This cannot be undone.",
    )
  )
    return;
  deleted = true; // stop any pending save from writing it back
  clearStoredData(localStorage);
  removeOfflineCopy().finally(() => location.reload());
});

// ---- Offline mode (opt-in; sw.js caches the files listed in precache.json) ----
const offlineSupported = "serviceWorker" in navigator && "caches" in window;
const offline = {
  downloading: false,
  error: false,
  percent: 0,
  totalBytes: 0,
  ready: false,
  registered: false,
  stale: false,
};

function renderOffline() {
  const state = offlineState({ supported: offlineSupported, ...offline });
  $("offline-status").textContent = offlineMessage(state, offline);
  $("offline-enable").hidden = !offlineSupported || state === "ready" || state === "downloading";
  $("offline-enable").textContent =
    state === "update-available" ? "Update offline copy" : state === "error" ? "Try again" : "Make available offline";
  $("offline-remove").hidden = !offlineSupported || !(offline.registered || offline.ready);
  $("offline-bar").hidden = state !== "downloading";
  $("offline-fill").style.width = `${offline.percent}%`;
}

async function removeOfflineCopy() {
  if (!offlineSupported) return;
  try {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    for (const k of await caches.keys()) if (k.startsWith("posture-guard-")) await caches.delete(k);
  } catch {
    /* nothing more to remove */
  }
}

async function refreshOffline() {
  if (!offlineSupported) return renderOffline();
  try {
    offline.registered = !!(await navigator.serviceWorker.getRegistration());
    // precache.json always comes from the network; skip it when offline.
    let pre = null;
    if (navigator.onLine) pre = await (await fetch("./precache.json", { cache: "no-cache" })).json();
    // Prefer the cache for the current release, else any complete older one (then stale).
    let cache = null,
      meta = null;
    const names = (await caches.keys()).filter((k) => k.startsWith(CACHE_PREFIX)); // caches.open would create an empty one
    if (pre) names.sort((a, b) => (b === cacheNameFor(pre.version)) - (a === cacheNameFor(pre.version)));
    for (const k of names) {
      const c = await caches.open(k);
      const res = await c.match(META_URL);
      const m = res ? await res.json().catch(() => null) : null;
      if (m) {
        cache = c;
        meta = m;
        break;
      }
    }
    if (!pre && meta)
      pre = {
        version: meta.version,
        totalBytes: offline.totalBytes,
        files: Object.keys(meta.hashes).map((url) => ({ url })),
      };
    if (!pre) throw new Error("offline and nothing cached");
    offline.totalBytes = pre.totalBytes;
    const base = new URL("./", location.href).href;
    const cached = cache
      ? (await cache.keys()).map((r) => (r.url.startsWith(base) ? r.url.slice(base.length) : r.url))
      : [];
    offline.ready = isOfflineReady(pre, cached, meta?.version);
    offline.stale = offline.registered && !offline.ready;
  } catch {
    // Offline and not cached, or precache.json unreadable: keep whatever we knew.
  }
  renderOffline();
}

if (offlineSupported) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "offline-progress") {
      offline.downloading = true;
      offline.error = false;
      offline.totalBytes = m.totalBytes || offline.totalBytes;
      offline.percent = m.percent;
      renderOffline();
    } else if (m.type === "offline-ready") {
      offline.downloading = false;
      offline.percent = 100;
      refreshOffline();
    } else if (m.type === "offline-error") {
      offline.downloading = false;
      offline.error = true;
      renderOffline();
    }
  });
}

$("offline-enable").addEventListener("click", async () => {
  offline.downloading = true;
  offline.error = false;
  offline.percent = progressPercent(0, 1);
  renderOffline();
  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    await reg.update(); // picks up a newer sw.js; no-op when already current
    const sw = reg.installing || reg.waiting;
    if (sw) {
      await new Promise((resolve, reject) => {
        const check = () => {
          if (sw.state === "activated") resolve();
          else if (sw.state === "redundant") reject(new Error("install failed"));
          else return false;
          return true;
        };
        if (!check()) sw.addEventListener("statechange", check); // it may already be done
      });
    }
    offline.downloading = false;
  } catch {
    offline.downloading = false;
    offline.error = true;
  }
  await refreshOffline();
});

$("offline-remove").addEventListener("click", async () => {
  await removeOfflineCopy();
  offline.ready = false;
  offline.registered = false;
  offline.stale = false;
  offline.error = false;
  offline.downloading = false;
  await refreshOffline();
  $("offline-status").textContent = "Offline copy removed. The app needs a network connection again.";
});

renderOffline();
refreshOffline();

renderCalibration();
renderStats();
renderTest();
renderProgress();
window.addEventListener("pagehide", save);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) save();
});
