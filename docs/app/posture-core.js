// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// BackUp core: scoring, posture state machine, needle, calibration, cues and
// the per-frame engine. Pure functions and classes, no DOM, no clock: every
// method takes the frame time `now` (seconds). tests/js/posture-core.test.mjs
// replays a golden timeline (tests/js/fixtures/golden-timeline.json) through it.

// MediaPipe Pose landmark indices.
export const LEFT_EAR = 7;
export const RIGHT_EAR = 8;
export const LEFT_SHOULDER = 11;
export const RIGHT_SHOULDER = 12;
export const LEFT_HIP = 23;
export const RIGHT_HIP = 24;
export const TRACKED = [LEFT_EAR, RIGHT_EAR, LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP];

const EPS = 1e-9; // window comparisons
const JITTER_PATTERN = [0.0, -1.0, 1.0, -0.5, 0.5]; // praise spacing jitter
const NEEDLE_EPS = 1e-9; // degenerate-axis guard
const RAD_TO_DEG = 180 / Math.PI;

// Tuning knobs. The golden test asserts they match the config recorded in its fixture.
export const DEFAULTS = Object.freeze({
  scoring: {
    head_forward_deg: 8.0,
    trunk_lean_deg: 7.0,
    head_tilt_deg: 8.0,
    shoulder_level_deg: 6.0,
    hysteresis_margin_deg: 3.0,
    visibility_floor: 0.5,
    trunk_lean_required: true,
    degraded_feedback: true,
    shoulder_width_min: 0.12,
    shoulder_width_max: 0.65,
    baseline_deviation: { enabled: true, window_s: 300.0 },
  },
  state: {
    smoothing_window_s: 0.3,
    bad_sustain_s: 2.0,
    good_confirm_s: 1.0,
    recovery_good_s: 3.0,
    voice_delay_s: 10.0,
    voice_repeat_cooldown_s: 30.0,
    no_person_timeout_s: 2.0,
  },
  feedback: {
    positive_chime: { enabled: true, every_seconds: 90, first_after_seconds: 15, growth: 1.5, jitter: 0.25 },
    recovery_chime: { enabled: true },
  },
  needle: { tau_s: 0.5 },
  calibration: { window_s: 3.0, min_samples: 5 },
});

export const Reason = Object.freeze({
  NO_POSE: "no_pose",
  LOW_VISIBILITY: "low_visibility",
  NON_FINITE: "non_finite",
  FRAMING_OUT_OF_BAND: "framing_out_of_band",
});

export const State = Object.freeze({
  NO_PERSON: "no_person",
  GOOD: "good",
  BAD_CHIME: "bad_chime",
  BAD_VOICE: "bad_voice",
  UNRELIABLE: "unreliable",
});

export const Nudge = Object.freeze({
  NONE: "none",
  CHIME: "chime",
  VOICE: "voice",
  POSITIVE_CHIME: "positive_chime",
  RECOVERY: "recovery",
});

const isFinite_ = Number.isFinite;

// -- scoring ------------------------------------------------------------------

export function scored(m) {
  return {
    kind: "scored",
    head_forward_deg: m.head_forward_deg,
    trunk_lean_deg: m.trunk_lean_deg,
    head_tilt_deg: m.head_tilt_deg,
    shoulder_level_deg: m.shoulder_level_deg,
    trunk_lean_available: m.trunk_lean_available ?? true,
  };
}

export function unreliable(reason, detail = "") {
  return { kind: "unreliable", reason, detail };
}

function mid(a, b) {
  return [(a.x + b.x) / 2, (a.y + b.y) / 2];
}

function angleFromVertical(dx, dy) {
  return Math.atan2(dx, dy) * RAD_TO_DEG;
}

function measureHeadForward(lm) {
  const ear = mid(lm[LEFT_EAR], lm[RIGHT_EAR]);
  const sh = mid(lm[LEFT_SHOULDER], lm[RIGHT_SHOULDER]);
  return angleFromVertical(ear[0] - sh[0], sh[1] - ear[1]);
}

function measureTrunkLean(lm) {
  const sh = mid(lm[LEFT_SHOULDER], lm[RIGHT_SHOULDER]);
  const hip = mid(lm[LEFT_HIP], lm[RIGHT_HIP]);
  return angleFromVertical(sh[0] - hip[0], hip[1] - sh[1]);
}

