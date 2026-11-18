# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Relative posture calibration: "Record good posture" / "Record slouch posture".

The dashboard calls start(kind) from the web thread; the pipeline thread calls
feed(result, now) on every frame. A recording opens on the first frame after
start() (frame clock, not wall clock) and closes calibration.window_s later.
Scored frames inside the window are averaged into a centroid; unreliable
frames (no pose, low confidence, NaN glitches) are skipped. A recording with
fewer than calibration.min_samples scored frames fails with a message.

The good centroid anchors the state machine's deviation baseline; good and
slouch together define the needle's projection axis. In memory only: no
frame or landmark leaves the machine.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from enum import Enum

from posture_guard.config import CalibrationConfig
from posture_guard.posture_needle import Calibration
from posture_guard.scoring import ScoredPosture, ScoringResult


class CalibrationKind(Enum):
    GOOD = "good"
    BAD = "bad"


def _round(value: float) -> float:
    return round(value, 2)


def centroid_payload(metrics: ScoredPosture | None) -> dict[str, float | None] | None:
    if metrics is None:
        return None
    return {
        "head_forward_deg": _round(metrics.head_forward_deg),
        "trunk_lean_deg": (
            _round(metrics.trunk_lean_deg) if metrics.trunk_lean_available else None
        ),
        "head_tilt_deg": _round(metrics.head_tilt_deg),
        "shoulder_level_deg": _round(metrics.shoulder_level_deg),
    }


@dataclass(frozen=True)
class CalibrationStatus:
    active: CalibrationKind | None
    remaining_s: float | None
    good: ScoredPosture | None
    bad: ScoredPosture | None
    good_samples: int
    bad_samples: int
    error: str | None

    @property
    def calibrated(self) -> bool:
        return self.good is not None and self.bad is not None

    def to_payload(self) -> dict[str, object]:
        return {
            "active": None if self.active is None else self.active.value,
            "remaining_s": None if self.remaining_s is None else round(self.remaining_s, 1),
            "good": centroid_payload(self.good),
            "bad": centroid_payload(self.bad),
            "good_samples": self.good_samples,
            "bad_samples": self.bad_samples,
            "calibrated": self.calibrated,
            "error": self.error,
        }


def _centroid(samples: list[ScoredPosture]) -> ScoredPosture:
    n = len(samples)
    with_trunk = [s for s in samples if s.trunk_lean_available]
    trunk_ok = len(with_trunk) * 2 >= n  # trunk tracked in most frames
    return ScoredPosture(
        head_forward_deg=sum(s.head_forward_deg for s in samples) / n,
        trunk_lean_deg=(
            sum(s.trunk_lean_deg for s in with_trunk) / len(with_trunk) if trunk_ok else 0.0
        ),
        head_tilt_deg=sum(s.head_tilt_deg for s in samples) / n,
        shoulder_level_deg=sum(s.shoulder_level_deg for s in samples) / n,
        trunk_lean_available=trunk_ok,
    )


class CalibrationRecorder:
    """Thread-safe recorder of good/slouch metric centroids."""

    def __init__(self, cfg: CalibrationConfig):
        self._cfg = cfg
        self._lock = threading.Lock()
        self._pending: CalibrationKind | None = None
        self._active: CalibrationKind | None = None
        self._started_at: float | None = None
        self._last_now: float | None = None
        self._samples: list[ScoredPosture] = []
        self._centroids: dict[CalibrationKind, ScoredPosture] = {}
        self._counts: dict[CalibrationKind, int] = {}
        self._error: str | None = None
        self._version = 0  # bumps whenever a centroid changes

    # -- web-thread API --------------------------------------------------------------

    def start(self, kind: CalibrationKind) -> None:
        """Begin recording on the next frame; replaces a recording in progress."""
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
            self._version += 1

    @property
    def version(self) -> int:
        with self._lock:
            return self._version

    @property
    def status(self) -> CalibrationStatus:
        with self._lock:
            remaining: float | None = None
            if self._active is not None and self._started_at is not None:
                elapsed = (self._last_now or self._started_at) - self._started_at
                remaining = max(0.0, self._cfg.window_s - elapsed)
            elif self._pending is not None:
                remaining = self._cfg.window_s
            return CalibrationStatus(
                active=self._active or self._pending,
                remaining_s=remaining,
                good=self._centroids.get(CalibrationKind.GOOD),
                bad=self._centroids.get(CalibrationKind.BAD),
                good_samples=self._counts.get(CalibrationKind.GOOD, 0),
                bad_samples=self._counts.get(CalibrationKind.BAD, 0),
                error=self._error,
            )

    @property
    def good(self) -> ScoredPosture | None:
        with self._lock:
            return self._centroids.get(CalibrationKind.GOOD)

    @property
    def calibration(self) -> Calibration | None:
        """Both centroids, or None until good and slouch are both recorded."""
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
                    self._samples.append(result)
                return
            self._finish()

    def _finish(self) -> None:
        kind = self._active
        assert kind is not None
        samples = self._samples
        self._active = None
        self._started_at = None
        self._samples = []
        needed = max(1, self._cfg.min_samples)
        if len(samples) < needed:
            self._error = (
                f"{kind.value} calibration failed: {len(samples)} scored frames "
                f"(need {needed}) - sit fully in frame and retry"
            )
            return
        self._centroids[kind] = _centroid(samples)
        self._counts[kind] = len(samples)
        self._error = None
        self._version += 1
        good = self._centroids.get(CalibrationKind.GOOD)
        bad = self._centroids.get(CalibrationKind.BAD)
        if good is not None and bad is not None and not Calibration(good, bad).axis_ok():
            self._error = (
                "good and slouch recordings are identical - the needle uses the "
                "thresholds until one is re-recorded"
            )
