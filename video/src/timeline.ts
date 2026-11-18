// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
// The edit: which scenes play, in order, and for how long. Root.tsx sums it
// for the composition length; Main.tsx renders it.
import type { VideoProps } from "./props";

export type SceneId =
  | "coldOpen"
  | "ailments"
  | "demoUpright"
  | "demoSlouch"
  | "demoVoice"
  | "demoRecover"
  | "userClip"
  | "webcam"
  | "monster"
  | "proof"
  | "history"
  | "outro";

export type Scene = { id: SceneId; seconds: number };

export function scenes(props: VideoProps): Scene[] {
  const list: Scene[] = [
    { id: "coldOpen", seconds: 6 },
    { id: "ailments", seconds: 10 },
    { id: "demoUpright", seconds: 4.5 },
    { id: "demoSlouch", seconds: 8 },
    { id: "demoVoice", seconds: 6.5 },
    { id: "demoRecover", seconds: 5 },
  ];
  if (props.userClip && props.userClipSeconds > 0) {
    list.push({ id: "userClip", seconds: props.userClipSeconds });
  }
  if (props.webcam) list.push({ id: "webcam", seconds: 10 });
  list.push(
    { id: "monster", seconds: 30 },
    { id: "proof", seconds: 14 },
    { id: "history", seconds: 10 },
    { id: "outro", seconds: 7 },
  );
  return list;
}

export const totalSeconds = (props: VideoProps): number =>
  scenes(props).reduce((sum, s) => sum + s.seconds, 0);
