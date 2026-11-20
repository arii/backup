// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// Browser shell for Posture Guard: webcam + MediaPipe Pose Landmarker in the
// page, posture-core.js for scoring/state/needle/calibration, Web Audio for
// chimes, speechSynthesis for the spoken prompt, localStorage for settings,
// calibration and daily totals. No frame or landmark leaves the browser.

import {
  DEFAULTS, LEFT_EAR, Nudge, PostureEngine, Reason, State, TRACKED,
} from "./posture-core.js";

const TASKS_VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
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
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
const store = loadStore();
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(store)); } catch { /* quota: keep in memory */ }
}
const todayKey = () => new Date().toISOString().slice(0, 10);

// -- settings -----------------------------------------------------------------

const settings = {
  mode: store.mode || "chime_and_voice",
  voiceText: store.voiceText || "Please fix your posture",
  specificCues: store.specificCues !== false, // default on
  spokenPraise: store.spokenPraise !== false, // default on
  voiceDelay: DEFAULTS.state.voice_delay_s,
  voiceRepeat: DEFAULTS.state.voice_repeat_cooldown_s,
};
document.querySelectorAll("input[name=mode]").forEach((el) => {
  el.checked = el.value === settings.mode;
  el.addEventListener("change", () => { settings.mode = el.value; store.mode = el.value; save(); });
});
$("specific-cues").checked = settings.specificCues;
$("specific-cues").addEventListener("change", (e) => {
  settings.specificCues = e.target.checked;
  store.specificCues = settings.specificCues; save();
});
$("spoken-praise").checked = settings.spokenPraise;
$("spoken-praise").addEventListener("change", (e) => {
  settings.spokenPraise = e.target.checked;
  store.spokenPraise = settings.spokenPraise; save();
});
$("voice-text").value = settings.voiceText;
$("voice-text").addEventListener("change", (e) => {
  settings.voiceText = e.target.value.trim() || "Please fix your posture";
  store.voiceText = settings.voiceText; save();
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
    const imag = new Float32Array(n); // sine terms, as in audio.py
    for (const [k, amp] of harmonics) imag[k] = amp;
    wave = ac.createPeriodicWave(real, imag); // peak-normalized, like audio.py
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
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur); // ~exp(-3t) decay like audio.py
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

// Same tones as audio.py: a falling "uh-oh" reminder (E5 -> B-flat 4, a tritone
// down, reedy odd harmonics) and a rising C-major arpeggio reward.
const BAD_HARMONICS = [[1, 1.0], [3, 0.35], [5, 0.15]];
const playBad = () => (custom.bad ? playBuffer(custom.bad) : tones([659.25, 466.16], [0.18, 0.42], BAD_HARMONICS));
const playGood = () => (custom.good ? playBuffer(custom.good) : tones([523.25, 659.25, 783.99, 1046.5], [0.2, 0.2, 0.2, 0.2]));

// -- voice --------------------------------------------------------------------
// The browser's default voice is often the OS fallback (eSpeak on Linux),
// which sounds robotic. Rank the installed voices and use the most natural one
// in the page's language: neural/"Natural"/"Online" voices (Edge, Windows),
// Google's network voices (Chrome), Apple's enhanced voices (Safari/macOS).

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

let voices = [];
function refreshVoices() {
  if (!("speechSynthesis" in window)) return;
  const lang = navigator.language || "en-US";
  voices = window.speechSynthesis.getVoices()
    .slice().sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang));
  const pick = $("voice-pick");
  const keep = store.voiceName || "";
  pick.replaceChildren(new Option("Best available", ""));
  for (const v of voices) pick.add(new Option(`${v.name} (${v.lang})`, v.name));
  pick.value = voices.some((v) => v.name === keep) ? keep : "";
  const best = voices[0];
  $("voice-note").textContent = !voices.length ? ""
    : best && voiceScore(best, lang) <= 0
      ? "Only basic system voices are installed, so speech may sound robotic. Chrome and Edge include natural-sounding voices; on Linux, Chrome's \"Google\" voices sound far better than eSpeak."
      : `Using ${(chosenVoice() || best).name}.`;
}
function chosenVoice() {
  return voices.find((v) => v.name === store.voiceName) || voices[0] || null;
}
if ("speechSynthesis" in window) {
  refreshVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
}
$("voice-pick").addEventListener("change", (e) => {
  if (e.target.value) store.voiceName = e.target.value; else delete store.voiceName;
  save(); refreshVoices();
});

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = chosenVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = 1.0;
  u.pitch = 1.0;
  window.speechSynthesis.speak(u);
}

