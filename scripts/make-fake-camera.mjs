// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Writes a fake webcam feed (YUV4MPEG2) for Chromium's
// --use-file-for-fake-video-capture. The picture is a cartoon figure drawn
// from shapes in this file, so no photo of a real person is involved. No
// dependencies and no ffmpeg: pure Node.
//
//   node scripts/make-fake-camera.mjs <out.y4m> [--tilt-after SECONDS] [--seconds N]
//
// Default: 3 s of an upright figure. With --tilt-after 5 --seconds 12 the
// figure leans 12 degrees (head and shoulders drift sideways) after 5 s, so
// the app has something to say. Chromium loops the file.

import { writeFileSync } from "node:fs";

const W = 480, H = 640, FPS = 15;
const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith("--") ? args[0] : "person.y4m";
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const seconds = opt("--seconds", 3);
const tiltAfter = opt("--tilt-after", Infinity);

const ZOOM = 0.7;
const SKIN = [224, 172, 135], SKIN_SHADE = [205, 150, 115];
const SHIRT = [48, 92, 150], HAIR = [60, 40, 30], WALL = [196, 200, 205];

const dist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const inEllipse = (px, py, cx, cy, rx, ry) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;

// Colour of one point of the figure in figure coordinates (upright pose).
function figure(x, y) {
  if (inEllipse(x, y, 218, 222, 7, 9) || inEllipse(x, y, 262, 222, 7, 9)) return [35, 30, 30]; // eyes
  if (inEllipse(x, y, 217, 218, 3, 3) || inEllipse(x, y, 261, 218, 3, 3)) return [250, 250, 250];
  if (dist(x, y, 200, 200, 232, 196) < 3 || dist(x, y, 248, 196, 280, 200) < 3) return HAIR; // brows
  if (dist(x, y, 240, 225, 234, 262) < 3) return SKIN_SHADE; // nose bridge
  if (inEllipse(x, y, 240, 266, 10, 6)) return SKIN_SHADE; // nose tip
  if (y > 288 && y < 300 && inEllipse(x, y, 240, 288, 24, 12)) return [150, 70, 70]; // mouth
  if (inEllipse(x, y, 240, 232, 70, 90) && y < 175 && inEllipse(x, y, 240, 205, 78, 112)) return HAIR; // hair
  if (inEllipse(x, y, 240, 235, 70, 90)) return SKIN; // face
  if (inEllipse(x, y, 164, 232, 11, 22) || inEllipse(x, y, 316, 232, 11, 22)) return SKIN_SHADE; // ears
  if (inEllipse(x, y, 240, 215, 82, 112)) return HAIR; // hair outline behind the face
  if (dist(x, y, 240, 320, 240, 440) < 32) return SKIN_SHADE; // neck
  if (dist(x, y, 110, 540, 370, 540) < 80 && y > 470) return SHIRT; // shoulders
  if (dist(x, y, 70, 600, 60, 800) < 45 || dist(x, y, 410, 600, 420, 800) < 45) return SHIRT; // upper arms
  if (dist(x, y, 240, 440, 240, 470) < 34 && y > 445) return SKIN_SHADE; // collar
  if (x > 40 && x < 440 && y >= 520) return SHIRT; // torso
  return null;
}

function renderFrame(tiltDeg) {
  const a = (tiltDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const px = 240, py = 640; // pivot at the bottom centre of the frame
  const Y = new Uint8Array(W * H), U = new Uint8Array((W / 2) * (H / 2)), V = new Uint8Array((W / 2) * (H / 2));
  const SS = 2; // 2x2 supersampling for smooth edges
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = i + (sx + 0.5) / SS - px, y = j + (sy + 0.5) / SS - py;
          // inverse rotation into figure coordinates
          const fx = px + x * ca + y * sa, fy = py - x * sa + y * ca;
          // shrink the figure so the shoulders span about a third of the picture
          const c = figure(240 + (fx - 240) / ZOOM, 520 + (fy - 470) / ZOOM) ?? WALL;
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      r /= SS * SS; g /= SS * SS; b /= SS * SS;
      Y[j * W + i] = 0.299 * r + 0.587 * g + 0.114 * b;
      if (!(j & 1) && !(i & 1)) {
        const u = (j / 2) * (W / 2) + i / 2;
        U[u] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        V[u] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      }
    }
  }
  return Buffer.concat([Buffer.from("FRAME\n"), Buffer.from(Y), Buffer.from(U), Buffer.from(V)]);
}

const upright = renderFrame(0);
const tilted = Number.isFinite(tiltAfter) ? renderFrame(12) : null;
const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`)];
for (let f = 0; f < seconds * FPS; f++) parts.push(tilted && f / FPS >= tiltAfter ? tilted : upright);
writeFileSync(out, Buffer.concat(parts));
console.log(`wrote ${out}: ${W}x${H}, ${seconds}s`);
