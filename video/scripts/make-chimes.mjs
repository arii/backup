// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Writes the app's two chimes as 16-bit mono WAVs for the demo video:
// public/audio/chime.wav (reminder) and public/audio/positive.wav (praise).
// Notes, durations and harmonics match docs/app/app.js. Run from video/.
import { mkdirSync, writeFileSync } from "node:fs";

const RATE = 44100;

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.trunc(s * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

function notes(list, harmonics) {
  const peak = Math.max(...Array.from({ length: 1000 }, (_, j) =>
    Math.abs(harmonics.reduce((s, [k, a]) => s + a * Math.sin((k * 2 * Math.PI * j) / 1000), 0))));
  const out = [];
  for (const [freq, seconds] of list) {
    const total = Math.floor(RATE * seconds);
    for (let i = 0; i < total; i += 1) {
      const phase = (2 * Math.PI * freq * i) / RATE;
      const sum = harmonics.reduce((s, [k, a]) => s + a * Math.sin(k * phase), 0);
      out.push((0.6 * Math.exp((-3 * i) / total) * sum) / peak);
    }
  }
  return out;
}

mkdirSync("public/audio", { recursive: true });
// Reminder: E5 then B-flat 4, reedy odd harmonics.
writeFileSync("public/audio/chime.wav", wav(notes([[659.25, 0.18], [466.16, 0.42]], [[1, 1], [3, 0.35], [5, 0.15]])));
// Praise: rising C major arpeggio of pure sines.
writeFileSync("public/audio/positive.wav", wav(notes(
  [[523.25, 0.2], [659.25, 0.2], [783.99, 0.2], [1046.5, 0.2]], [[1, 1]])));