function measureHeadTilt(lm) {
  const ex = lm[RIGHT_EAR].x - lm[LEFT_EAR].x;
  const ey = lm[RIGHT_EAR].y - lm[LEFT_EAR].y;
  const sx = lm[RIGHT_SHOULDER].x - lm[LEFT_SHOULDER].x;
  const sy = lm[RIGHT_SHOULDER].y - lm[LEFT_SHOULDER].y;
  return Math.atan2(ex * sy - ey * sx, ex * sx + ey * sy) * RAD_TO_DEG;
}

function measureShoulderLevel(lm) {
  const dy = lm[RIGHT_SHOULDER].y - lm[LEFT_SHOULDER].y;
  const dx = lm[RIGHT_SHOULDER].x - lm[LEFT_SHOULDER].x;
  return Math.atan2(dy, Math.abs(dx)) * RAD_TO_DEG;
}

function shoulderWidth(lm) {
  return Math.abs(lm[RIGHT_SHOULDER].x - lm[LEFT_SHOULDER].x);
}

const GROUPS = [
  ["ears", [LEFT_EAR, RIGHT_EAR]],
  ["shoulders", [LEFT_SHOULDER, RIGHT_SHOULDER]],
  ["hips", [LEFT_HIP, RIGHT_HIP]],
];

function fmt2(v) {
  return Number.isNaN(v) ? "nan" : v.toFixed(2);
}

export function lowVisibilityDetail(lm, cfg) {
  const parts = [];
  let hipsHidden = false;
  for (const [name, [l, r]] of GROUPS) {
    const below = [];
    [
      ["left", l],
      ["right", r],
    ].forEach(([side, i]) => {
      // `<` (not `!(>=)`) on purpose: a NaN visibility is not listed.
      if (lm[i].visibility < cfg.visibility_floor) below.push(`${side} ${fmt2(lm[i].visibility)}`);
    });
    if (below.length) {
      parts.push(`${name} not visible (${below.join(", ")})`);
      hipsHidden = hipsHidden || name === "hips";
    }
  }
  if (!parts.length) return "landmark visibility below the floor";
  const detail = parts.join("; ");
  return hipsHidden ? detail + " - trunk lean unavailable" : detail;
}

function finiteXY(lm, indices) {
  return indices.every((i) => isFinite_(lm[i].x) && isFinite_(lm[i].y));
}

/** landmarks: array of {x, y, visibility} (33) or null. */
export function scorePose(landmarks, cfg) {
  if (landmarks === null || landmarks === undefined) return unreliable(Reason.NO_POSE);
  const floor = cfg.visibility_floor;
  const earsShoulders = [LEFT_EAR, RIGHT_EAR, LEFT_SHOULDER, RIGHT_SHOULDER];
  const hips = [LEFT_HIP, RIGHT_HIP];
  // `>=` is false for NaN, so a NaN visibility counts as hidden.
  const esVisible = earsShoulders.every((i) => landmarks[i].visibility >= floor);
  const hipsVisible = hips.every((i) => landmarks[i].visibility >= floor);
  if (!esVisible || (cfg.trunk_lean_required && !hipsVisible && !cfg.degraded_feedback)) {
    return unreliable(Reason.LOW_VISIBILITY, lowVisibilityDetail(landmarks, cfg));
  }
  if (!finiteXY(landmarks, earsShoulders)) {
    return unreliable(Reason.NON_FINITE, "NaN/inf ear or shoulder coordinate");
  }
  let hipsOk = hipsVisible && finiteXY(landmarks, hips);
  if (cfg.trunk_lean_required && !hipsOk && !cfg.degraded_feedback) {
    return unreliable(Reason.NON_FINITE, "NaN/inf hip coordinate");
  }
  const width = shoulderWidth(landmarks);
  if (!(cfg.shoulder_width_min <= width && width <= cfg.shoulder_width_max)) {
    const where = width < cfg.shoulder_width_min ? "too far" : "too close";
    return unreliable(
      Reason.FRAMING_OUT_OF_BAND,
      `${where}: shoulder width ${width.toFixed(2)} of frame outside ` +
        `${cfg.shoulder_width_min}-${cfg.shoulder_width_max}`,
    );
  }
  const headForward = measureHeadForward(landmarks);
  const headTilt = measureHeadTilt(landmarks);
  const shoulderLevel = measureShoulderLevel(landmarks);
  if (![headForward, headTilt, shoulderLevel].every(isFinite_)) {
    return unreliable(Reason.NON_FINITE, "metric overflow");
  }
  let trunk = finiteXY(landmarks, hips) ? measureTrunkLean(landmarks) : 0.0;
  if (!isFinite_(trunk)) {
    trunk = 0.0;
    hipsOk = false;
  }
  return scored({
    head_forward_deg: headForward,
    trunk_lean_deg: trunk,
    head_tilt_deg: headTilt,
    shoulder_level_deg: shoulderLevel,
    trunk_lean_available: hipsOk,
  });
}

