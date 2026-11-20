// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
// Shared building blocks: fades, captions, recorded-footage clips, the figure.
import type React from "react";
import {
  AbsoluteFill,
  Html5Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { color, font } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0 -> 1 between two frames. */
export const ramp = (frame: number, from: number, to: number): number =>
  interpolate(frame, [from, to], [0, 1], clamp);

/** Fades its children in at the start and out at the end of the scene. */
export const Fade: React.FC<{ children: React.ReactNode; inFrames?: number; outFrames?: number }> = ({
  children,
  inFrames = 10,
  outFrames = 10,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = Math.min(
    ramp(frame, 0, inFrames),
    1 - ramp(frame, durationInFrames - outFrames, durationInFrames),
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** Springs up from below, starting at `delay` frames. */
export const Rise: React.FC<{ children: React.ReactNode; delay?: number; style?: React.CSSProperties }> = ({
  children,
  delay = 0,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return (
    <div style={{ opacity: t, transform: `translateY(${(1 - t) * 40}px)`, ...style }}>{children}</div>
  );
};

export const Background: React.FC<{ glow?: string }> = ({ glow = color.good }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at 50% 35%, ${glow}22 0%, ${color.bg} 60%)`,
      fontFamily: font,
    }}
  />
);

/** Bottom caption bar over footage. */
export const Caption: React.FC<{ children: React.ReactNode; accent?: string }> = ({
  children,
  accent = color.warn,
}) => (
  <div
    style={{
      position: "absolute",
      left: 120,
      right: 120,
      bottom: 54,
      padding: "22px 36px",
      background: "rgba(13, 15, 19, 0.88)",
      borderLeft: `8px solid ${accent}`,
      borderRadius: 14,
      color: color.text,
      fontFamily: font,
      fontSize: 44,
      lineHeight: 1.3,
    }}
  >
    {children}
  </div>
);

/** A stretch of recorded footage, centered and framed, starting `fromSec` into
 *  the source file. Plays for the length of the enclosing scene. */
export const Clip: React.FC<{ src: string; fromSec: number; dim?: number }> = ({ src, fromSec, dim = 0 }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", top: -60 }}>
      <div
        style={{
          width: 1280 * 1.15,
          height: 800 * 1.15,
          borderRadius: 18,
          overflow: "hidden",
          border: `2px solid ${color.line}`,
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
          position: "relative",
        }}
      >
        <OffthreadVideo
          src={staticFile(src)}
          trimBefore={Math.max(0, Math.round(fromSec * fps))}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        {dim > 0 ? <AbsoluteFill style={{ background: `rgba(13,15,19,${dim})` }} /> : null}
      </div>
    </AbsoluteFill>
  );
};

/** Plays a sound from public/audio at `atSec` into the scene. */
export const Sound: React.FC<{ file: string; atSec: number; volume?: number }> = ({
  file,
  atSec,
  volume = 1,
}) => {
  const { fps } = useVideoConfig();
  return (
    <Sequence from={Math.max(0, Math.round(atSec * fps))} layout="none">
      <Html5Audio src={staticFile(`audio/${file}`)} volume={volume} />
    </Sequence>
  );
};

/** The patient: a stick figure in the app's skeleton style. slouch 0..1 drifts
 *  the head forward and down; bolts adds Frankenstein neck bolts. */
export const Figure: React.FC<{
  slouch?: number;
  stroke?: string;
  bolts?: boolean;
  highlight?: { x: number; y: number; r: number } | null;
  size?: number;
}> = ({ slouch = 0, stroke = color.good, bolts = false, highlight = null, size = 600 }) => {
  const headX = 200 + slouch * 70;
  const headY = 130 + slouch * 55;
  return (
    <svg width={size * (400 / 600)} height={size} viewBox="0 0 400 600">
      {highlight ? (
        <circle cx={highlight.x} cy={highlight.y} r={highlight.r} fill={`${color.warn}33`} stroke={color.warn} strokeWidth={4} />
      ) : null}
      <g stroke={stroke} strokeWidth={10} strokeLinecap="round" fill="none">
        <circle cx={headX} cy={headY} r={58} />
        <line x1={headX - 6} y1={headY + 58} x2={200} y2={240} />
        <line x1={110} y1={250} x2={290} y2={250} />
        <line x1={200} y1={250} x2={200} y2={430} />
        <line x1={140} y1={430} x2={260} y2={430} />
        <line x1={110} y1={250} x2={80} y2={400} />
        <line x1={290} y1={250} x2={320} y2={400} />
        <line x1={160} y1={430} x2={150} y2={570} />
        <line x1={240} y1={430} x2={250} y2={570} />
      </g>
      {[110, 290, 140, 260].map((x, i) => (
        <circle key={x} cx={x} cy={i < 2 ? 250 : 430} r={11} fill={stroke} />
      ))}
      {bolts ? (
        <g fill="#9aa3ad" stroke="#555c66" strokeWidth={3}>
          <rect x={headX - 92} y={headY + 18} width={34} height={18} rx={4} />
          <rect x={headX + 58} y={headY + 18} width={34} height={18} rx={4} />
        </g>
      ) : null}
      {bolts ? (
        <g stroke="#555c66" strokeWidth={4}>
          {[-30, -10, 10, 30].map((dx) => (
            <line key={dx} x1={headX + dx} y1={headY - 52} x2={headX + dx} y2={headY - 38} />
          ))}
          <line x1={headX - 38} y1={headY - 45} x2={headX + 38} y2={headY - 45} />
        </g>
      ) : null}
    </svg>
  );
};
