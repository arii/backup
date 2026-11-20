// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
import type React from "react";
import { AbsoluteFill, Series } from "remotion";
import type { VideoProps } from "./props";
import {
  Ailments,
  ColdOpen,
  DemoRecover,
  DemoSlouch,
  DemoUpright,
  DemoVoice,
  History,
  Monster,
  Outro,
  Proof,
  UserClip,
  Webcam,
} from "./scenes";
import { color, FPS } from "./theme";
import { scenes, type SceneId } from "./timeline";

const render = (id: SceneId, p: VideoProps): React.ReactNode => {
  switch (id) {
    case "coldOpen": return <ColdOpen />;
    case "ailments": return <Ailments />;
    case "demoUpright": return <DemoUpright p={p} />;
    case "demoSlouch": return <DemoSlouch p={p} />;
    case "demoVoice": return <DemoVoice p={p} />;
    case "demoRecover": return <DemoRecover p={p} />;
    case "userClip": return <UserClip p={p} />;
    case "webcam": return <Webcam p={p} />;
    case "monster": return <Monster />;
    case "proof": return <Proof />;
    case "history": return <History />;
    case "outro": return <Outro p={p} />;
  }
};

export const Main: React.FC<VideoProps> = (props) => (
  <AbsoluteFill style={{ background: color.bg }}>
    <Series>
      {scenes(props).map((s) => (
        <Series.Sequence key={s.id} durationInFrames={Math.round(s.seconds * FPS)} name={s.id}>
          {render(s.id, props)}
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);
