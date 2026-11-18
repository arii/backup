# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Posture needle: one smoothed number for "how far from good posture".

-1.0 is fully upright, +1.0 is at (or past) bad posture. Two raw mappings:

- Threshold mapping (no calibration): each metric's |value| / threshold,
  worst one wins, mapped so 0 deg reads -1 and the bad threshold reads +1.
- Calibrated mapping: the metric vector projected onto the axis from the
  recorded good centroid to the recorded bad centroid, so the good centroid
  reads -1 and the bad centroid reads +1.

The needle is display-only; nudges still come from state.py and the
config.yaml thresholds. Time is injected (now, in seconds) so smoothing is
deterministic in tests.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from posture_guard.config import NeedleConfig, ScoringConfig
from posture_guard.scoring import ScoredPosture

_EPS = 1e-9

Vector = tuple[float, float, float, float]


def metric_vector(metrics: ScoredPosture) -> Vector:
    """The four angle metrics as a vector, in a fixed order."""
    return (
        metrics.head_forward_deg,
        metrics.trunk_lean_deg,
        metrics.head_tilt_deg,
        metrics.shoulder_level_deg,
    )


@dataclass(frozen=True)
class Calibration:
    """Good and bad centroids in metric-vector space (degrees)."""

    good: Vector
    bad: Vector

    def axis_ok(self) -> bool:
        """False when the centroids are too close to define a direction."""
        return _norm_sq(_sub(self.bad, self.good)) > _EPS


def _sub(a: Sequence[float], b: Sequence[float]) -> list[float]:
    return [x - y for x, y in zip(a, b, strict=True)]


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def _norm_sq(a: Sequence[float]) -> float:
    return _dot(a, a)


def clamp(value: float, low: float = -1.0, high: float = 1.0) -> float:
    """Clamp to [low, high]; NaN maps to low so the result is always finite."""
    if math.isnan(value):
        return low
    return max(low, min(high, value))


def _finite(values: Sequence[float]) -> bool:
    return all(math.isfinite(v) for v in values)


def threshold_needle(metrics: ScoredPosture, cfg: ScoringConfig) -> float | None:
    """Raw needle from the config thresholds, or None for non-finite input."""
    pairs = (
        (metrics.head_forward_deg, cfg.head_forward_deg),
        (metrics.trunk_lean_deg, cfg.trunk_lean_deg),
        (metrics.head_tilt_deg, cfg.head_tilt_deg),
        (metrics.shoulder_level_deg, cfg.shoulder_level_deg),
    )
    if not _finite([v for v, _ in pairs]):
        return None
    ratio = max(abs(value) / max(threshold, _EPS) for value, threshold in pairs)
    return clamp(2.0 * ratio - 1.0)


def calibrated_needle(metrics: ScoredPosture, calibration: Calibration) -> float | None:
    """Raw needle from the good->bad projection, or None if it is undefined."""
    vec = metric_vector(metrics)
    if not (_finite(vec) and _finite(calibration.good) and _finite(calibration.bad)):
        return None
    if not calibration.axis_ok():
        return None
    axis = _sub(calibration.bad, calibration.good)
    offset = _sub(vec, calibration.good)
    projection = _dot(offset, axis) / (_norm_sq(axis) + _EPS)
    if not math.isfinite(projection):
        return None
    return clamp(2.0 * projection - 1.0)


def raw_needle(
    metrics: ScoredPosture,
    cfg: ScoringConfig,
    calibration: Calibration | None = None,
) -> float | None:
    """Calibrated mapping when a usable calibration exists, else thresholds."""
    if calibration is not None:
        value = calibrated_needle(metrics, calibration)
        if value is not None:
            return value
    return threshold_needle(metrics, cfg)


class NeedleSmoother:
    """Time-aware EMA: alpha = 1 - exp(-dt / tau_s).

    The output is always a finite float in [-1, 1]. None or non-finite raw
    values, and non-increasing timestamps, hold the previous value.
    """

    def __init__(self, cfg: NeedleConfig):
        self._tau = cfg.tau_s
        self._value: float | None = None
        self._last_t: float | None = None

    @property
    def value(self) -> float | None:
        """Latest smoothed value, or None before the first valid sample."""
        return self._value

    def reset(self) -> None:
        self._value = None
        self._last_t = None

    def update(self, raw: float | None, now: float) -> float | None:
        if raw is None or not math.isfinite(raw) or not math.isfinite(now):
            return self._value
        raw = clamp(raw)
        if self._value is None or self._last_t is None:
            self._value, self._last_t = raw, now
            return self._value
        dt = now - self._last_t
        if dt <= 0:
            return self._value
        alpha = 1.0 if self._tau <= 0 else 1.0 - math.exp(-dt / self._tau)
        self._value = clamp(alpha * raw + (1.0 - alpha) * self._value)
        self._last_t = now
        return self._value
