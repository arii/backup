# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Calibration recorder tests: frame-clocked windows, centroids, failures."""

from __future__ import annotations

import pytest

from posture_guard.calibration import CalibrationKind, CalibrationRecorder
from posture_guard.config import CalibrationConfig
from posture_guard.scoring import ScoredPosture, Unreliable, UnreliableReason

CFG = CalibrationConfig(window_s=3.0, min_samples=5)


def scored(head: float) -> ScoredPosture:
    return ScoredPosture(head, 0.0, 0.0, 0.0, depth_m=1.4)


def feed(recorder: CalibrationRecorder, start: float, seconds: float, result) -> float:  # noqa: ANN001
    """Feed 10 Hz frames from start for seconds; returns the next timestamp."""
    steps = round(seconds * 10)
    for i in range(steps):
        recorder.feed(result, start + i / 10)
    return start + steps / 10


def test_nothing_recorded_until_started():
    recorder = CalibrationRecorder(CFG)
    feed(recorder, 0.0, 5.0, scored(3.0))
    status = recorder.status
    assert status.good is None and status.bad is None and status.active is None
    assert recorder.calibration is None


def test_good_then_bad_produces_centroids():
    recorder = CalibrationRecorder(CFG)
    recorder.start(CalibrationKind.GOOD)
    t = feed(recorder, 0.0, 3.5, scored(2.0))
    recorder.start(CalibrationKind.BAD)
    feed(recorder, t, 3.5, scored(20.0))

    calibration = recorder.calibration
    assert calibration is not None
    assert calibration.good[0] == pytest.approx(2.0)
    assert calibration.bad[0] == pytest.approx(20.0)
    status = recorder.status
    assert status.good_samples == 30  # 3.0 s window at 10 Hz
    assert status.error is None
    assert status.to_payload()["calibrated"] is True


def test_window_is_active_while_recording():
    recorder = CalibrationRecorder(CFG)
    recorder.start(CalibrationKind.GOOD)
    assert recorder.status.active is CalibrationKind.GOOD  # pending counts as active
    feed(recorder, 0.0, 1.0, scored(1.0))
    status = recorder.status
    assert status.active is CalibrationKind.GOOD
    assert status.remaining_s == pytest.approx(2.1)


def test_unreliable_frames_are_skipped_and_too_few_fails():
    recorder = CalibrationRecorder(CFG)
    recorder.start(CalibrationKind.GOOD)
    feed(recorder, 0.0, 3.5, Unreliable(UnreliableReason.NO_POSE))
    status = recorder.status
    assert status.good is None
    assert status.error is not None and "failed" in status.error


def test_identical_centroids_report_error():
    recorder = CalibrationRecorder(CFG)
    recorder.start(CalibrationKind.GOOD)
    t = feed(recorder, 0.0, 3.5, scored(5.0))
    recorder.start(CalibrationKind.BAD)
    feed(recorder, t, 3.5, scored(5.0))
    assert recorder.status.error is not None
    assert not recorder.calibration.axis_ok()


def test_reset_clears_everything():
    recorder = CalibrationRecorder(CFG)
    recorder.start(CalibrationKind.GOOD)
    feed(recorder, 0.0, 3.5, scored(2.0))
    recorder.reset()
    assert recorder.status.good is None
    assert recorder.calibration is None
