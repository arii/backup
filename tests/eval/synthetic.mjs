// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// SYNTHETIC labeled sessions for the accuracy eval. No person, video or image is involved:
// a simulated upper body is placed in a simulated camera view, moved through scripted good
// and slouching segments, and sampled with noise, dropped frames and NaN glitches. The
// output is fully determined by SEED (seeded RNG, never the platform RNG), so a rerun is
// byte-identical. Numbers measured on this data check the harness; they are not an
// accuracy claim about real people. Angles are defined in the engine's normalized image
// space (x and y each 0..1), the space posture-core.js measures in.

import { SCHEMA_VERSION } from "./schema.mjs";

const SEED = 113;
export const BODY_COUNT = 8;
const GENERATOR = "synthetic-generator@1";
const FRAME_SIZE = { width: 640, height: 480 };
const CAL_END_S = 4.0; // frames before this belong to the calibration phase
const RAD = Math.PI / 180;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = mulberry32(seed);
  const rng = {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    sign: () => (next() < 0.5 ? -1 : 1),
    gauss() {
      const u = Math.max(next(), 1e-12);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
  };
  return rng;
}

const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

// How far a scripted slouch moves each metric, in degrees, and which metrics a body can show.
const SLOUCH_RANGE = { head_forward: [10, 20], head_tilt: [10, 18], shoulder_level: [7.5, 13], trunk_lean: [9, 16] };
const METRIC_INDEX = { head_forward: 0, head_tilt: 1, shoulder_level: 2, trunk_lean: 3 };

function makeBody(i) {
  const rng = makeRng(SEED * 1000 + i);
  const hipsInFrame = i % 4 !== 3;
  const dim = i % 3 === 2;
  const fps = [2, 3, 5][i % 3];
  const shoulderMid = [rng.range(0.42, 0.58), hipsInFrame ? rng.range(0.34, 0.46) : rng.range(0.55, 0.68)];
  const yaw = rng.range(-25, 25) * RAD;
  const width = rng.range(0.24, 0.4) * Math.cos(yaw);
  const sigma = dim ? rng.range(0.004, 0.006) : rng.range(0.0015, 0.0035);
  return {
    index: i,
    hipsInFrame,
    dim,
    fps,
    shoulderMid,
    width,
    torso: rng.range(0.3, 0.42),
    neck: rng.range(0.14, 0.22),
    earWidth: width * rng.range(0.4, 0.55),
    roll: rng.range(-4, 4) * RAD, // camera tilt, in-plane
    natural: [0, 1, 2, 3].map(() => rng.range(-2.5, 2.5)), // this person's own comfortable offsets
    drift: [0, 1, 2, 3].map(() => ({ amp: rng.range(0.6, 1.4), period: rng.range(7, 19), phase: rng.range(0, 6.28) })),
    sigma,
    visMean: dim ? 0.72 : 0.95,
    visSd: dim ? 0.14 : 0.03,
    dropP: dim ? 0.05 : 0.02,
    nanP: 0.01,
    outage: dim ? [rng.range(12, 25), rng.range(0.6, 1.4)] : null,
    earBias: [0, 1, 2, 3].map(() => rng.range(-0.006, 0.006)), // MoveNet-only systematic ear error
  };
}

