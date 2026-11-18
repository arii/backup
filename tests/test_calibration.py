# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Calibration recorder: frame-clocked windows, centroids, failure messages."""

from __future__ import annotations

import pytest

from posture_guard.calibration import CalibrationKind, CalibrationRecorder
from posture_guard.config import CalibrationConfig
from posture_guard.scoring import ScoredPosture, Unreliable, UnreliableReason

CFG = CalibrationConfig(window_s=3.0, min_samples=5)


def scored(head: float, trunk_ok: bool = True) -> ScoredPosture:
    return ScoredPosture(head, 1.0, 0.0, 0.0, trunk_lean_available=trunk_ok)


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


def test_good_then_slouch_produces_centroids():
    recorder = CalibrationRecorder(CFG)
    version = recorder.version
    recorder.start(CalibrationKind.GOOD)
    t = feed(recorder, 0.0, 3.5, scored(2.0))
    recorder.start(CalibrationKind.BAD)
    feed(recorder, t, 3.5, scored(20.0))

    calibration = recorder.calibration
    assert calibration is not None
    assert calibration.good.head_forward_deg == pytest.approx(2.0)
    assert calibration.bad.head_forward_deg == pytest.approx(20.0)
    status = recorder.status
    assert status.good_samples == 30  # 3.0 s window at 10 Hz
    assert status.error is None
    assert status.to_payload()["calibrated"] is True
    assert recorder.version == version + 2


def test_progress_is_reported_while_recording():
    recorder = CalibrationRecorder(CFG)
    recorder.start(CalibrationKind.GOOD)
    assert recorder.status.active is CalibrationKind.GOOD  # pending counts as active
    feed(recorder, 0.0, 1.0, scored(1.0))
    assert recorder.status.remaining_s == pytest.approx(2.1)


def test_unreliable_frames_are_skipped_and_too_few_fails():
    recorder = CalibrationRecorder(CFG)
    recorder.start(CalibrationKind.GOOD)
    feed(recorder, 0.0, 3.5, Unreliable(UnreliableReason.NON_FINITE))
    status = recorder.status
    assert status.good is None
    assert status.error is not None and "failed" in status.error


def test_trunk_marked_unavailable_when_hips_mostly_hidden():
    recorder = CalibrationRecorder(CFG)
    recorder.start(CalibrationKind.GOOD)
    feed(recorder, 0.0, 3.5, scored(2.0, trunk_ok=False))
    assert recorder.good.trunk_lean_available is False
    assert recorder.status.to_payload()["good"]["trunk_lean_deg"] is None


def test_identical_recordings_report_error():
    recorder = CalibrationRecorder(CFG)
    recorder.start(CalibrationKind.GOOD)
    t = feed(recorder, 0.0, 3.5, scored(5.0))
    recorder.start(CalibrationKind.BAD)
    feed(recorder, t, 3.5, scored(5.0))
    assert "identical" in (recorder.status.error or "")
    assert not recorder.calibration.axis_ok()


def test_reset_clears_everything():
    recorder = CalibrationRecorder(CFG)
    recorder.start(CalibrationKind.GOOD)
    feed(recorder, 0.0, 3.5, scored(2.0))
    recorder.reset()
    assert recorder.good is None
    assert recorder.calibration is None
