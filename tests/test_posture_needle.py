# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Server-side posture needle: mappings and dt-aware smoothing (example-based;
test_properties.py covers the invariants)."""

from __future__ import annotations

import math

import pytest

from posture_guard.config import NeedleConfig, ScoringConfig
from posture_guard.dashboard.needle import composite_score
from posture_guard.posture_needle import (
    Calibration,
    NeedleSmoother,
    calibrated_needle,
    clamp,
    raw_needle,
    threshold_needle,
)
from posture_guard.scoring import ScoredPosture

CFG = ScoringConfig()


def metrics(head=0.0, trunk=0.0, tilt=0.0, level=0.0, trunk_ok=True) -> ScoredPosture:
    return ScoredPosture(head, trunk, tilt, level, depth_m=None, trunk_lean_available=trunk_ok)


class TestThresholdNeedle:
    def test_upright_reads_minus_one(self):
        assert threshold_needle(metrics(), CFG) == -1.0

    def test_every_metric_at_threshold_reads_plus_one(self):
        m = metrics(CFG.head_forward_deg, CFG.trunk_lean_deg, CFG.head_tilt_deg,
                    CFG.shoulder_level_deg)
        assert threshold_needle(m, CFG) == pytest.approx(1.0)

    def test_matches_the_dashboard_composite_score(self):
        m = metrics(head=4.0, trunk=-3.5, tilt=1.0, level=8.0)
        composite = composite_score(
            {
                "head_forward_deg": m.head_forward_deg,
                "trunk_lean_deg": m.trunk_lean_deg,
                "head_tilt_deg": m.head_tilt_deg,
                "shoulder_level_deg": m.shoulder_level_deg,
            },
            {
                "head_forward_deg": CFG.head_forward_deg,
                "trunk_lean_deg": CFG.trunk_lean_deg,
                "head_tilt_deg": CFG.head_tilt_deg,
                "shoulder_level_deg": CFG.shoulder_level_deg,
            },
        )
        assert threshold_needle(m, CFG) == pytest.approx(composite / 50.0 - 1.0)

    def test_unavailable_trunk_is_skipped(self):
        m = metrics(trunk=90.0, trunk_ok=False)
        assert threshold_needle(m, CFG) == -1.0

    def test_non_finite_returns_none(self):
        assert threshold_needle(metrics(head=math.nan), CFG) is None


class TestCalibratedNeedle:
    CAL = Calibration(good=metrics(head=2.0), bad=metrics(head=20.0))

    def test_good_centroid_reads_minus_one(self):
        assert calibrated_needle(metrics(head=2.0), self.CAL) == pytest.approx(-1.0)

    def test_slouch_centroid_reads_plus_one(self):
        assert calibrated_needle(metrics(head=20.0), self.CAL) == pytest.approx(1.0)

    def test_midpoint_reads_zero(self):
        assert calibrated_needle(metrics(head=11.0), self.CAL) == pytest.approx(0.0, abs=1e-9)

    def test_beyond_slouch_is_clamped(self):
        assert calibrated_needle(metrics(head=60.0), self.CAL) == 1.0

    def test_identical_centroids_fall_back_to_thresholds(self):
        same = Calibration(good=metrics(head=5.0), bad=metrics(head=5.0))
        assert not same.axis_ok()
        assert calibrated_needle(metrics(), same) is None
        assert raw_needle(metrics(), CFG, same) == threshold_needle(metrics(), CFG)


class TestSmoother:
    def test_first_sample_is_taken_as_is(self):
        assert NeedleSmoother(NeedleConfig(tau_s=0.5)).update(0.4, 0.0) == pytest.approx(0.4)

    def test_step_matches_exact_exponential_decay(self):
        smoother = NeedleSmoother(NeedleConfig(tau_s=0.5))
        smoother.update(-1.0, 0.0)
        alpha = 1 - math.exp(-0.25 / 0.5)
        assert smoother.update(1.0, 0.25) == pytest.approx(alpha - (1 - alpha))

    def test_decay_is_frame_rate_independent(self):
        """Same wall-clock time, different frame rates -> same value."""
        fast, slow = NeedleSmoother(NeedleConfig()), NeedleSmoother(NeedleConfig())
        fast.update(-1.0, 0.0)
        slow.update(-1.0, 0.0)
        for i in range(1, 31):  # 30 fps for 1 s
            fast.update(1.0, i / 30)
        for i in range(1, 4):  # 3 fps for 1 s
            slow.update(1.0, i / 3)
        assert fast.value == pytest.approx(slow.value, abs=1e-9)

    def test_none_nan_and_stale_time_hold(self):
        smoother = NeedleSmoother(NeedleConfig())
        smoother.update(0.2, 1.0)
        assert smoother.update(None, 1.1) == pytest.approx(0.2)
        assert smoother.update(math.nan, 1.2) == pytest.approx(0.2)
        assert smoother.update(0.9, 1.0) == pytest.approx(0.2)

    def test_zero_tau_tracks_raw(self):
        smoother = NeedleSmoother(NeedleConfig(tau_s=0.0))
        smoother.update(-1.0, 0.0)
        assert smoother.update(0.7, 0.1) == pytest.approx(0.7)


def test_clamp_maps_nan_to_low():
    assert clamp(math.nan) == -1.0
