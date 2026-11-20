# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders
# SPDX-License-Identifier: MIT
"""Standard webcam frame source: cv2.VideoCapture.

The default input (camera.source: webcam). Distance is judged from the frame
itself by the shoulder-width framing gate (scoring.shoulder_width_min/max).

OpenCV is imported lazily so CI and headless machines can import this module.
read() never raises: open and read failures become SourceStatus states, and a
camera that stops delivering frames is reopened with bounded retries.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Protocol

from posture_guard.camera import Frame, SourceStatus


class Capture(Protocol):
    """The subset of cv2.VideoCapture this source uses (stubbed in tests)."""

    def isOpened(self) -> bool: ...  # noqa: N802 - OpenCV naming
    def read(self) -> tuple[bool, object]: ...
    def set(self, prop: int, value: float) -> bool: ...
    def release(self) -> None: ...


CaptureOpener = Callable[[int, int, int, int], Capture]


def _open_capture(device: int, width: int, height: int, fps: int) -> Capture:
    """Open device with cv2 and request the configured mode (best effort:
    drivers may pick the nearest supported resolution)."""
    import cv2

    capture = cv2.VideoCapture(device)
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    capture.set(cv2.CAP_PROP_FPS, fps)
    return capture


class WebcamFrameSource:
    """cv2.VideoCapture wrapper implementing the FrameSource protocol."""

    def __init__(
        self,
        device: int = 0,
        width: int = 640,
        height: int = 480,
        fps: int = 30,
        *,
        opener: CaptureOpener | None = None,
        clock: Callable[[], float] = time.monotonic,
        open_attempts: int = 3,
        open_backoff_s: float = 0.5,
        max_read_failures: int = 30,
    ):
        self._device = device
        self._width = width
        self._height = height
        self._fps = fps
        self._opener = opener or _open_capture
        self._clock = clock
        self._open_attempts = open_attempts
        self._open_backoff_s = open_backoff_s
        self._max_read_failures = max_read_failures
        self._capture: Capture | None = None
        self._read_failures = 0
        self._started = False
        self._status = SourceStatus(connected=False, error="not started", kind="webcam")

    def start(self) -> bool:
        """Open the camera with bounded retries. Never raises."""
        self._started = True
        last_error = "device did not open"
        for attempt in range(1, self._open_attempts + 1):
            try:
                capture = self._opener(self._device, self._width, self._height, self._fps)
            except Exception as err:  # noqa: BLE001 - missing cv2, driver errors
                last_error = str(err) or type(err).__name__
                capture = None
            if capture is not None and capture.isOpened():
                self._capture = capture
                self._read_failures = 0
                self._status = SourceStatus(connected=True, kind="webcam")
                return True
            if capture is not None:
                capture.release()
            if attempt < self._open_attempts:
                time.sleep(self._open_backoff_s)
        self._status = SourceStatus(
            connected=False,
            kind="webcam",
            error=(
                f"webcam {self._device} unavailable after {self._open_attempts} "
                f"attempts: {last_error}"
            ),
        )
        return False

    def read(self) -> Frame | None:
        if not self._started:
            return None
        if self._capture is None and not self.start():
            return None
        assert self._capture is not None
        try:
            ok, frame = self._capture.read()
        except Exception as err:  # noqa: BLE001 - surfaced as status
            ok, frame = False, None
            self._status = SourceStatus(connected=False, kind="webcam", error=str(err))
        if not ok or frame is None:
            self._read_failures += 1
            if self._read_failures >= self._max_read_failures:
                # Unplugged or stalled: drop the handle so the next read reopens.
                self._status = SourceStatus(
                    connected=False,
                    kind="webcam",
                    error=f"no frames from webcam {self._device} - reopening",
                )
                self._release()
            return None
        self._read_failures = 0
        if not self._status.connected:
            self._status = SourceStatus(connected=True, kind="webcam")
        return Frame(color=frame, timestamp_s=self._clock())  # type: ignore[arg-type]

    @property
    def status(self) -> SourceStatus:
        return self._status

    def _release(self) -> None:
        if self._capture is not None:
            self._capture.release()
        self._capture = None

    def close(self) -> None:
        self._release()
        self._started = False
        self._status = SourceStatus(connected=False, kind="webcam")