function badExit(cfg, threshold) {
  return threshold - cfg.hysteresis_margin_deg;
}

function classify(pairs, cfg) {
  if (pairs.some(([v, t]) => Math.abs(v) > t)) return "bad";
  if (pairs.every(([v, t]) => Math.abs(v) < badExit(cfg, t))) return "good";
  return "neutral";
}

export function zoneOf(m, cfg) {
  const pairs = [
    [m.head_forward_deg, cfg.head_forward_deg],
    [m.head_tilt_deg, cfg.head_tilt_deg],
    [m.shoulder_level_deg, cfg.shoulder_level_deg],
  ];
  if (cfg.trunk_lean_required && m.trunk_lean_available) pairs.push([m.trunk_lean_deg, cfg.trunk_lean_deg]);
  return classify(pairs, cfg);
}

class PostureBaseline {
  constructor(cfg) {
    this.windowS = cfg.window_s;
    this.metrics = null;
    this.lastT = null;
    this.anchor = null;
  }

  setAnchor(m) {
    this.anchor = m;
    this.metrics = m;
    this.lastT = null;
  }

  update(m, now) {
    if (this.metrics === null) {
      this.metrics = m;
      this.lastT = now;
      return;
    }
    if (this.lastT === null) {
      this.lastT = now;
      return;
    }
    const dt = Math.max(0, now - this.lastT);
    const alpha = this.windowS <= 0 ? 1.0 : 1.0 - Math.exp(-dt / this.windowS);
    const ref = this.metrics;
    const trunkIn = m.trunk_lean_available ? m.trunk_lean_deg : ref.trunk_lean_deg;
    this.metrics = scored({
      head_forward_deg: ref.head_forward_deg + alpha * (m.head_forward_deg - ref.head_forward_deg),
      trunk_lean_deg: ref.trunk_lean_deg + alpha * (trunkIn - ref.trunk_lean_deg),
      head_tilt_deg: ref.head_tilt_deg + alpha * (m.head_tilt_deg - ref.head_tilt_deg),
      shoulder_level_deg: ref.shoulder_level_deg + alpha * (m.shoulder_level_deg - ref.shoulder_level_deg),
      trunk_lean_available: true,
    });
    this.lastT = now;
  }

  reset() {
    this.metrics = this.anchor;
    this.lastT = null;
  }
}

function deviationZone(m, baseline, cfg) {
  const ref = baseline.metrics;
  if (ref === null) return "good";
  const pairs = [
    [m.head_forward_deg - ref.head_forward_deg, cfg.head_forward_deg],
    [m.head_tilt_deg - ref.head_tilt_deg, cfg.head_tilt_deg],
    [m.shoulder_level_deg - ref.shoulder_level_deg, cfg.shoulder_level_deg],
  ];
  if (cfg.trunk_lean_required && m.trunk_lean_available) {
    pairs.push([m.trunk_lean_deg - ref.trunk_lean_deg, cfg.trunk_lean_deg]);
  }
  return classify(pairs, cfg);
}

// -- state machine ------------------------------------------------------------

const BAD_STATES = new Set([State.BAD_CHIME, State.BAD_VOICE]);

function transition(state, nudge, extra = {}) {
  return { state, nudge, seconds_bad: extra.seconds_bad ?? null, recovered: extra.recovered ?? false };
}

