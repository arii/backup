# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Few-shot posture calibration: record good and bad centroids.

The dashboard calls start("good") or start("bad") from the web thread; the
pipeline thread calls feed(result, now) on every frame. The recording window
opens on the first frame after start() (frame clock, not wall clock) and
closes window_s later. Scored frames inside the window are averaged into a
centroid; unreliable frames are skipped. Everything stays in memory.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from enum import Enum

from posture_guard.config import CalibrationConfig
from posture_guard.needle import Calibration, Vector, metric_vector
from posture_guard.scoring import ScoredPosture, ScoringResult


class CalibrationKind(Enum):
    GOOD = "good"
    BAD = "bad"


@dataclass(frozen=True)
class CalibrationStatus:
    active: CalibrationKind | None
    remaining_s: float | None
    good: Vector | None
    bad: Vector | None
    good_samples: int
    bad_samples: int
    error: str | None

    def to_payload(self) -> dict[str, object]:
        def vec(v: Vector | None) -> list[float] | None:
            return None if v is None else [round(x, 2) for x in v]

        return {
            "active": None if self.active is None else self.active.value,
            "remaining_s": None if self.remaining_s is None else round(self.remaining_s, 1),
            "good": vec(self.good),
            "bad": vec(self.bad),
            "good_samples": self.good_samples,
            "bad_samples": self.bad_samples,
            "calibrated": self.good is not None and self.bad is not None,
            "error": self.error,
        }


class CalibrationRecorder:
    """Thread-safe recorder of good/bad metric centroids."""

    def __init__(self, cfg: CalibrationConfig):
        self._cfg = cfg
        self._lock = threading.Lock()
        self._pending: CalibrationKind | None = None
        self._active: CalibrationKind | None = None
        self._started_at: float | None = None
        self._last_now: float | None = None
        self._samples: list[Vector] = []
        self._centroids: dict[CalibrationKind, Vector] = {}
        self._counts: dict[CalibrationKind, int] = {}
        self._error: str | None = None

    # -- web-thread API --------------------------------------------------------------

    def start(self, kind: CalibrationKind) -> None:
        """Begin recording on the next frame; replaces any recording in progress."""
        with self._lock:
            self._pending = kind
            self._active = None
            self._started_at = None
            self._samples = []
            self._error = None

    def reset(self) -> None:
        with self._lock:
            self._pending = None
            self._active = None
            self._started_at = None
            self._samples = []
            self._centroids.clear()
            self._counts.clear()
            self._error = None

    @property
    def status(self) -> CalibrationStatus:
        with self._lock:
            kind = self._active or self._pending
            remaining: float | None = None
            if self._active is not None and self._started_at is not None:
                elapsed = (self._last_now or self._started_at) - self._started_at
                remaining = max(0.0, self._cfg.window_s - elapsed)
            elif self._pending is not None:
                remaining = self._cfg.window_s
            return CalibrationStatus(
                active=kind,
                remaining_s=remaining,
                good=self._centroids.get(CalibrationKind.GOOD),
                bad=self._centroids.get(CalibrationKind.BAD),
                good_samples=self._counts.get(CalibrationKind.GOOD, 0),
                bad_samples=self._counts.get(CalibrationKind.BAD, 0),
                error=self._error,
            )

    @property
    def calibration(self) -> Calibration | None:
        """Both centroids, or None until good and bad are both recorded."""
        with self._lock:
            good = self._centroids.get(CalibrationKind.GOOD)
            bad = self._centroids.get(CalibrationKind.BAD)
        if good is None or bad is None:
            return None
        return Calibration(good=good, bad=bad)

    # -- pipeline-thread API ---------------------------------------------------------

    def feed(self, result: ScoringResult, now: float) -> None:
        with self._lock:
            self._last_now = now
            if self._pending is not None:
                self._active, self._pending = self._pending, None
                self._started_at = now
                self._samples = []
            if self._active is None or self._started_at is None:
                return
            if now - self._started_at < self._cfg.window_s:
                if isinstance(result, ScoredPosture):
                    self._samples.append(metric_vector(result))
                return
            self._finish()

    def _finish(self) -> None:
        kind = self._active
        assert kind is not None
        samples = self._samples
        self._active = None
        self._started_at = None
        self._samples = []
        if len(samples) < max(1, self._cfg.min_samples):
            self._error = (
                f"{kind.value} calibration failed: {len(samples)} scored frames "
                f"(need {self._cfg.min_samples}); sit fully in frame and retry"
            )
            return
        n = len(samples)
        centroid = tuple(sum(v[i] for v in samples) / n for i in range(4))
        self._centroids[kind] = centroid  # type: ignore[assignment]
        self._counts[kind] = n
        self._error = None
        other = CalibrationKind.BAD if kind is CalibrationKind.GOOD else CalibrationKind.GOOD
        if other in self._centroids:
            cal = Calibration(
                good=self._centroids[CalibrationKind.GOOD],
                bad=self._centroids[CalibrationKind.BAD],
            )
            if not cal.axis_ok():
                self._error = (
                    "good and bad calibrations are identical; the needle "
                    "uses the config thresholds until one is re-recorded"
                )
