// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Pure gauge maths: which zone a frame is in, and the needle angle, label and
// skeleton colour that go with it. Kept free of DOM access so it can be unit
// tested under node; app.js does the drawing.

import { State } from "./posture-core.js";

/** The dial's arcs in index.html, in needle degrees (0 = far left). */
export const ZONE_DEGREES = Object.freeze({
  good: [0, 60],
  drift: [60, 120],
  bad: [120, 180],
});
const INSET_DEG = 4; // keep the needle off the arc boundaries, so the zone is never ambiguous

/** Skeleton colours, the same as the dial arcs. */
export const ZONE_COLOR = Object.freeze({
  good: "#4cc36a",
  drift: "#ffb340",
  bad: "#ff5c5c",
  none: "#8b95a3",
});

const LABEL = Object.freeze({ good: "upright", drift: "drifting", bad: "slouching" });

/**
 * One zone per frame, so the needle, the label and the skeleton always agree (#97).
 * The zone follows the state machine: a reminder state is "bad" even if only one metric
 * is past its threshold, and stays "bad" until recovery is confirmed. Good posture with a
 * cue (a metric past its exit band, against the threshold or the drift baseline) is "drift".
 * Anything else that is scored (settling in) is "drift" too; unscored frames have no zone.
 */
export function gaugeZone(state, scored, drifting) {
  if (state === State.BAD_CHIME || state === State.BAD_VOICE) return "bad";
  if (!scored) return "none";
  if (state === State.GOOD && !drifting) return "good";
  return "drift";
}

/**
 * The needle's angle in degrees: the engine's needle value mapped inside the zone's arc,
 * so it still moves with posture but never leaves the arc its label names.
 */
export function zoneAngle(zone, needle) {
  const [lo, hi] = ZONE_DEGREES[zone] || [0, 180];
  const f = Math.min(1, Math.max(0, (needle + 1) / 2));
  if (!ZONE_DEGREES[zone]) return lo + f * (hi - lo);
  return lo + INSET_DEG + f * (hi - lo - 2 * INSET_DEG);
}

/** Zone of a needle angle on the dial, for checks. */
export function zoneOfAngle(deg) {
  if (deg < ZONE_DEGREES.good[1]) return "good";
  if (deg < ZONE_DEGREES.drift[1]) return "drift";
  return "bad";
}

/** Label, angle and colour for a frame. */
export function gaugeView(state, scored, drifting, needle) {
  const zone = gaugeZone(state, scored, drifting);
  return {
    zone,
    label: LABEL[zone] ?? null,
    angle: needle === null || needle === undefined ? null : zoneAngle(zone, needle),
    color: ZONE_COLOR[zone],
  };
}

/** SVG rotate() about the dial centre (100, 100) for an angle in degrees. */
export function angleTransform(deg) {
  return `rotate(${deg.toFixed(1)} 100 100)`;
}
