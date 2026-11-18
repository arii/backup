"""Tests for frame sources: everything here runs with no camera attached."""

import time

import numpy as np
import pytest

from posture_guard.camera import (
    CameraWorker,
    Frame,
    FrameSource,
    SourceStatus,
    SyntheticFrameSource,
    open_frame_source,
)
from posture_guard.webcam import WebcamFrameSource


def wait_until(predicate, timeout_s: float = 5.0) -> bool:
    """Poll a condition without sleeps baked into the assertions."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return predicate()


def test_synthetic_source_satisfies_frame_source_protocol():
    source = SyntheticFrameSource()
    assert isinstance(source, FrameSource)


def test_synthetic_source_emits_color_frames():
    source = SyntheticFrameSource(width=320, height=240)
    frame = source.read()
    assert frame is not None
    assert frame.color.shape == (240, 320, 3)
    assert frame.color.dtype == np.uint8


def test_synthetic_source_timestamps_advance_at_30fps():
    source = SyntheticFrameSource()
    first = source.read()
    second = source.read()
    assert first is not None and second is not None
    assert second.timestamp_s == pytest.approx(first.timestamp_s + 1 / 30.0)


def test_synthetic_source_status_reports_connected():
    assert SyntheticFrameSource().status.connected


def test_synthetic_source_status_carries_fallback_reason():
    """A synthetic source built with a reason reports it as status error, so
    the dashboard shows why the real camera was not used."""
    source = SyntheticFrameSource(reason="camera unavailable after 3 attempts: No device connected")
    assert source.status.kind == "synthetic"
    assert source.status.connected
    assert "No device connected" in (source.status.error or "")


def test_open_frame_source_closes_on_exit():
    source = SyntheticFrameSource()
    with open_frame_source(source) as opened:
        assert opened.read() is not None
    # SyntheticFrameSource.close() is a no-op; the contract under test is that
    # exit does not raise and the source remains usable-by-contract.


# -- CameraWorker: bounded latest-frame buffer over any FrameSource --


class _ScriptedSource:
    """Emits a fixed frame sequence, then None — for buffer-boundary tests."""

    def __init__(self, frames: list[Frame]):
        self._frames = list(frames)
        self._status = SourceStatus(connected=True)
        self.closed = False

    def read(self) -> Frame | None:
        if self._frames:
            return self._frames.pop(0)
        return None

    @property
    def status(self) -> SourceStatus:
        return self._status

    def close(self) -> None:
        self.closed = True


def _frame(timestamp_s: float) -> Frame:
    color = np.zeros((2, 2, 3), dtype=np.uint8)
    return Frame(color=color, timestamp_s=timestamp_s)


def test_camera_worker_satisfies_frame_source_protocol():
    assert isinstance(CameraWorker(SyntheticFrameSource()), FrameSource)


def test_camera_worker_drops_stale_frames_and_serves_latest():
    source = _ScriptedSource([_frame(1.0), _frame(2.0), _frame(3.0), _frame(4.0)])
    worker = CameraWorker(source)
    worker.start()
    try:
        # Single-slot buffer: by the time a frame is available, the newest
        # scripted frame (or a later one) is what read() serves.
        assert wait_until(lambda: (f := worker.read()) is not None and f.timestamp_s >= 4.0)
    finally:
        worker.close()
    assert source.closed


def test_camera_worker_read_consumes_the_slot():
    source = _ScriptedSource([_frame(1.0)])
    worker = CameraWorker(source)
    worker.start()
    try:
        assert wait_until(lambda: worker.read() is not None)
    finally:
        worker.close()
    # Nothing new was produced; the slot was consumed and stays empty.
    assert worker.read() is None


def test_camera_worker_delegates_status_from_source():
    source = _ScriptedSource([_frame(1.0)])
    worker = CameraWorker(source)
    worker.start()
    try:
        assert wait_until(lambda: worker.read() is not None)
        assert worker.status.connected
        assert worker.status.error is None
    finally:
        worker.close()


def test_camera_worker_capture_error_surfaces_as_state():
    class _BrokenSource:
        def read(self):
            raise RuntimeError("device disconnected")

        @property
        def status(self) -> SourceStatus:
            return SourceStatus(connected=False, error=None, kind="webcam")

        def close(self) -> None:
            return None

    worker = CameraWorker(_BrokenSource())
    worker.start()
    try:
        assert wait_until(lambda: worker.status.error is not None)
        assert "device disconnected" in worker.status.error
        assert not worker.status.connected
        assert worker.status.kind == "webcam"  # source kind survives the error
        assert worker.read() is None
    finally:
        worker.close()


def test_source_kinds_identify_the_active_implementation():
    """Each source reports its kind, so the dashboard can never show a bare
    status without naming what is active."""
    assert SyntheticFrameSource().status.kind == "synthetic"
    assert WebcamFrameSource().status.kind == "webcam"
    assert CameraWorker(SyntheticFrameSource()).status.kind == "synthetic"


def test_camera_worker_auto_starts_on_read():
    """CameraWorker implements FrameSource protocol autonomously without
    requiring callers to invoke start() explicitly."""
    source = _ScriptedSource([_frame(1.0)])
    worker = CameraWorker(source)
    try:
        assert wait_until(lambda: worker.read() is not None)
    finally:
        worker.close()
