// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
import { Composition } from "remotion";
import { Main } from "./Main";
import { defaultProps, type VideoProps } from "./props";
import { FPS, HEIGHT, WIDTH } from "./theme";
import { totalSeconds } from "./timeline";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="PostureGuardDemo"
    component={Main}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    durationInFrames={Math.round(totalSeconds(defaultProps) * FPS)}
    defaultProps={defaultProps}
    calculateMetadata={({ props }: { props: VideoProps }) => ({
      durationInFrames: Math.round(totalSeconds(props) * FPS),
    })}
  />
);
