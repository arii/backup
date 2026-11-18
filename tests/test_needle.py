# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Needle mapping and smoothing tests (example-based; see test_properties.py
for the property-based invariants)."""

from __future__ import annotations

import math

import pytest

from posture_guard.config import NeedleConfig, ScoringConfig
from posture_guard.needle import (
    Calibration,
    NeedleSmoother,
    calibrated_needle,
    clamp,
    raw_needle,
    threshold_needle,
)
from posture_guard.scoring import ScoredPosture

CFG = ScoringConfig()


def metrics(head: float = 0.0, trunk: float = 0.0, tilt: float = 0.0, level: float = 0.0):
    return ScoredPosture(head, trunk, tilt, level, depth_m=1.4)


class TestThresholdNeedle:
    def test_upright_reads_minus_one(self):
        assert threshold_needle(metrics(), CFG) == -1.0

    def test_at_threshold_reads_plus_one(self):
        assert threshold_needle(metrics(head=CFG.head_forward_deg), CFG) == pytest.approx(1.0)

    def test_half_threshold_reads_zero(self):
        half = metrics(trunk=CFG.trunk_lean_deg / 2)
        assert threshold_needle(half, CFG) == pytest.approx(0.0, abs=1e-6)

    def test_worst_metric_wins_and_sign_is_ignored(self):
        assert threshold_needle(metrics(level=-CFG.shoulder_level_deg), CFG) == pytest.approx(1.0)

    def test_past_threshold_is_clamped(self):
        assert threshold_needle(metrics(head=90.0), CFG) == 1.0

    def test_non_finite_returns_none(self):
        assert threshold_needle(metrics(head=math.nan), CFG) is None


class TestCalibratedNeedle:
    CAL = Calibration(good=(2.0, 0.0, 0.0, 0.0), bad=(20.0, 0.0, 0.0, 0.0))

    def test_good_centroid_reads_minus_one(self):
        assert calibrated_needle(metrics(head=2.0), self.CAL) == pytest.approx(-1.0)

    def test_bad_centroid_reads_plus_one(self):
        assert calibrated_needle(metrics(head=20.0), self.CAL) == pytest.approx(1.0)

    def test_midpoint_reads_zero(self):
        assert calibrated_needle(metrics(head=11.0), self.CAL) == pytest.approx(0.0, abs=1e-6)

    def test_degenerate_axis_falls_back_to_thresholds(self):
        same = Calibration(good=(5.0, 0.0, 0.0, 0.0), bad=(5.0, 0.0, 0.0, 0.0))
        assert calibrated_needle(metrics(), same) is None
        assert raw_needle(metrics(), CFG, same) == threshold_needle(metrics(), CFG)


class TestSmoother:
    def test_first_sample_is_taken_as_is(self):
        smoother = NeedleSmoother(NeedleConfig(tau_s=0.5))
        assert smoother.update(0.4, 0.0) == pytest.approx(0.4)

    def test_ema_step_matches_time_constant(self):
        smoother = NeedleSmoother(NeedleConfig(tau_s=0.5))
        smoother.update(-1.0, 0.0)
        alpha = 1 - math.exp(-0.5 / 0.5)
        assert smoother.update(1.0, 0.5) == pytest.approx(alpha * 1.0 + (1 - alpha) * -1.0)

    def test_none_and_nan_hold_previous(self):
        smoother = NeedleSmoother(NeedleConfig())
        smoother.update(0.2, 0.0)
        assert smoother.update(None, 0.1) == pytest.approx(0.2)
        assert smoother.update(math.nan, 0.2) == pytest.approx(0.2)

    def test_non_increasing_time_holds(self):
        smoother = NeedleSmoother(NeedleConfig())
        smoother.update(0.2, 1.0)
        assert smoother.update(0.9, 1.0) == pytest.approx(0.2)
        assert smoother.update(0.9, 0.5) == pytest.approx(0.2)

    def test_zero_tau_tracks_raw(self):
        smoother = NeedleSmoother(NeedleConfig(tau_s=0.0))
        smoother.update(-1.0, 0.0)
        assert smoother.update(0.7, 0.1) == pytest.approx(0.7)


def test_clamp_maps_nan_to_low():
    assert clamp(math.nan) == -1.0
