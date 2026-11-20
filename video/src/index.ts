// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders
// SPDX-License-Identifier: MIT
// Remotion entry point:
//   npx remotion render src/index.ts PostureGuardDemo out/posture-guard-demo.mp4 --props=public/capture.json
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
