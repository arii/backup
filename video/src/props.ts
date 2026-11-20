// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
// Props for the demo video. scripts/capture.mjs writes the real values to
// public/capture.json (times are seconds into each recorded clip); the
// defaults below are only for previewing in Remotion Studio.

export type DemoMarks = {
  src: string;
  good: number; // badge first reads "good posture"
  chime: number; // first reminder (chime + "What to fix")
  voice: number; // second reminder (spoken)
  recovered: number; // back to good posture
  end: number;
  cue: string; // "What to fix" title at the voice reminder, e.g. "Head forward"
  fix: string; // its advice text
};

export type WebcamMarks = {
  src: string;
  live: number; // model loaded, tracking
  reminder: number | null; // first reminder, if the tilted photo triggered one
  cue: string;
  end: number;
};

export type LandingMarks = { src: string; start: number; end: number };

export type VideoProps = {
  demo: DemoMarks;
  webcam: WebcamMarks | null;
  landing: LandingMarks;
  // Optional: your own webcam recording, placed in public/ (e.g. "user-webcam.mp4").
  userClip: string | null;
  userClipSeconds: number;
};

export const defaultProps: VideoProps = {
  demo: {
    src: "footage/demo.webm",
    good: 2.5,
    chime: 24,
    voice: 34,
    recovered: 45,
    end: 48,
    cue: "Head forward",
    fix: "Tuck your chin and bring your ears back over your shoulders.",
  },
  webcam: {
    src: "footage/webcam.webm",
    live: 6,
    reminder: null,
    cue: "Looking good",
    end: 20,
  },
  landing: { src: "footage/landing.webm", start: 1.5, end: 12 },
  userClip: null,
  userClipSeconds: 0,
};
