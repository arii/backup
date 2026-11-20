// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// Pure logic behind the compact live views (skeleton and needle) in the
// practice and "Not working?" panels. Kept free of DOM access so it can be
// unit tested under node; app.js does the drawing.

/** Needle value in [-1, 1] to an SVG rotate() transform about the dial centre (100, 100). */
export function needleTransform(needle) {
  return `rotate(${((needle + 1) * 90).toFixed(1)} 100 100)`;
}

/**
 * Which mini views to draw this frame. `needle === null` marks the silent
 * test, when the mini views stay frozen. Each view is drawn only while its
 * panel is open: `open` maps a view name ("practice", "setup") to a boolean.
 */
export function miniViewsToDraw(names, open, needle) {
  if (needle === null || needle === undefined) return [];
  return names.filter((name) => !!open[name]);
}

/** Line and dot scale for the mini canvases, relative to the main view. */
export const MINI_SCALE = 0.6;