// Rotating praise: varied wording keeps it from fading into background noise
// (repeating one identical phrase habituates fastest).
const PRAISE = [
  "Looking good.",
  "Nice posture.",
  "You're looking good.",
  "Great, keep it up.",
  "Posture to die for.",
  "Tall and relaxed. Nice.",
  "Spine of a champion.",
];
let praiseIndex = 0;
const nextPraise = () => PRAISE[praiseIndex++ % PRAISE.length];
const RECOVERY_PRAISE = ["That's better.", "There you go.", "Much better."];
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
    const bytes = await (await fetch(dataUrl)).arrayBuffer();
    custom[kind] = await ensureAudio().decodeAudioData(bytes);
  } catch { delete store[`${kind}Sound`]; save(); }
}

for (const kind of ["bad", "good"]) {
  $(`${kind}-file`).addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      custom[kind] = await decodeFile(file);
      if (file.size < 1_500_000) { // small enough to keep across reloads
        store[`${kind}Sound`] = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        save();
      }
    } catch (err) { showError(`could not decode ${file.name}: ${err.message || err}`); }
  });
}
$("test-bad").addEventListener("click", () => playBad());
$("test-voice").addEventListener("click", () => speak("Looking good. Posture to die for."));
$("test-good").addEventListener("click", () => playGood());
$("clear-sounds").addEventListener("click", () => {
  custom.bad = custom.good = null;
  delete store.badSound; delete store.goodSound; save();
  $("bad-file").value = ""; $("good-file").value = "";
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

function fire(nudge, cue) {
  const reminder = nudge === Nudge.CHIME || nudge === Nudge.VOICE;
  if (reminder) reminderCount += 1;
  const praise = nudge === Nudge.POSITIVE_CHIME ? nextPraise()
    : nudge === Nudge.RECOVERY ? nextRecovery() : null;
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
    new Notification("Posture Guard", { body: text, silent: true });
  }
}

// -- calibration UI -----------------------------------------------------------

$("calib-good").addEventListener("click", () => engine.calibration.start("good"));
$("calib-bad").addEventListener("click", () => engine.calibration.start("bad"));
$("calib-reset").addEventListener("click", () => {
  engine.calibration.reset();
  delete store.calibration; save();
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
      `${c.bad ? c.bad_samples + " frames" : "not recorded"}` + (c.calibrated ? " \u00b7 needle calibrated" : "");
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

function account(state, now) {
  if (session.lastT !== null) {
    const dt = Math.min(1, Math.max(0, now - session.lastT)); // cap gaps (sleep, hidden stalls)
    const day = (store.days[todayKey()] = store.days[todayKey()] || { good: 0, bad: 0 });
    if (state === State.GOOD) {
      session.good += dt; day.good += dt; session.streak += dt;
      session.best = Math.max(session.best, session.streak);
    } else if (state === State.BAD_CHIME || state === State.BAD_VOICE) {
      session.bad += dt; day.bad += dt; session.streak = 0;
    }
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
  const day = store.days[todayKey()];
  $("today").textContent = day
    ? `${mmss(day.good)} good, ${mmss(day.bad)} slouched`
    : "nothing tracked yet";
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
const SKELETON = [[7, 8], [7, 11], [8, 12], [11, 12], [11, 23], [12, 24], [23, 24]];

function wireColor(state, result) {
  if (state === State.BAD_CHIME || state === State.BAD_VOICE) return WIRE.bad;
  if (result.kind !== "scored") return WIRE.slate;
  const cfg = DEFAULTS.scoring;
  if (Math.abs(result.head_forward_deg) > cfg.head_forward_deg ||
      Math.abs(result.head_tilt_deg) > cfg.head_tilt_deg ||
      Math.abs(result.shoulder_level_deg) > cfg.shoulder_level_deg) return WIRE.drift;
  return state === State.GOOD ? WIRE.good : WIRE.slate;
}

function drawSkeleton(landmarks, color) {
  const w = (canvas.width = canvas.clientWidth);
  const h = (canvas.height = canvas.clientHeight);
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 4;
  for (const [a, b] of SKELETON) {
    const p = landmarks[a], q = landmarks[b];
    if (![p.x, p.y, q.x, q.y].every(Number.isFinite)) continue;
    ctx.beginPath(); ctx.moveTo(p.x * w, p.y * h); ctx.lineTo(q.x * w, q.y * h); ctx.stroke();
  }
  const le = landmarks[7], re = landmarks[8];
  if ([le.x, le.y, re.x, re.y].every(Number.isFinite)) { // head outline between the ears
    const r = Math.hypot((re.x - le.x) * w, (re.y - le.y) * h) * 0.75;
    ctx.beginPath(); ctx.arc(((le.x + re.x) / 2) * w, ((le.y + re.y) / 2) * h - r * 0.35, r, 0, 2 * Math.PI); ctx.stroke();
  }
  for (const i of TRACKED) {
    const p = landmarks[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 6, 0, 2 * Math.PI); ctx.fill();
  }
}

function causeFor(result, landmarks) {
  if (landmarks && landmarks[LEFT_EAR].y < 0.1) return "head near the top edge - lower the camera or sit lower";
  if (result.kind !== "unreliable") return "";
  switch (result.reason) {
    case Reason.NO_POSE: return "no one in view - sit facing the camera";
    case Reason.LOW_VISIBILITY: return `low confidence - ${result.detail}`;
    case Reason.FRAMING_OUT_OF_BAND:
      return result.detail.startsWith("too close") ? "too close - move back a little" : "too far - move closer";
    case Reason.NON_FINITE: return "tracking glitch - holding the last state";
    default: return result.detail;
  }
}

/** The "what to fix" box: shown while a reminder is active or a metric is past
 *  its threshold; quiet (and green) when posture is good. */
function renderFix(state, result, cue, hold) {
  const box = $("fix-box");
  const bad = state === State.BAD_CHIME || state === State.BAD_VOICE;
  const drifting = result.kind === "scored" && wireColor(state, result) === WIRE.drift;
  let title, how = "", cls = "";
  if ((bad || drifting) && cue) {
    title = cue.title; how = cue.fix; cls = "active";
  } else if (bad) {
    title = "Almost there"; cls = "active"; // the hold bar shows how long is left
  } else if (state === State.GOOD) {
    title = "Looking good"; cls = "ok";
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
  if (!hold) { bar.className = "hold idle"; return; }
  const secs = hold.remaining >= 10 ? `${Math.ceil(hold.remaining)} s` : `${hold.remaining.toFixed(1)} s`;
  bar.className = `hold ${hold.kind === "slipping" ? "warn" : "good"}`;
  $("hold-fill").style.width = `${(hold.fraction * 100).toFixed(1)}%`;
  $("hold-text").textContent = HOLD_TEXT[hold.kind](secs);
  bar.setAttribute("aria-valuenow", String(Math.round(hold.fraction * 100)));
}

function render(out, landmarks) {
  const { result, transition, needle, cue, hold } = out;
  renderFix(transition.state, result, cue, hold);
  const badge = $("state-badge");
  // NO_PERSON is also the start state: it lasts until posture is clearly good
  // or clearly bad, so a tracked person sitting in the in-between band would
  // otherwise read "no one in view" while being scored.
  badge.textContent = transition.state === State.NO_PERSON && result.kind === "scored"
    ? "settling in"
    : STATE_LABELS[transition.state] || transition.state;
  badge.className = `badge ${transition.state}`;
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
    $("needle-rotor").setAttribute("transform", `rotate(${((needle + 1) * 90).toFixed(1)} 100 100)`);
    // The threshold needle averages all metrics, so a single-metric slouch
    // sits mid-dial: the label follows the state machine, the needle shows how far.
    const bad = transition.state === State.BAD_CHIME || transition.state === State.BAD_VOICE;
    const label = bad ? "slouching" : needle > -0.3 || wireColor(transition.state, result) === WIRE.drift
      ? "drifting" : "upright";
    $("needle-text").textContent = label + (engine.needleCalibrated ? " \u00b7 calibrated" : "");
  }
  drawSkeleton(landmarks, wireColor(transition.state, result));
  renderCalibration();
  renderStats();
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
  lm[11] = { x: 0.60 + wobble, y: 0.62, visibility: 0.99 }; // unmirrored: left shoulder on the right
  lm[12] = { x: 0.40 + wobble, y: 0.62, visibility: 0.99 };
  lm[23] = { x: 0.56, y: 0.95, visibility: 0.9 };
  lm[24] = { x: 0.44, y: 0.95, visibility: 0.9 };
  const ex = slouch ? -0.02 : 0, ey = slouch ? 0.09 : 0;
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
  const stream = video.srcObject;
  if (stream) stream.getVideoTracks().forEach((t) => { t.enabled = !on; });
  if (on) {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    $("banner").classList.remove("show");
    const badge = $("state-badge");
    badge.textContent = "paused";
    badge.className = "badge paused";
    $("fps").textContent = "-";
  } else {
    engine.restart();
    session.lastT = null;
    lastFrameT = null;
    fpsEma = 0;
  }
  $("pause").textContent = on ? "Resume" : "Pause";
  $("pause").setAttribute("aria-pressed", String(on));
}

$("pause").addEventListener("click", () => setPaused(!paused));
document.addEventListener("keydown", (e) => {
  if (e.key !== "p" && e.key !== "P") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest("input, textarea, select, [contenteditable]")) return;
  setPaused(!paused);
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
    const first = res.landmarks && res.landmarks[0];
    // Some tasks-vision builds omit visibility; absent means "detected".
    landmarks = first ? first.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 })) : null;
  }
  const out = engine.process(landmarks, now);
  for (const nudge of out.nudges) fire(nudge, out.cue);
  account(out.transition.state, now);
  if (lastFrameT !== null) {
    const inst = 1 / Math.max(1e-3, now - lastFrameT);
    fpsEma = fpsEma ? 0.9 * fpsEma + 0.1 * inst : inst;
    $("fps").textContent = fpsEma.toFixed(0);
  }
  lastFrameT = now;
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
  worker.onmessage = () => { if (document.hidden) step(); };
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

class NoWebGLError extends Error {}

function showWebGLHelp(show) { $("webgl-help").classList.toggle("show", show); }

async function loadModel(canvas) {
  const { FilesetResolver, PoseLandmarker } = await import(`${TASKS_VISION}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${TASKS_VISION}/wasm`);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    canvas,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    return await PoseLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

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
const problems = []; // last few errors, newest last

function logProblem(message) {
  problems.push(`${new Date().toISOString().slice(11, 19)} ${String(message).slice(0, 300)}`);
  if (problems.length > 8) problems.shift();
}
window.addEventListener("error", (e) => logProblem(e.message || e.error || "error"));
window.addEventListener("unhandledrejection", (e) => logProblem(`unhandled: ${e.reason?.message || e.reason}`));

function webglInfo() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return typeof OffscreenCanvas !== "undefined" && webglCanvas() ? "offscreen only" : "unavailable";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return `${gl instanceof WebGL2RenderingContext ? "WebGL2" : "WebGL1"} (${renderer})`;
  } catch (err) {
    return `probe failed: ${err.message || err}`;
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
    `- Voice: ${v ? `${v.name} (${v.lang}${v.localService ? ", local" : ""})` : "none"} of ${voices.length}`,
    `- Calibration: good ${cal.good ? "recorded" : "no"}, slouch ${cal.bad ? "recorded" : "no"}, needle ${cal.calibrated ? "calibrated" : "default"}`,
    `- Custom sounds: bad ${custom.bad ? "yes" : "no"}, good ${custom.good ? "yes" : "no"}`,
    `- Reminders this session: ${reminderCount}`,
  ].join("\n");
  const errs = problems.length ? problems.join("\n") : "(none)";
  const body = [
    "**What happened?**", "", "", "",
    "**What did you expect?**", "", "", "",
    "**Steps to reproduce** (webcam or demo? what posture?)", "", "1. ", "",
    "<details><summary>Diagnostics (filled in by the app, no video or images)</summary>", "",
    diag, "", "Recent errors:", "```", errs, "```", "</details>",
  ].join("\n");
  const title = problems.length ? `Bug: ${problems[problems.length - 1].slice(9, 80)}` : "Bug: ";
  const params = new URLSearchParams({ title, body: body.slice(0, 6000), labels: "bug" });
  return `${ISSUE_URL}?${params}`;
}

// Fill the link at click time so it carries the current state.
for (const link of [$("report-bug"), ...document.querySelectorAll(".report-bug-link")]) {
  link.addEventListener("click", () => { link.href = bugReportUrl(); });
}

/** Tracking failed after it started: release the camera, bring the start
 *  screen back with the reason, and leave the demo available. */
function stopCamera(err) {
  setPaused(false);
  $("pause").disabled = true;
  poseLandmarker = null;
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  const noGL = !webglCanvas();
  showWebGLHelp(noGL);
  showError(noGL ? "" : `Tracking stopped: ${err.message || err}. Reload to try again, or try the demo.`);
  $("start-status").textContent = "";
  $("start-overlay").style.display = "";
  $("start-camera").disabled = $("start-demo").disabled = false;
}

let loopsStarted = false;

function begin(source) {
  $("source").textContent = source;
  $("start-overlay").style.display = "none";
  showWebGLHelp(false);
  restoreSound("bad"); restoreSound("good");
  $("pause").disabled = false;
  if (loopsStarted) return; // a retry after stopCamera reuses the running loops
  loopsStarted = true;
  requestAnimationFrame(visibleLoop);
  startHiddenTicker();
}

$("start-camera").addEventListener("click", async () => {
  ensureAudio(); // inside the click: browsers only allow audio after a gesture
  $("start-camera").disabled = $("start-demo").disabled = true;
  showError("");
  showWebGLHelp(false);
  try {
    // Check before asking for the camera: no point in a permission prompt
    // for a model that cannot run.
    const canvas = webglCanvas();
    if (!canvas) throw new NoWebGLError("WebGL unavailable");
    $("start-status").textContent = "Asking for camera access...";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false,
    });
    video.srcObject = stream;
    await video.play();
    $("start-status").textContent = "Loading the pose model (about 6 MB, cached after the first visit)...";
    poseLandmarker = await loadModel(canvas);
    begin("webcam");
  } catch (err) {
    $("start-status").textContent = "";
    const stream = video.srcObject;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    if (err instanceof NoWebGLError) {
      showWebGLHelp(true);
    } else {
      showError(`${err.name === "NotAllowedError" ? "Camera permission denied" : "Could not start"}: ${err.message || err}. Try the demo instead.`);
    }
    $("start-camera").disabled = $("start-demo").disabled = false;
  }
});

$("start-demo").addEventListener("click", () => {
  ensureAudio();
  demo = true;
  video.style.display = "none";
  $("demo-note").style.display = "block";
  begin("demo");
});

renderCalibration();
renderStats();
