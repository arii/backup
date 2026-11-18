"""Frame sources: a `FrameSource` interface, a synthetic implementation for
hardware-free development, demos and tests, and a `CameraWorker` that runs any
source on a background thread behind a bounded latest-frame buffer. The webcam
source lives in webcam.py.

Capture contract: color HxWx3 BGR frames with a timestamp. Missing or stalled
cameras surface as source *status*, never as exceptions thrown from read().
"""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    import numpy as np
    import numpy.typing as npt


@dataclass(frozen=True)
class Frame:
    """One color frame. color: HxWx3 uint8 BGR."""

    color: npt.NDArray[np.uint8]
    timestamp_s: float


@dataclass(frozen=True)
class SourceStatus:
    """Operational status of a frame source, safe to render on the dashboard.

    kind names the implementation ("webcam" or "synthetic") so the dashboard
    and logs can always state which source is active — a silent fallback is
    impossible when the active kind travels with the status.
    """

    connected: bool
    error: str | None = None
    kind: str | None = None


@runtime_checkable
class FrameSource(Protocol):
    """Newest-frame reader. read() returns None when no fresh frame exists."""

    def read(self) -> Frame | None: ...

    @property
    def status(self) -> SourceStatus: ...

    def close(self) -> None: ...


class SyntheticFrameSource:
    """Deterministic frames with no camera attached.

    Emits a flat color frame so pose workers, dashboards and tests run anywhere.
    Timestamps advance 1/fps per frame. realtime=True paces read() to that
    rate (the served demo); tests leave it off and run as fast as they call.
    """

    def __init__(self, width: int = 640, height: int = 480, reason: str | None = None,
                 *, fps: int = 30, realtime: bool = False):
        self._width = width
        self._height = height
        self._frame_index = 0
        self._fps = fps if fps > 0 else 30
        self._realtime = realtime
        self._t0: float | None = None
        # reason: why the real camera was not used — surfaced on the dashboard
        # so a silent synthetic fallback is visible to the user too.
        self._status = SourceStatus(connected=True, error=reason, kind="synthetic")

    def read(self) -> Frame | None:
        import numpy as np

        self._frame_index += 1
        timestamp_s = self._frame_index / self._fps
        if self._realtime:
            if self._t0 is None:
                self._t0 = time.monotonic() - timestamp_s
            delay = self._t0 + timestamp_s - time.monotonic()
            if delay > 0:
                time.sleep(delay)
        color = np.zeros((self._height, self._width, 3), dtype=np.uint8)
        color[:, :, 0] = 40  # dark blue backdrop so frames are visibly "live"
        return Frame(color=color, timestamp_s=timestamp_s)

    @property
    def status(self) -> SourceStatus:
        return self._status

    def close(self) -> None:
        return None


class CameraWorker:
    """Runs a FrameSource on a background capture thread behind a bounded
    latest-frame buffer.

    The buffer is a single lock-protected slot: a slow consumer always reads
    the newest frame and stale frames are dropped, so pose scoring can never
    lag behind the camera. Implements the FrameSource protocol itself, so it
    drops in wherever a FrameSource is expected. Capture errors are recorded
    as status states; the loop backs off and keeps retrying.
    """

    def __init__(self, source: FrameSource):
        self._source = source
        self._latest: Frame | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._error: str | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        with self._lock:
            if self._thread is None:
                self._thread = threading.Thread(
                    target=self._capture_loop, name="camera-worker", daemon=True
                )
                self._thread.start()

    def _capture_loop(self) -> None:
        while not self._stop.is_set():
            try:
                frame = self._source.read()
            except Exception as err:
                # Surface as a state; the dashboard shows the error banner.
                self._error = f"capture failed: {err}"
                time.sleep(0.1)
                continue
            if frame is None:
                time.sleep(0.005)  # yield; real sources block inside read()
                continue
            with self._lock:
                self._latest = frame  # single slot: older frames are dropped

    def read(self) -> Frame | None:
        if self._thread is None and not self._stop.is_set():
            self.start()
        with self._lock:
            frame, self._latest = self._latest, None
        return frame

    @property
    def status(self) -> SourceStatus:
        if self._error is not None:
            base = self._source.status
            return SourceStatus(connected=False, error=self._error, kind=base.kind)
        return self._source.status

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        self._source.close()


@contextmanager
def open_frame_source(source: FrameSource) -> Iterator[FrameSource]:
    """Context manager so callers never leak a camera."""
    try:
        yield source
    finally:
        source.close()
