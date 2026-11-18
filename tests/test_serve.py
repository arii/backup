"""Tests for source selection in serve.py: the one-time startup log that names
the selected source and reason (stubbed openers, no SDK, no hardware).

camera.source picks the input (webcam by default); a camera that fails to
open falls back to the synthetic source with the reason attached.
"""

from __future__ import annotations

import dataclasses
import logging

import pytest

from posture_guard.camera import SyntheticFrameSource
from posture_guard.config import AppConfig, CameraConfig
from posture_guard.dashboard.serve import apply_cli, build_detector, build_source
from posture_guard.pose import SyntheticPoseDetector


@pytest.fixture
def log_source_selection(caplog):
    caplog.set_level(logging.INFO, logger="posture_guard.dashboard.serve")
    return caplog


def _config(source: str) -> AppConfig:
    return AppConfig(camera=CameraConfig(source=source))


@pytest.fixture
def no_backoff(monkeypatch):
    """Skip the open-retry sleeps so failure paths run instantly."""
    monkeypatch.setattr("posture_guard.webcam.time.sleep", lambda s: None)
    monkeypatch.setattr("posture_guard.camera.time.sleep", lambda s: None)


class FakeCapture:
    def __init__(self, opened: bool = True):
        self.opened = opened
        self.released = False

    def isOpened(self) -> bool:  # noqa: N802 - OpenCV naming
        return self.opened

    def read(self):
        return True, object()

    def set(self, prop, value) -> bool:
        return True

    def release(self) -> None:
        self.released = True


def test_default_source_is_webcam() -> None:
    assert AppConfig().camera.source == "webcam"


def test_webcam_start_logs_active_source(log_source_selection, monkeypatch):
    monkeypatch.setattr(
        "posture_guard.webcam._open_capture", lambda d, w, h, f: FakeCapture()
    )
    source = build_source(AppConfig())
    try:
        assert not isinstance(source, SyntheticFrameSource)
        assert source.status.kind == "webcam"
        assert "webcam source active (device 0)" in log_source_selection.text
    finally:
        source.close()


def test_webcam_failure_falls_back_to_synthetic(log_source_selection, monkeypatch, no_backoff):
    monkeypatch.setattr(
        "posture_guard.webcam._open_capture", lambda d, w, h, f: FakeCapture(opened=False)
    )
    source = build_source(AppConfig())

    assert isinstance(source, SyntheticFrameSource)
    assert "webcam 0 unavailable after 3 attempts" in log_source_selection.text
    assert "webcam 0 unavailable" in (source.status.error or "")
    assert source.status.kind == "synthetic"


def test_realsense_start_logs_active_source_with_usb(log_source_selection, monkeypatch):
    def usb3_device(width, height, fps):
        return object(), object(), "3.2"

    monkeypatch.setattr("posture_guard.camera._open_pipeline", usb3_device)
    source = build_source(_config("realsense"))
    try:
        assert isinstance(source, SyntheticFrameSource) is False
        assert "RealSense source active (usb 3.2)" in log_source_selection.text
    finally:
        source.close()


def test_synthetic_fallback_logs_reason(log_source_selection, monkeypatch, no_backoff):
    def no_device(width, height, fps):
        raise RuntimeError("No device connected")

    monkeypatch.setattr("posture_guard.camera._open_pipeline", no_device)
    source = build_source(_config("realsense"))

    assert isinstance(source, SyntheticFrameSource)
    text = log_source_selection.text
    assert "synthetic source (reason:" in text
    # The reason names the exhausted retry budget and the SDK's last error.
    assert "camera unavailable after 3 attempts: No device connected" in text
    # The fallback source itself carries the reason, so it reaches the
    # dashboard status too, not just the log.
    assert "No device connected" in (source.status.error or "")
    assert source.status.kind == "synthetic"


def test_synthetic_selected_explicitly_has_no_error(log_source_selection):
    source = build_source(_config("synthetic"))
    assert isinstance(source, SyntheticFrameSource)
    assert source.status.error is None
    assert "synthetic source (selected)" in log_source_selection.text


def test_synthetic_source_gets_the_scripted_demo_detector():
    config = dataclasses.replace(
        _config("synthetic"), camera=CameraConfig(source="synthetic", demo_cycle_s=5.0)
    )
    detector = build_detector(SyntheticFrameSource(), config)
    assert isinstance(detector, SyntheticPoseDetector)
    # Good for the first cycle, slouched for the second.
    assert detector.pose_at(1.0) != detector.pose_at(6.0)
    assert detector.pose_at(1.0) == detector.pose_at(11.0)


def test_cli_flags_override_config_camera():
    config = apply_cli(AppConfig(), "realsense", 2)
    assert config.camera.source == "realsense"
    assert config.camera.device == 2
    assert apply_cli(AppConfig(), None, None) == AppConfig()
