"""Runnable entry point for the whole system (spec: make run serves the
dashboard).

    python -m posture_guard.dashboard.serve [--config config.yaml] [--port 8000]
        [--camera webcam|realsense|synthetic] [--device N]

Runs the full capture -> pose -> scoring -> state -> dashboard/audio pipeline.
The camera comes from --camera, else camera.source in config.yaml (default:
webcam). A webcam or RealSense that fails to open falls back to the synthetic
source, and the reason is logged and shown on the dashboard. The synthetic
source runs a scripted good/slouch demo so every feature is visible with no
camera at all.
"""

from __future__ import annotations

import argparse
import dataclasses
import logging
import sys

import uvicorn

from posture_guard.audio import AudioWorker
from posture_guard.camera import (
    CameraWorker,
    FrameSource,
    RealSenseFrameSource,
    SyntheticFrameSource,
)
from posture_guard.config import CAMERA_SOURCES, AppConfig, load_config
from posture_guard.dashboard.app import create_app
from posture_guard.dashboard.hub import DashboardHub
from posture_guard.feedback import RuntimeFeedback
from posture_guard.pipeline import PosturePipeline
from posture_guard.pose import PoseDetector, SyntheticPoseDetector, default_detector
from posture_guard.webcam import WebcamFrameSource

logger = logging.getLogger(__name__)


def _synthetic(config: AppConfig, reason: str | None) -> SyntheticFrameSource:
    if reason is not None:
        logger.info("synthetic source (reason: %s)", reason)
        print(f"synthetic source (reason: {reason})", file=sys.stderr)
    else:
        logger.info("synthetic source (selected)")
    return SyntheticFrameSource(
        config.camera.width, config.camera.height, reason=reason,
        fps=config.camera.fps, realtime=True,
    )


def build_source(config: AppConfig) -> FrameSource:
    """The configured camera (camera.source), or synthetic when it fails.

    Either way the selection is logged exactly once with its reason, so a
    silent fallback to the synthetic source is impossible.
    """
    cam = config.camera
    if cam.source == "synthetic":
        return _synthetic(config, None)
    if cam.source == "realsense":
        realsense = RealSenseFrameSource(cam.width, cam.height, cam.fps)
        if realsense.start():
            logger.info(
                "RealSense source active (usb %s)", realsense.status.usb_type or "unknown"
            )
            worker = CameraWorker(realsense)
            worker.start()
            return worker
        return _synthetic(config, realsense.status.error or "camera unavailable")
    webcam = WebcamFrameSource(cam.device, cam.width, cam.height, cam.fps)
    if webcam.start():
        logger.info("webcam source active (device %d)", cam.device)
        worker = CameraWorker(webcam)
        worker.start()
        return worker
    return _synthetic(config, webcam.status.error or "webcam unavailable")


def build_detector(source: FrameSource, config: AppConfig) -> PoseDetector:
    """Scripted demo poses for the synthetic source, MediaPipe otherwise."""
    if source.status.kind == "synthetic":
        return SyntheticPoseDetector(demo_cycle_s=config.camera.demo_cycle_s)
    return default_detector()


def apply_cli(config: AppConfig, camera: str | None, device: int | None) -> AppConfig:
    """CLI flags override config.yaml's camera section."""
    changes: dict[str, object] = {}
    if camera is not None:
        changes["source"] = camera
    if device is not None:
        changes["device"] = device
    if not changes:
        return config
    return dataclasses.replace(config, camera=dataclasses.replace(config.camera, **changes))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Posture Guard dashboard")
    parser.add_argument("--config", default="config.yaml", help="path to config.yaml")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--camera", choices=CAMERA_SOURCES, default=None,
        help="input source (default: camera.source in config.yaml, which defaults to webcam)",
    )
    parser.add_argument("--device", type=int, default=None, help="webcam index (default 0)")
    args = parser.parse_args(argv)

    config = apply_cli(load_config(args.config), args.camera, args.device)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    hub = DashboardHub()
    feedback = RuntimeFeedback.from_config(config)  # one object shared by pipeline + API

    audio = AudioWorker(config.audio)
    audio.start()

    source = build_source(config)
    pipeline = PosturePipeline(
        source, config, hub=hub, audio=audio, feedback=feedback,
        detector=build_detector(source, config),
    )
    pipeline.start()

    try:
        uvicorn.run(
            create_app(hub, audio, feedback=feedback, calibration=pipeline.calibration),
            host=args.host, port=args.port, log_level="info",
        )
    finally:
        pipeline.close()
        audio.close()


if __name__ == "__main__":
    main()
