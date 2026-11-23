// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Pure needle maths for the posture gauge. Kept free of DOM access so it can be
// unit tested under node; app.js does the drawing. (The compact "mini views" that
// used to copy the skeleton and needle were removed in #90 and #92.)

/** Needle value in [-1, 1] to an SVG rotate() transform about the dial centre (100, 100). */
export function needleTransform(needle) {
  return `rotate(${((needle + 1) * 90).toFixed(1)} 100 100)`;
}
