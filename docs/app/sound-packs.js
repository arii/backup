// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
//
// Optional "Spooky" sound pack, playing up the "Posture to Die For" tagline.
// The clean chimes in app.js stay the default. Everything is synthesized
// with Web Audio, so there are no sound files to license or download.
//
//   bad:  "the Reaper" - a low funeral bell struck twice (inharmonic bell
//         partials, long decay), so a slouch sounds ominous, not cheerful.
//   good: "the ghost"  - a soft theremin-like glide upward with vibrato.

// Bell partial ratios and levels (a classic minor-third "hum, prime, tierce"
// church-bell spectrum). Inharmonic, so it needs one oscillator per partial.
const BELL = [
  [0.5, 0.5],
  [1, 1],
  [1.19, 0.6],
  [1.56, 0.35],
  [2, 0.3],
  [2.51, 0.18],
  [3.01, 0.1],
];

function bellStrike(ac, out, base, at, dur) {
  const total = BELL.reduce((a, [, amp]) => a + amp, 0);
  for (const [ratio, amp] of BELL) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = base * ratio;
    // Higher partials die faster, like a real bell.
    const decay = dur / (0.6 + ratio * 0.5);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime((0.55 * amp) / total, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

function reaper(ac) {
  const t = ac.currentTime + 0.02;
  const out = ac.createGain();
  out.gain.value = 0.9;
  out.connect(ac.destination);
  bellStrike(ac, out, 196.0, t, 1.6); // G3
  bellStrike(ac, out, 185.0, t + 0.55, 2.0); // a semitone lower: the toll sags
}

function ghost(ac) {
  const t = ac.currentTime + 0.02;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const lfo = ac.createOscillator();
  const lfoDepth = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(392, t); // G4
  osc.frequency.exponentialRampToValueAtTime(784, t + 0.75); // up an octave
  lfo.frequency.value = 6;
  lfoDepth.gain.setValueAtTime(0, t);
  lfoDepth.gain.linearRampToValueAtTime(14, t + 0.4); // vibrato grows in, theremin style
  lfo.connect(lfoDepth).connect(osc.frequency);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.35, t + 0.18);
  gain.gain.setValueAtTime(0.35, t + 0.75);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
  osc.connect(gain).connect(ac.destination);
  for (const node of [osc, lfo]) {
    node.start(t);
    node.stop(t + 1.35);
  }
}

export const SOUND_PACKS = {
  clean: "Clean (default)",
  spooky: "Spooky: Reaper bell and ghost",
};

/** Plays the spooky sound for kind "bad" or "good" on the given AudioContext. */
export function playSpooky(ac, kind) {
  if (kind === "bad") reaper(ac);
  else ghost(ac);
}