export class PostureStateMachine {
  /** timings: state config; thresholds: scoring config; feedback: feedback config.
   *  voiceTimings: optional () => [delay_s, repeat_s] runtime override. */
  constructor(timings, thresholds, feedback = DEFAULTS.feedback, voiceTimings = null) {
    this.t = timings;
    this.th = thresholds;
    this.positive = feedback.positive_chime;
    this.voiceTimings = voiceTimings;
    this.state = State.NO_PERSON;
    this.baseline = thresholds.baseline_deviation.enabled ? new PostureBaseline(thresholds.baseline_deviation) : null;
    this.history = [];
    this.badSince = null;
    this.goodSince = null;
    this.absentSince = null;
    this.chimeAt = null;
    this.voiceAt = null;
    this.goodStateSince = null;
    this.positiveAt = null;
    this.positiveCount = 0; // praises so far in the current GOOD streak
  }

  setBaselineAnchor(m) {
    if (this.baseline !== null) this.baseline.setAnchor(m);
  }

  /** Synthetic pose sources (the demo) have no real desk to adapt to. Without
   *  this, the drift baseline seeds itself from the first tracked frame: when
   *  that frame is a demo slouch pose, every later good phase scores as a
   *  deviation and the machine can never return to good (issue #67). */
  setDriftBaselineEnabled(enabled) {
    if (!enabled) {
      this.baseline = null;
    } else if (this.baseline === null && this.th.baseline_deviation.enabled) {
      this.baseline = new PostureBaseline(this.th.baseline_deviation);
    }
  }

  update(result, now) {
    if (result.kind === "unreliable") return this.onUnreliable(result, now);
    this.absentSince = null;
    let zone = zoneOf(result, this.th);
    if (this.baseline !== null) {
      this.baseline.update(result, now);
      const baseZone = deviationZone(result, this.baseline, this.th);
      if (zone === "bad" || baseZone === "bad") zone = "bad";
      else if (zone === "good" && baseZone === "good") zone = "good";
      else zone = "neutral";
    }
    this.history.push([now, zone]);
    this.pruneHistory(now);

    const span = now - this.history[0][0];
    const windowHasGood = this.history.some(([, z]) => z === "good");
    const full = span >= this.t.smoothing_window_s - EPS;
    const smoothedBad = full && this.history.every(([, z]) => z === "bad");
    const smoothedGood = full && this.history.every(([, z]) => z === "good");
    if (this.badSince === null && !windowHasGood) {
      const bad = this.history.find(([, z]) => z === "bad");
      if (bad) this.badSince = bad[0];
    }
    if (smoothedGood && this.goodSince === null) this.goodSince = this.history[0][0];
    if (this.badSince !== null && smoothedGood) this.badSince = null;
    if (!smoothedGood && this.goodSince !== null && smoothedBad) this.goodSince = null;
    const sustainingBad = this.badSince !== null && !windowHasGood;

    if (BAD_STATES.has(this.state)) return this.updateBad(smoothedGood, now);
    const tr = this.updateIdle(sustainingBad, smoothedGood, now);
    // Never praise during the bad_sustain_s window where state is still GOOD.
    if (this.state === State.GOOD && this.positive.enabled) return this.maybePositiveChime(now, smoothedGood);
    return tr;
  }

  onUnreliable(result, now) {
    if (result.reason === Reason.NON_FINITE) return transition(this.state, Nudge.NONE);
    if (result.reason === Reason.NO_POSE) {
      if (this.absentSince === null) this.absentSince = now;
      if (now - this.absentSince >= this.t.no_person_timeout_s - EPS) {
        this.enterNoPerson();
        return transition(State.NO_PERSON, Nudge.NONE);
      }
      return transition(this.state, Nudge.NONE);
    }
    this.absentSince = null;
    this.state = State.UNRELIABLE;
    this.history = [];
    this.badSince = null;
    this.goodSince = null;
    this.chimeAt = null;
    this.voiceAt = null;
    this.goodStateSince = null;
    return transition(State.UNRELIABLE, Nudge.NONE);
  }

  enterNoPerson() {
    this.state = State.NO_PERSON;
    this.history = [];
    if (this.baseline !== null) this.baseline.reset();
    this.badSince = null;
    this.goodSince = null;
    this.chimeAt = null;
    this.voiceAt = null;
    this.goodStateSince = null;
  }

  currentVoiceTimings() {
    if (this.voiceTimings) return this.voiceTimings();
    return [this.t.voice_delay_s, this.t.voice_repeat_cooldown_s];
  }

