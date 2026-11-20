# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders
# SPDX-License-Identifier: MIT
"""WebcamFrameSource tests with a stubbed cv2.VideoCapture (no camera, no cv2)."""

from __future__ import annotations

import pytest

from posture_guard.webcam import WebcamFrameSource


class FakeCapture:
    def __init__(self, opened: bool = True, frames: list | None = None):
        self.opened = opened
        self.frames = list(frames) if frames is not None else None
        self.released = False
        self.props: dict[int, float] = {}

    def isOpened(self) -> bool:  # noqa: N802 - OpenCV naming
        return self.opened

    def read(self):
        if self.frames is None:
            return True, "frame"
        if not self.frames:
            return False, None
        return True, self.frames.pop(0)

    def set(self, prop: int, value: float) -> bool:
        self.props[prop] = value
        return True

    def release(self) -> None:
        self.released = True


class Opener:
    """Hands out captures in order and records each open call."""

    def __init__(self, *captures: FakeCapture):
        self.captures = list(captures)
        self.calls: list[tuple[int, int, int, int]] = []

    def __call__(self, device: int, width: int, height: int, fps: int) -> FakeCapture:
        self.calls.append((device, width, height, fps))
        if not self.captures:
            return FakeCapture(opened=False)
        return self.captures.pop(0)


@pytest.fixture(autouse=True)
def no_backoff(monkeypatch):
    monkeypatch.setattr("posture_guard.webcam.time.sleep", lambda s: None)


def make_source(opener: Opener, **kwargs) -> WebcamFrameSource:
    ticks = iter(range(1000))
    return WebcamFrameSource(
        device=1, width=320, height=240, fps=15, opener=opener,
        clock=lambda: float(next(ticks)), **kwargs,
    )


def test_open_success_reports_connected_webcam():
    opener = Opener(FakeCapture())
    source = make_source(opener)
    assert source.start() is True
    assert source.status.connected and source.status.kind == "webcam"
    assert opener.calls == [(1, 320, 240, 15)]


def test_frames_are_color_only_with_injected_clock():
    source = make_source(Opener(FakeCapture(frames=["a", "b"])))
    source.start()
    first, second = source.read(), source.read()
    assert first.color == "a"
    assert second.timestamp_s > first.timestamp_s


def test_read_before_start_returns_none():
    assert make_source(Opener(FakeCapture())).read() is None


def test_open_failure_is_status_not_exception():
    opener = Opener(FakeCapture(opened=False), FakeCapture(opened=False), FakeCapture(opened=False))
    source = make_source(opener)
    assert source.start() is False
    assert not source.status.connected
    assert "webcam 1 unavailable after 3 attempts" in source.status.error
    assert len(opener.calls) == 3


def test_missing_cv2_is_status_not_exception():
    def broken_opener(device, width, height, fps):
        raise ModuleNotFoundError("No module named 'cv2'")

    source = WebcamFrameSource(opener=broken_opener, open_attempts=1)
    assert source.start() is False
    assert "No module named 'cv2'" in source.status.error


def test_stalled_camera_is_reopened():
    stalled = FakeCapture(frames=[])
    fresh = FakeCapture(frames=["x"])
    source = make_source(Opener(stalled, fresh), max_read_failures=3)
    source.start()
    for _ in range(3):
        assert source.read() is None
    assert stalled.released
    assert not source.status.connected
    assert "reopening" in source.status.error
    frame = source.read()  # reopens and reads from the fresh capture
    assert frame is not None and frame.color == "x"
    assert source.status.connected


def test_close_releases_the_capture():
    capture = FakeCapture()
    source = make_source(Opener(capture))
    source.start()
    source.close()
    assert capture.released
    assert source.read() is None
