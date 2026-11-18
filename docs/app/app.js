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
  voiceDelay: DEFAULTS.state.voice_delay_s,
  voiceRepeat: DEFAULTS.state.voice_repeat_cooldown_s,
};
document.querySelectorAll("input[name=mode]").forEach((el) => {
  el.checked = el.value === settings.mode;
  el.addEventListener("change", () => { settings.mode = el.value; store.mode = el.value; save(); });
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

function tones(freqs, seconds) {
  const ac = ensureAudio();
  let t = ac.currentTime + 0.02;
  freqs.forEach((f, i) => {
    const dur = seconds[i];
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
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

// Same tones as audio.py: falling-then-rising two-tone reminder, C-major arpeggio reward.
const playBad = () => (custom.bad ? playBuffer(custom.bad) : tones([660, 990], [0.15, 0.25]));
const playGood = () => (custom.good ? playBuffer(custom.good) : tones([523.25, 659.25, 783.99, 1046.5], [0.2, 0.2, 0.2, 0.2]));

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

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
  [Nudge.CHIME]: "Reminder: sit up",
  [Nudge.VOICE]: null, // filled with the prompt text
  [Nudge.POSITIVE_CHIME]: "Nice posture!",
  [Nudge.RECOVERY]: "Back to good posture",
};
let reminderCount = 0;
let bannerTimer = null;

function fire(nudge) {
  if (nudge === Nudge.CHIME || nudge === Nudge.VOICE) reminderCount += 1;
  const text = nudge === Nudge.VOICE ? `Reminder: ${settings.voiceText}` : BANNERS[nudge];
  const banner = $("banner");
  banner.textContent = text;
  banner.classList.toggle("positive", nudge === Nudge.POSITIVE_CHIME || nudge === Nudge.RECOVERY);
  banner.classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove("show"), 2500);
  if (!allowed(nudge)) return; // silent / chime-only: still a visible event
  if (nudge === Nudge.VOICE) speak(settings.voiceText);
  else if (nudge === Nudge.CHIME) playBad();
  else playGood();
  if (notifyEnabled && document.hidden && (nudge === Nudge.CHIME || nudge === Nudge.VOICE)) {
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

function render(out, landmarks) {
  const { result, transition, needle } = out;
  const badge = $("state-badge");
  badge.textContent = STATE_LABELS[transition.state] || transition.state;
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

function step() {
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
    const res = poseLandmarker.detectForVideo(video, ts);
    const first = res.landmarks && res.landmarks[0];
    // Some tasks-vision builds omit visibility; absent means "detected".
    landmarks = first ? first.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 })) : null;
  }
  const out = engine.process(landmarks, now, { depthSensor: false });
  for (const nudge of out.nudges) fire(nudge);
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

async function loadModel() {
  const { FilesetResolver, PoseLandmarker } = await import(`${TASKS_VISION}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${TASKS_VISION}/wasm`);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    return await PoseLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

function showError(message) { $("start-error").textContent = message; }

function begin(source) {
  $("source").textContent = source;
  $("start-overlay").style.display = "none";
  restoreSound("bad"); restoreSound("good");
  requestAnimationFrame(visibleLoop);
  startHiddenTicker();
}

$("start-camera").addEventListener("click", async () => {
  ensureAudio(); // inside the click: browsers only allow audio after a gesture
  $("start-camera").disabled = $("start-demo").disabled = true;
  showError("");
  try {
    $("start-status").textContent = "Asking for camera access...";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false,
    });
    video.srcObject = stream;
    await video.play();
    $("start-status").textContent = "Loading the pose model (about 6 MB, cached after the first visit)...";
    poseLandmarker = await loadModel();
    begin("webcam");
  } catch (err) {
    $("start-status").textContent = "";
    showError(`${err.name === "NotAllowedError" ? "Camera permission denied" : "Could not start"}: ${err.message || err}. Try the demo instead.`);
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