  updateIdle(sustainingBad, smoothedGood, now) {
    if (sustainingBad && this.badSince !== null && now - this.badSince >= this.t.bad_sustain_s - EPS) {
      const secondsBad = now - this.badSince;
      this.state = State.BAD_CHIME;
      this.chimeAt = now;
      this.voiceAt = null;
      this.goodStateSince = null;
      return transition(State.BAD_CHIME, Nudge.CHIME, { seconds_bad: secondsBad });
    }
    if (smoothedGood && this.goodSince !== null && now - this.goodSince >= this.t.good_confirm_s - EPS) {
      this.state = State.GOOD;
      return transition(State.GOOD, Nudge.NONE);
    }
    return transition(this.state, Nudge.NONE);
  }

  updateBad(smoothedGood, now) {
    if (smoothedGood && this.goodSince !== null && now - this.goodSince >= this.t.recovery_good_s - EPS) {
      this.state = State.GOOD;
      this.badSince = null;
      this.chimeAt = null;
      this.voiceAt = null;
      return transition(State.GOOD, Nudge.NONE, { recovered: true });
    }
    const [delayS, repeatS] = this.currentVoiceTimings();
    if (this.state === State.BAD_CHIME && this.chimeAt !== null) {
      if (now - this.chimeAt >= delayS - EPS) {
        this.state = State.BAD_VOICE;
        this.voiceAt = now;
        return transition(State.BAD_VOICE, Nudge.VOICE);
      }
    } else if (this.state === State.BAD_VOICE && this.voiceAt !== null && now - this.voiceAt >= repeatS - EPS) {
      this.voiceAt = now;
      return transition(State.BAD_VOICE, Nudge.VOICE);
    }
    return transition(this.state, Nudge.NONE);
  }

  /** Seconds of GOOD before praise `count` (0-based) of a streak: dense-to-lean
   *  with a fixed jitter pattern. */
  positiveGap(count) {
    const pc = this.positive;
    const first = pc.first_after_seconds ?? null;
    if (first === null) return pc.every_seconds;
    const gap = Math.min(first * (pc.growth ?? 1.5) ** count, pc.every_seconds);
    return gap * (1 + (pc.jitter ?? 0) * JITTER_PATTERN[count % JITTER_PATTERN.length]);
  }

  /** UI-only view of the timer the user is currently racing (it reads
   *  state, never changes it). null when no timer runs.
   *  kind: "recover"  holding good posture to clear a reminder (recovery_good_s)
   *        "confirm"  holding good posture to reach GOOD (good_confirm_s)
   *        "slipping" a slouch building toward the reminder (bad_sustain_s)
   *        "praise"   good posture held toward the next praise
   *  fraction 0..1 of the way there, remaining seconds left. */
  holdProgress(now) {
    const timer = (kind, start, need) => {
      const elapsed = Math.max(0, now - start);
      return { kind, fraction: need > 0 ? Math.min(1, elapsed / need) : 1, remaining: Math.max(0, need - elapsed) };
    };
    if (BAD_STATES.has(this.state)) {
      return this.goodSince === null ? null : timer("recover", this.goodSince, this.t.recovery_good_s);
    }
    if (this.badSince !== null) return timer("slipping", this.badSince, this.t.bad_sustain_s);
    if (this.state === State.GOOD) {
      if (!this.positive.enabled || this.goodStateSince === null) return null;
      const since = this.positiveCount && this.positiveAt !== null ? this.positiveAt : this.goodStateSince;
      let due = since + this.positiveGap(this.positiveCount);
      if (this.positiveAt !== null) due = Math.max(due, this.positiveAt + this.positiveGap(0));
      return timer("praise", since, due - since);
    }
    if (this.goodSince !== null) return timer("confirm", this.goodSince, this.t.good_confirm_s);
    return null;
  }

  maybePositiveChime(now, smoothedGood = true) {
    if (this.goodStateSince === null) {
      this.goodStateSince = now;
      this.positiveCount = 0;
    }
    const since = this.positiveCount && this.positiveAt !== null ? this.positiveAt : this.goodStateSince;
    const sustained = now - since >= this.positiveGap(this.positiveCount) - EPS;
    const cooled = this.positiveAt === null || now - this.positiveAt >= this.positiveGap(0) - EPS;
    if (sustained && cooled && smoothedGood) {
      this.positiveAt = now;
      this.positiveCount += 1;
      return transition(State.GOOD, Nudge.POSITIVE_CHIME);
    }
    return transition(State.GOOD, Nudge.NONE);
  }

