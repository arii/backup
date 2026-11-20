// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
// Every scene of the demo video. Footage scenes cut the recorded clips at the
// timestamps scripts/capture.mjs measured on the live site.
import type React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Background, Caption, Clip, Fade, Figure, Rise, Sound, ramp } from "./components";
import type { VideoProps } from "./props";
import { color, font, mono } from "./theme";

const center: React.CSSProperties = {
  alignItems: "center",
  justifyContent: "center",
  fontFamily: font,
  color: color.text,
  textAlign: "center",
};

// -- 1. Cold open -----------------------------------------------------------------

export const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slouch = ramp(frame, 0, 3 * fps);
  return (
    <Fade>
      <Background glow={color.bad} />
      <AbsoluteFill style={{ ...center, flexDirection: "row", gap: 120 }}>
        <Figure slouch={slouch} stroke={slouch > 0.6 ? color.bad : color.good} size={560} />
        <div style={{ textAlign: "left" }}>
          <Rise delay={8}>
            <div style={{ fontSize: 130, fontWeight: 800, lineHeight: 1.05 }}>
              Posture
              <br />
              to die for.
            </div>
          </Rise>
          <Rise delay={2.4 * fps}>
            <div style={{ fontSize: 60, color: color.warn, marginTop: 30 }}>(Please don&rsquo;t.)</div>
          </Rise>
        </div>
      </AbsoluteFill>
    </Fade>
  );
};

// -- 2. Ailments ------------------------------------------------------------------

const AILMENTS = [
  ["Tech neck", "Your ears have wandered ahead of your shoulders."],
  ["The puzzled dog", "Head tilted toward one shoulder."],
  ["The one-elbow lean", "One shoulder dropped, an hour at a time."],
  ["The Leaning Tower of Pisa", "Your whole torso, listing sideways."],
] as const;

export const Ailments: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <Fade>
      <Background glow={color.warn} />
      <AbsoluteFill style={{ ...center, gap: 34 }}>
        <Rise>
          <div style={{ fontSize: 64, fontWeight: 700, marginBottom: 20 }}>
            Common afflictions of the <span style={{ color: color.warn }}>desk-bound</span>
          </div>
        </Rise>
        {AILMENTS.map(([name, desc], i) => (
          <Rise key={name} delay={Math.round((0.8 + i * 1.6) * fps)}>
            <div
              style={{
                width: 1300,
                display: "flex",
                gap: 40,
                alignItems: "baseline",
                background: color.panel,
                border: `2px solid ${color.line}`,
                borderRadius: 16,
                padding: "22px 36px",
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: 48, fontWeight: 700, color: color.warn, minWidth: 560 }}>{name}</div>
              <div style={{ fontSize: 36, color: color.muted }}>{desc}</div>
            </div>
          </Rise>
        ))}
      </AbsoluteFill>
    </Fade>
  );
};

// -- 3. Demo footage --------------------------------------------------------------

const FootageScene: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Fade inFrames={6} outFrames={6}>
    <Background />
    {children}
  </Fade>
);

export const DemoUpright: React.FC<{ p: VideoProps }> = ({ p }) => (
  <FootageScene>
    <Clip src={p.demo.src} fromSec={p.demo.good - 0.5} />
    <Caption accent={color.good}>Sit up straight: the needle rests in the green.</Caption>
  </FootageScene>
);

export const DemoSlouch: React.FC<{ p: VideoProps }> = ({ p }) => {
  const lead = 3.5; // seconds of slouching shown before the reminder fires
  return (
    <FootageScene>
      <Clip src={p.demo.src} fromSec={p.demo.chime - lead} />
      <Sound file="chime.wav" atSec={lead} />
      <Caption>
        Slouch for two seconds and it chimes, then says what&rsquo;s wrong:{" "}
        <b style={{ color: color.warn }}>{p.demo.cue}.</b>
      </Caption>
    </FootageScene>
  );
};

export const DemoVoice: React.FC<{ p: VideoProps }> = ({ p }) => (
  <FootageScene>
    <Clip src={p.demo.src} fromSec={p.demo.voice - 0.8} />
    <Sound file="cue.wav" atSec={0.8} />
    <Caption>
        Keep slouching and it speaks up: <i>&ldquo;{p.demo.cue}. {p.demo.fix}&rdquo;</i>
    </Caption>
  </FootageScene>
);

export const DemoRecover: React.FC<{ p: VideoProps }> = ({ p }) => (
  <FootageScene>
    <Clip src={p.demo.src} fromSec={p.demo.recovered - 2} />
    <Sound file="positive.wav" atSec={2} />
    <Caption accent={color.good}>Sit back up: a reward chime. Spines respond to praise.</Caption>
  </FootageScene>
);