/** The scripted post-calibration timeline: good, then a slouch per metric with good in between. */
function makeScript(body) {
  const rng = makeRng(SEED * 2000 + body.index);
  const metrics = Object.keys(METRIC_INDEX).filter((m) => body.hipsInFrame || m !== "trunk_lean");
  for (let k = metrics.length - 1; k > 0; k--) {
    const j = Math.floor(rng.next() * (k + 1));
    [metrics[k], metrics[j]] = [metrics[j], metrics[k]];
  }
  const plan = [{ label: "good", len: 4, vec: [0, 0, 0, 0] }];
  metrics.forEach((m) => {
    const [lo, hi] = SLOUCH_RANGE[m];
    const vec = [0, 0, 0, 0];
    vec[METRIC_INDEX[m]] = rng.sign() * rng.range(lo, hi);
    plan.push({ label: "slouch", metrics: [m], len: 6, vec });
    const calm = [0, 0, 0, 0];
    // Some good stretches carry a small offset that is still good posture.
    if (rng.next() < 0.5) calm[Math.floor(rng.next() * 4)] = rng.sign() * rng.range(2.5, 4);
    if (!body.hipsInFrame) calm[3] = 0;
    plan.push({ label: "good", len: 4, vec: calm });
  });
  const ramp = 1.0;
  const segments = [];
  const labels = [];
  let t = CAL_END_S;
  plan.forEach((p, i) => {
    if (i > 0) {
      segments.push({ start: t, end: t + ramp, from: plan[i - 1].vec, to: p.vec });
      labels.push({ start_s: round(t, 3), end_s: round(t + ramp, 3), label: "ignore" });
      t += ramp;
    }
    segments.push({ start: t, end: t + p.len, vec: p.vec });
    const seg = { start_s: round(t, 3), end_s: round(t + p.len, 3), label: p.label };
    if (p.metrics) seg.metrics = p.metrics;
    labels.push(seg);
    t += p.len;
  });
  return { segments, labels, end: t };
}

/** Offsets (deg) the scripted movement adds to [head_forward, head_tilt, shoulder_level, trunk_lean]. */
function scriptOffset(script, t) {
  for (const s of script.segments) {
    if (t < s.start || t >= s.end) continue;
    if (s.vec) return s.vec;
    const k = smoothstep((t - s.start) / (s.end - s.start));
    return s.from.map((a, i) => a + (s.to[i] - a) * k);
  }
  return [0, 0, 0, 0];
}

/** What a person saving a posture while already moving into a slouch looks like. */
function calibrationOffset(leg, t, target) {
  if (leg === "comfortable") return [0, 0, 0, 0];
  const rise = smoothstep((t - 0.5) / 2.0);
  const fall = smoothstep((t - 3.2) / 0.8);
  return target.map((v) => v * rise * (1 - fall));
}

/** The six tracked points (normalized image space) for the given metric angles in degrees. */
function bodyPoints(body, deg, t) {
  const [hf, tilt, sh, lean] = deg.map((d, i) => {
    const d0 = body.drift[i];
    return (d + body.natural[i] + d0.amp * Math.sin((2 * Math.PI * t) / d0.period + d0.phase)) * RAD;
  });
  const [cx, cy] = body.shoulderMid;
  const half = body.width / 2;
  const left = [cx - half * Math.cos(sh), cy - half * Math.sin(sh)];
  const right = [cx + half * Math.cos(sh), cy + half * Math.sin(sh)];
  const earMid = [cx + body.neck * Math.sin(hf), cy - body.neck * Math.cos(hf)];
  const eh = body.earWidth / 2;
  const ea = sh - tilt; // the engine measures tilt as shoulder-line angle minus ear-line angle
  const earL = [earMid[0] - eh * Math.cos(ea), earMid[1] - eh * Math.sin(ea)];
  const earR = [earMid[0] + eh * Math.cos(ea), earMid[1] + eh * Math.sin(ea)];
  const hipMid = [cx - body.torso * Math.sin(lean), cy + body.torso * Math.cos(lean)];
  const hh = body.width * 0.425;
  const hipL = [hipMid[0] - hh, hipMid[1]];
  const hipR = [hipMid[0] + hh, hipMid[1]];
  const cos = Math.cos(body.roll);
  const sin = Math.sin(body.roll);
  return [earL, earR, left, right, hipL, hipR].map(([x, y]) => [
    0.5 + cos * (x - 0.5) - sin * (y - 0.5),
    0.5 + sin * (x - 0.5) + cos * (y - 0.5),
  ]);
}

/** Frame times: base rate with +-25% jitter. Same for both calibration legs. */
function frameTimes(body, endS) {
  const rng = makeRng(SEED * 3000 + body.index);
  const times = [];
  let t = 0;
  while (t < endS) {
    times.push(round(t, 3));
    t += (1 / body.fps) * (1 + rng.range(-0.25, 0.25));
  }
  return times;
}