  pruneHistory(now) {
    // Keep the window plus its boundary sample (see design.md).
    const cutoff = now - this.t.smoothing_window_s + EPS;
    let drop = 0;
    while (drop + 1 < this.history.length && this.history[drop + 1][0] <= cutoff) drop += 1;
    if (drop) this.history = this.history.slice(drop);
  }
}

// -- needle ---------------------------------------------------------------------

export function clamp(v, lo = -1.0, hi = 1.0) {
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function dims(m, includeTrunk) {
  const v = [m.head_forward_deg, m.head_tilt_deg, m.shoulder_level_deg];
  if (includeTrunk) v.push(m.trunk_lean_deg);
  return v;
}

function axisOk(cal) {
  const g = dims(cal.good, false);
  const b = dims(cal.bad, false);
  if (!g.every(isFinite_) || !b.every(isFinite_)) return false;
  return g.reduce((s, gi, i) => s + (b[i] - gi) ** 2, 0) > NEEDLE_EPS;
}

export function thresholdNeedle(m, cfg) {
  const pairs = [
    [m.head_forward_deg, cfg.head_forward_deg],
    [m.head_tilt_deg, cfg.head_tilt_deg],
    [m.shoulder_level_deg, cfg.shoulder_level_deg],
  ];
  if (cfg.trunk_lean_required && m.trunk_lean_available) pairs.push([m.trunk_lean_deg, cfg.trunk_lean_deg]);
  if (!pairs.every(([v]) => isFinite_(v))) return null;
  const sev = pairs.map(([v, t]) => Math.min(1.0, Math.abs(v) / Math.max(t, NEEDLE_EPS)));
  return clamp((2.0 * sev.reduce((a, b) => a + b, 0)) / sev.length - 1.0);
}

export function calibratedNeedle(m, cal) {
  const trunk = m.trunk_lean_available && cal.good.trunk_lean_available && cal.bad.trunk_lean_available;
  const vec = dims(m, trunk);
  const good = dims(cal.good, trunk);
  const bad = dims(cal.bad, trunk);
  if (![...vec, ...good, ...bad].every(isFinite_)) return null;
  const axis = good.map((g, i) => bad[i] - g);
  const normSq = axis.reduce((s, a) => s + a * a, 0);
  if (!isFinite_(normSq) || normSq <= NEEDLE_EPS) return null;
  const proj = vec.reduce((s, v, i) => s + (v - good[i]) * axis[i], 0) / normSq;
  if (!isFinite_(proj)) return null;
  return clamp(2.0 * proj - 1.0);
}

export function rawNeedle(m, cfg, cal = null) {
  if (cal !== null) {
    const v = calibratedNeedle(m, cal);
    if (v !== null) return v;
  }
  return thresholdNeedle(m, cfg);
}

export class NeedleSmoother {
  constructor(cfg) {
    this.tau = cfg.tau_s;
    this.value = null;
    this.lastT = null;
  }

  reset() {
    this.value = null;
    this.lastT = null;
  }

  update(raw, now) {
    if (raw === null || raw === undefined || !isFinite_(raw) || !isFinite_(now)) return this.value;
    raw = clamp(raw);
    if (this.value === null || this.lastT === null) {
      this.value = raw;
      this.lastT = now;
      return this.value;
    }
    const dt = now - this.lastT;
    if (dt <= 0) return this.value;
    const alpha = this.tau <= 0 ? 1.0 : 1.0 - Math.exp(-dt / this.tau);
    this.value = clamp(alpha * raw + (1.0 - alpha) * this.value);
    this.lastT = now;
    return this.value;
  }
}

// -- calibration --------------------------------------------------------------

function centroid(samples) {
  const n = samples.length;
  const withTrunk = samples.filter((s) => s.trunk_lean_available);
  const trunkOk = withTrunk.length * 2 >= n;
  const mean = (key, arr) => arr.reduce((a, s) => a + s[key], 0) / arr.length;
  return scored({
    head_forward_deg: mean("head_forward_deg", samples),
    trunk_lean_deg: trunkOk ? mean("trunk_lean_deg", withTrunk) : 0.0,
    head_tilt_deg: mean("head_tilt_deg", samples),
    shoulder_level_deg: mean("shoulder_level_deg", samples),
    trunk_lean_available: trunkOk,
  });
}

export class CalibrationRecorder {
  constructor(cfg) {
    this.cfg = cfg;
    this.pending = null;
    this.active = null;
    this.startedAt = null;
    this.lastNow = null;
    this.samples = [];
    this.centroids = { good: null, bad: null };
    this.counts = { good: 0, bad: 0 };
    this.error = null;
    this.version = 0;
  }

  start(kind) {
    this.pending = kind;
    this.active = null;
    this.startedAt = null;
    this.samples = [];
    this.error = null;
  }

  reset() {
    this.pending = null;
    this.active = null;
    this.startedAt = null;
    this.samples = [];
    this.centroids = { good: null, bad: null };
    this.counts = { good: 0, bad: 0 };
    this.error = null;
    this.version += 1;
  }

  /** Restore centroids saved in localStorage. */
  // fallow-ignore-next-line unused-class-member
  load(saved) {
    this.centroids = { good: saved.good ? scored(saved.good) : null, bad: saved.bad ? scored(saved.bad) : null };
    this.counts = { good: saved.good_samples ?? 0, bad: saved.bad_samples ?? 0 };
    this.error = null;
    this.version += 1;
  }

  get calibration() {
    const { good, bad } = this.centroids;
    return good && bad ? { good, bad } : null;
  }

  get status() {
    let remaining = null;
    if (this.active !== null && this.startedAt !== null) {
      remaining = Math.max(0, this.cfg.window_s - ((this.lastNow ?? this.startedAt) - this.startedAt));
    } else if (this.pending !== null) {
      remaining = this.cfg.window_s;
    }
    return {
      active: this.active ?? this.pending,
      remaining_s: remaining,
      good_samples: this.counts.good,
      bad_samples: this.counts.bad,
      calibrated: this.calibration !== null,
      good: this.centroids.good,
      bad: this.centroids.bad,
      error: this.error,
    };
  }

  feed(result, now) {
    this.lastNow = now;
    if (this.pending !== null) {
      this.active = this.pending;
      this.pending = null;
      this.startedAt = now;
      this.samples = [];
    }
    if (this.active === null || this.startedAt === null) return;
    if (now - this.startedAt < this.cfg.window_s) {
      if (result.kind === "scored") this.samples.push(result);
      return;
    }
    this.finish();
  }

  finish() {
    const kind = this.active;
    const samples = this.samples;
    this.active = null;
    this.startedAt = null;
    this.samples = [];
    const needed = Math.max(1, this.cfg.min_samples);
    if (samples.length < needed) {
      this.error =
        `${kind} calibration failed: ${samples.length} scored frames ` +
        `(need ${needed}) - sit fully in frame and retry`;
      return;
    }
    this.centroids[kind] = centroid(samples);
    this.counts[kind] = samples.length;
    this.error = null;
    this.version += 1;
    const cal = this.calibration;
    if (cal && !axisOk(cal)) {
      this.error =
        "good and slouch recordings are identical - the needle uses the " + "thresholds until one is re-recorded";
    }
  }
}

// -- cues -----------------------------------------------------------------------

export const CUE_METRICS = ["head_forward", "head_tilt", "shoulder_level", "trunk_lean"];

/** +1 when the person's right shoulder is at larger image x, else -1. */
export function mirrorSign(landmarks) {
  if (landmarks === null || landmarks === undefined) return 1.0;
  return landmarks[RIGHT_SHOULDER].x - landmarks[LEFT_SHOULDER].x < 0 ? -1.0 : 1.0;
}

/** [title, fix, say] for a metric's cue. Exported so voice-lines.js can list
 *  every spoken sentence for pre-rendering. */
export function cueText(metric, side) {
  if (metric === "head_forward") {
    return [
      "Head forward",
      "Tuck your chin and bring your ears back over your shoulders.",
      "Head forward. Tuck your chin and bring your ears back over your shoulders.",
    ];
  }
  // Sideways cues name the area, not a side: after mirroring and baseline
  // drift, "left"/"right" was too often the wrong way round to trust, and
  // "straighten your neck" is the right fix either way. `side` stays in the
  // returned cue (and its id) for consumers that want it.
  void side;
  if (metric === "head_tilt") {
    return [
      "Head tilted",
      "Straighten your neck so your ears are level.",
      "Your head is tilted. Straighten your neck.",
    ];
  }
  if (metric === "shoulder_level") {
    return [
      "Shoulders uneven",
      "Level your shoulders and take your weight off your elbow.",
      "Your shoulders are uneven. Level them out.",
    ];
  }
  return [
    "Leaning sideways",
    "Sit up straight with your weight even on both hips.",
    "You're leaning to one side. Sit up straight.",
  ];
}

function cueSide(metric, signed, mirror) {
  if (metric === "head_forward") return null;
  if (metric === "shoulder_level") return signed > 0 ? "right" : "left";
  if (metric === "head_tilt") return signed * mirror < 0 ? "right" : "left";
  return signed * mirror > 0 ? "right" : "left";
}

/** What is off and how to fix it, or null. */
export function postureCue(m, cfg, baseline = null, mirror = 1.0) {
  const trunkOk = cfg.trunk_lean_required && m.trunk_lean_available;
  let best = null; // [ratio, metric, signed]
  for (const metric of CUE_METRICS) {
    if (metric === "trunk_lean" && !trunkOk) continue;
    const value = m[`${metric}_deg`];
    const threshold = cfg[`${metric}_deg`];
    if (threshold <= 0) continue;
    const exitAt = badExit(cfg, threshold);
    const candidates = [value];
    if (baseline !== null) candidates.push(value - baseline[`${metric}_deg`]);
    for (const signed of candidates) {
      if (Math.abs(signed) <= exitAt) continue;
      const ratio = Math.abs(signed) / threshold;
      if (best === null || ratio > best[0]) best = [ratio, metric, signed];
    }
  }
  if (best === null) return null;
  const [, metric, signed] = best;
  const side = cueSide(metric, signed, mirror);
  const [title, fix, say] = cueText(metric, side ?? "");
  return { id: `${metric}:${side ?? "-"}`, metric, side, title, fix, say };
}

// -- engine ---------------------------------------------------------------------

/** One object per session: feed it landmarks + frame time, get back everything
 *  the UI needs. */
export class PostureEngine {
  constructor(config = DEFAULTS, { voiceTimings = null } = {}) {
    this.config = config;
    this.machine = new PostureStateMachine(config.state, config.scoring, config.feedback, voiceTimings);
    this.calibration = new CalibrationRecorder(config.calibration);
    this.calibrationVersion = this.calibration.version;
    this.needle = new NeedleSmoother(config.needle);
    this.needleCalibrated = false;
  }

  process(landmarks, now) {
    const result = scorePose(landmarks, this.config.scoring);
    this.calibration.feed(result, now);
    if (this.calibration.version !== this.calibrationVersion) {
      this.calibrationVersion = this.calibration.version;
      this.machine.setBaselineAnchor(this.calibration.centroids.good);
    }
    const tr = this.machine.update(result, now);
    if (result.kind === "scored") {
      const cal = this.calibration.calibration;
      const usable = cal !== null && axisOk(cal);
      if (usable !== this.needleCalibrated) {
        this.needle.reset();
        this.needleCalibrated = usable;
      }
      this.needle.update(rawNeedle(result, this.config.scoring, usable ? cal : null), now);
    }
    const baseline = this.machine.baseline === null ? null : this.machine.baseline.metrics;
    const cue =
      result.kind === "scored" ? postureCue(result, this.config.scoring, baseline, mirrorSign(landmarks)) : null;
    const nudges = tr.nudge !== Nudge.NONE ? [tr.nudge] : [];
    if (tr.recovered && this.config.feedback.recovery_chime.enabled) nudges.push(Nudge.RECOVERY);
    const hold = this.machine.holdProgress(now);
    return { result, transition: tr, needle: this.needle.value, nudges, cue, hold };
  }

  /** Demo poses are synthetic: turn the drift baseline off while they run and
   *  back on for real tracking, re-anchoring to the recorded calibration. */
  setDriftBaselineEnabled(enabled) {
    const wasOff = this.machine.baseline === null;
    this.machine.setDriftBaselineEnabled(enabled);
    if (enabled && wasOff && this.machine.baseline !== null && this.calibration.calibration !== null) {
      this.machine.setBaselineAnchor(this.calibration.centroids.good);
    }
  }

  /** Resume after a user pause: start fresh as if the person just sat down
   *  (streaks, timers and the needle cleared, drift baseline back to the
   *  calibration anchor), so time spent paused can never fire a reminder.
   *  Calibration and the praise cooldown are kept. */
  restart() {
    this.machine.enterNoPerson();
    this.machine.absentSince = null;
    this.needle.reset();
  }
}