export const UserClip: React.FC<{ p: VideoProps }> = ({ p }) =>
  p.userClip ? (
    <FootageScene>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <OffthreadVideo src={staticFile(p.userClip)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </AbsoluteFill>
    </FootageScene>
  ) : null;

export const Webcam: React.FC<{ p: VideoProps }> = ({ p }) => {
  const w = p.webcam;
  if (!w) return null;
  const from = Math.max(0, w.live - 0.5);
  const remindAt = w.reminder === null ? null : w.reminder - from;
  return (
    <FootageScene>
      <Clip src={w.src} fromSec={from} />
      {remindAt !== null && remindAt >= 0 && remindAt < 10 ? <Sound file="chime.wav" atSec={remindAt} /> : null}
      <Caption accent={color.good}>
        The real pose model on a drawn stand-in. Tilt it and it notices
        {w.reminder !== null ? (
          <>
            : <b style={{ color: color.warn }}>{w.cue}.</b>
          </>
        ) : (
          "."
        )}{" "}
        <span style={{ color: color.muted, fontSize: 30 }}>
          (A MediaPipe sample photo, fed in as a fake webcam and tilted 12&deg;. Paperwork: Apache-2.0.)
        </span>
      </Caption>
    </FootageScene>
  );
};

// -- 4. The monster ---------------------------------------------------------------

const PARTS: { name: string; donor: string; job: string; spot: { x: number; y: number; r: number } }[] = [
  { name: "Eyes", donor: "Google MediaPipe Pose, compiled to WebAssembly", job: "33 body landmarks per frame from an ordinary webcam", spot: { x: 200, y: 130, r: 75 } },
  { name: "Brain", donor: "posture-core.js: scoring, state machine, needle, calibration", job: "Decides when you're slouching and what to say", spot: { x: 200, y: 95, r: 55 } },
  { name: "Reflexes", donor: "Cue engine and slow drift baseline", job: "Names the one thing to fix, and notices a slow slump", spot: { x: 200, y: 130, r: 95 } },
  { name: "Spinal cord", donor: "A 632-frame golden timeline", job: "Recorded once, replayed by Node on every change: every frame must match", spot: { x: 200, y: 340, r: 110 } },
  { name: "Voice", donor: "Web Audio + speech synthesis", job: "The chime, then \u201cHead forward. Tuck your chin\u2026\u201d", spot: { x: 200, y: 160, r: 45 } },
  { name: "Heartbeat", donor: "A Web Worker timer", job: "Keeps it ticking after the browser throttles a background tab", spot: { x: 230, y: 290, r: 45 } },
  { name: "Memory", donor: "localStorage", job: "Your calibration, settings and daily totals", spot: { x: 150, y: 110, r: 45 } },
  { name: "Immune system", donor: "node:test property tests", job: "Seeded properties throw NaNs, mirrors and jitter at the core", spot: { x: 200, y: 330, r: 200 } },
];
const PART_SEC = 3.25;

export const Monster: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const idx = Math.min(PARTS.length - 1, Math.floor(frame / (PART_SEC * fps)));
  const partStart = Math.round(idx * PART_SEC * fps);
  const part = PARTS[idx];
  const boltAt = Math.round(PARTS.length * PART_SEC * fps);
  const alive = frame >= boltAt;
  const flash = alive ? 1 - ramp(frame, boltAt, boltAt + 12) : 0;
  const shake = alive && frame < boltAt + 12 ? Math.sin(frame * 3) * 12 : 0;
  return (
    <Fade outFrames={12}>
      <Background glow={alive ? color.bolt : color.good} />
      <AbsoluteFill style={{ ...center, flexDirection: "row", gap: 110, transform: `translateX(${shake}px)` }}>
        <Figure bolts highlight={alive ? null : part.spot} stroke={alive ? color.bolt : color.good} size={680} />
        <div style={{ width: 960, textAlign: "left" }}>
          <div style={{ fontSize: 34, letterSpacing: 6, color: color.muted, textTransform: "uppercase" }}>
            Frankenstein: the anatomy
          </div>
          {alive ? (
            <Rise delay={boltAt + 4}>
              <div style={{ fontSize: 150, fontWeight: 900, color: color.bolt, marginTop: 20 }}>It&rsquo;s alive.</div>
              <div style={{ fontSize: 44, color: color.text, marginTop: 20 }}>
                The lightning: <b>Kiro</b> specs, steering and hooks.
              </div>
              <div style={{ fontSize: 34, color: color.muted, marginTop: 14 }}>
                Unlike its namesake, it sits up straight.
              </div>
            </Rise>
          ) : (
            <div key={idx} style={{ opacity: ramp(frame, partStart, partStart + 8) }}>
              <div style={{ fontSize: 120, fontWeight: 800, color: color.warn, marginTop: 16 }}>{part.name}</div>
              <div style={{ fontSize: 42, marginTop: 18 }}>
                <span style={{ color: color.muted }}>Donor: </span>
                {part.donor}
              </div>
              <div style={{ fontSize: 38, color: color.muted, marginTop: 18 }}>{part.job}</div>
              <div style={{ fontSize: 26, color: color.muted, marginTop: 40, fontFamily: mono }}>
                part {idx + 1} of {PARTS.length}
              </div>
            </div>
          )}
        </div>
      </AbsoluteFill>
      {flash > 0 ? <AbsoluteFill style={{ background: color.bolt, opacity: flash * 0.85 }} /> : null}
    </Fade>
  );
};

