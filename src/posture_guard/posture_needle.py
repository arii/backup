# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Posture needle: one smoothed number for "how far from good posture".

-1.0 is upright, +1.0 is at (or past) bad posture. Two raw mappings:

- Threshold mapping (no calibration): the same aggregation as the dashboard's
  composite score (dashboard/needle.py) - the mean over available metrics of
  |value| / threshold, each clamped to 1 - mapped from [0, 1] to [-1, 1].
- Calibrated mapping: the metric vector projected onto the axis from the
  recorded good centroid to the recorded slouch centroid, so the good
  centroid reads -1 and the slouch centroid reads +1.

The needle is display-only; reminders still come from state.py and the
config.yaml thresholds. Time is injected (now, seconds) so smoothing is
deterministic in tests, and alpha = 1 - exp(-dt / tau_s) so the needle moves
at the same wall-clock speed at any frame rate.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from posture_guard.config import NeedleConfig, ScoringConfig
from posture_guard.scoring import ScoredPosture

_EPS = 1e-9


def clamp(value: float, low: float = -1.0, high: float = 1.0) -> float:
    """Clamp to [low, high]; NaN maps to low so the result is always finite."""
    if math.isnan(value):
        return low
    return max(low, min(high, value))


def _dims(metrics: ScoredPosture, include_trunk: bool) -> list[float]:
    values = [metrics.head_forward_deg, metrics.head_tilt_deg, metrics.shoulder_level_deg]
    if include_trunk:
        values.append(metrics.trunk_lean_deg)
    return values


def _finite(values: list[float]) -> bool:
    return all(math.isfinite(v) for v in values)


@dataclass(frozen=True)
class Calibration:
    """Recorded good and slouch centroids (degrees)."""

    good: ScoredPosture
    bad: ScoredPosture

    def uses_trunk(self, metrics: ScoredPosture) -> bool:
        return (
            metrics.trunk_lean_available
            and self.good.trunk_lean_available
            and self.bad.trunk_lean_available
        )

    def axis_ok(self) -> bool:
        """False when the centroids are too close to define a direction."""
        good = _dims(self.good, include_trunk=False)
        bad = _dims(self.bad, include_trunk=False)
        if not (_finite(good) and _finite(bad)):
            return False
        return sum((b - g) ** 2 for g, b in zip(good, bad, strict=True)) > _EPS


def threshold_needle(metrics: ScoredPosture, cfg: ScoringConfig) -> float | None:
    """Raw needle from the config thresholds, or None for non-finite input."""
    pairs = [
        (metrics.head_forward_deg, cfg.head_forward_deg),
        (metrics.head_tilt_deg, cfg.head_tilt_deg),
        (metrics.shoulder_level_deg, cfg.shoulder_level_deg),
    ]
    if cfg.trunk_lean_required and metrics.trunk_lean_available:
        pairs.append((metrics.trunk_lean_deg, cfg.trunk_lean_deg))
    if not _finite([value for value, _ in pairs]):
        return None
    severities = [min(1.0, abs(value) / max(threshold, _EPS)) for value, threshold in pairs]
    return clamp(2.0 * sum(severities) / len(severities) - 1.0)


def calibrated_needle(metrics: ScoredPosture, calibration: Calibration) -> float | None:
    """Raw needle from the good->slouch projection, or None if it is undefined."""
    trunk = calibration.uses_trunk(metrics)
    vec = _dims(metrics, trunk)
    good = _dims(calibration.good, trunk)
    bad = _dims(calibration.bad, trunk)
    if not (_finite(vec) and _finite(good) and _finite(bad)):
        return None
    axis = [b - g for g, b in zip(good, bad, strict=True)]
    norm_sq = sum(a * a for a in axis)
    if not math.isfinite(norm_sq) or norm_sq <= _EPS:
        return None
    projection = sum((v - g) * a for v, g, a in zip(vec, good, axis, strict=True)) / norm_sq
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
    """Time-aware EMA, alpha = 1 - exp(-dt / tau_s).

    Output is always None (before the first valid sample) or a finite float in
    [-1, 1]. None/non-finite raw values and non-increasing timestamps hold the
    previous value.
    """

    def __init__(self, cfg: NeedleConfig):
        self._tau = cfg.tau_s
        self._value: float | None = None
        self._last_t: float | None = None

    @property
    def value(self) -> float | None:
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