/** Draws a fixed number of random values per frame, so the noise does not depend on the leg. */
function observe(body, path, pts, t, rng, inCalibration) {
  const draws = Array.from({ length: 24 }, () => rng.gauss());
  const uniform = [rng.next(), rng.next(), rng.next()];
  const dropped = inCalibration ? false : uniform[0] < body.dropP;
  const outage = body.outage !== null && t >= body.outage[0] && t < body.outage[0] + body.outage[1] && !inCalibration;
  if (dropped || outage) return null;
  const movenet = path === "movenet";
  const scale = movenet ? 2.5 : 1;
  const nanSlot = uniform[1] < body.nanP && !inCalibration ? Math.floor(uniform[2] * 8) : -1; // ears, shoulders: x/y
  const values = [];
  pts.forEach(([x, y], i) => {
    const isHip = i >= 4;
    const bias = movenet && i < 2 ? [body.earBias[i * 2], body.earBias[i * 2 + 1]] : [0, 0];
    const nx = x + bias[0] + draws[i * 4] * body.sigma * scale;
    const ny = y + bias[1] + draws[i * 4 + 1] * body.sigma * scale;
    let conf;
    if (movenet) {
      const base = isHip ? (body.hipsInFrame ? 0.5 : 0.1) : i < 2 ? (body.dim ? 0.55 : 0.75) : 0.85;
      const sd = isHip ? 0.2 : i < 2 ? (body.dim ? 0.2 : 0.15) : 0.08;
      conf = base + draws[i * 4 + 2] * sd;
      if (!body.hipsInFrame && isHip) conf = Math.min(conf, 0.25);
    } else {
      conf = body.visMean + draws[i * 4 + 2] * body.visSd;
      if (!body.hipsInFrame && isHip) conf = Math.min(conf, 0.3);
    }
    if (inCalibration && !isHip) conf = Math.max(conf, movenet ? 0.7 : 0.85); // a still, lit save
    const px = movenet ? [nx * FRAME_SIZE.width, ny * FRAME_SIZE.height] : [nx, ny];
    const dp = movenet ? 0 : 3;
    values.push(nanSlot === i * 2 ? null : round(px[0], dp), nanSlot === i * 2 + 1 ? null : round(px[1], dp));
    values.push(round(clamp01(conf), 2));
  });
  return values;
}

function buildSession(body, path, leg) {
  const script = makeScript(body);
  const times = frameTimes(body, script.end);
  const noise = makeRng(SEED * 4000 + body.index * 2 + (path === "movenet" ? 1 : 0));
  const calRng = makeRng(SEED * 5000 + body.index);
  const target = [0, 1, 2, 3].map((i) => {
    const m = Object.keys(METRIC_INDEX)[i];
    const [lo, hi] = SLOUCH_RANGE[m];
    return calRng.sign() * calRng.range(lo, hi) * calRng.range(0.5, 1.0) * (i === 3 && !body.hipsInFrame ? 0 : 1);
  });
  const frames = times.map((t) => {
    const inCal = t < CAL_END_S;
    const off = inCal ? calibrationOffset(leg, t, target) : scriptOffset(script, t);
    return [t, observe(body, path, bodyPoints(body, off, t), t, noise, inCal)];
  });
  const nn = String(body.index).padStart(2, "0");
  return {
    schema_version: SCHEMA_VERSION,
    id: `syn-${path}-${nn}-${leg}`,
    synthetic: true,
    source: GENERATOR,
    consent: null,
    path,
    ...(path === "movenet" ? { frame_size: FRAME_SIZE } : {}),
    scene: {
      lighting: body.dim ? "dim" : "normal",
      fps: body.fps,
      hips_in_frame: body.hipsInFrame,
      camera_roll_deg: round(body.roll / RAD, 2),
    },
    calibration: { kind: "good", start_s: 0, leg },
    labels: script.labels,
    frames,
  };
}

/** Every synthetic session, as [file name, JSON text]. Deterministic: same text on every run. */
export function generateFiles() {
  const files = [];
  for (let i = 0; i < BODY_COUNT; i++) {
    const body = makeBody(i);
    for (const path of ["mediapipe", "movenet"]) {
      for (const leg of ["comfortable", "mid_movement"]) {
        const session = buildSession(body, path, leg);
        files.push([`${session.id}.json`, `${JSON.stringify(session)}\n`]);
      }
    }
  }
  return files;
}