// -- 5. Proof ---------------------------------------------------------------------

const STATS = [
  ["632 frames", "Replayed through the core on every change. Zero disagreements."],
  ["7 properties", "Seeded tests throw NaNs, mirrors and jitter at it."],
  ["11 live checks", "Playwright visits the deployed site and makes sure a person is found."],
] as const;

const KIRO_TREE = [
  ".kiro/",
  "  specs/posture-guard/requirements.md   9 EARS requirement groups",
  "  specs/posture-guard/design.md         7 correctness properties",
  "  specs/posture-guard/tasks.md          12 tasks, all checked",
  "  steering/architecture.md              the house rules",
  "  hooks/node-tests-on-change.json       tests on every save",
];

export const Proof: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <Fade>
      <Background />
      <AbsoluteFill style={{ ...center, gap: 26 }}>
        <Rise>
          <div style={{ fontSize: 60, fontWeight: 700 }}>How we know the stitches hold</div>
        </Rise>
        <div style={{ display: "flex", gap: 30 }}>
          {STATS.map(([big, small], i) => (
            <Rise key={big} delay={Math.round((0.5 + i * 0.8) * fps)}>
              <div
                style={{
                  width: 540,
                  minHeight: 230,
                  background: color.panel,
                  border: `2px solid ${color.line}`,
                  borderRadius: 18,
                  padding: "26px 30px",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ fontSize: 62, fontWeight: 800, color: color.good, whiteSpace: "nowrap" }}>{big}</div>
                <div style={{ fontSize: 28, lineHeight: 1.3, color: color.muted, marginTop: 12 }}>{small}</div>
              </div>
            </Rise>
          ))}
        </div>
        <Rise delay={Math.round(4 * fps)}>
          <pre
            style={{
              fontFamily: mono,
              fontSize: 30,
              textAlign: "left",
              background: "#10141a",
              border: `2px solid ${color.line}`,
              borderRadius: 14,
              padding: "24px 40px",
              margin: 0,
              color: color.text,
            }}
          >
            {KIRO_TREE.join("\n")}
          </pre>
        </Rise>
      </AbsoluteFill>
    </Fade>
  );
};

// -- 6. History -------------------------------------------------------------------

export const History: React.FC = () => {
  const { fps } = useVideoConfig();
  const steps = [
    ["Nov 13", "A RealSense prototype: it needed an Intel depth camera and a Linux box.", color.muted],
    ["Nov 18", "The amputation. RealSense removed; shoulder width in the frame does the job.", color.bad],
    ["Nov 18", "The transplant, with Kiro: any webcam, in a browser tab, with advice it speaks.", color.good],
  ] as const;
  return (
    <Fade>
      <Background glow={color.warn} />
      <AbsoluteFill style={{ ...center, gap: 34 }}>
        <Rise>
          <div style={{ fontSize: 60, fontWeight: 700, marginBottom: 10 }}>Case history</div>
        </Rise>
        {steps.map(([date, what, accent], i) => (
          <Rise key={i} delay={Math.round((0.6 + i * 2.2) * fps)}>
            <div style={{ display: "flex", gap: 40, alignItems: "center", width: 1500, textAlign: "left" }}>
              <div style={{ fontSize: 46, fontWeight: 800, color: accent, minWidth: 220, fontFamily: mono }}>{date}</div>
              <div style={{ fontSize: 42, borderLeft: `6px solid ${accent}`, paddingLeft: 30 }}>{what}</div>
            </div>
          </Rise>
        ))}
      </AbsoluteFill>
    </Fade>
  );
};

// -- 7. Outro ---------------------------------------------------------------------

export const Outro: React.FC<{ p: VideoProps }> = ({ p }) => (
  <Fade outFrames={20}>
    <Background />
    <Clip src={p.landing.src} fromSec={p.landing.start} dim={0.72} />
    <AbsoluteFill style={{ ...center, gap: 24 }}>
      <Rise>
        <div style={{ fontSize: 120, fontWeight: 800 }}>BackUp</div>
        <div style={{ fontSize: 64, fontWeight: 700 }}>Posture to Die For.</div>
      </Rise>
      <Rise delay={20}>
        <div style={{ fontSize: 54, color: color.good, fontFamily: mono }}>arii.github.io/posture-guard</div>
      </Rise>
      <Rise delay={40}>
        <div style={{ fontSize: 40, color: color.muted }}>No install. No special camera. Sit up straight.</div>
      </Rise>
    </AbsoluteFill>
  </Fade>
);
