# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Posture cues: what is off, which side (the person's own), and how to fix it."""

from __future__ import annotations

import pytest

from conftest import make_pose, mirror_x
from posture_guard.config import ScoringConfig
from posture_guard.cues import mirror_sign, posture_cue
from posture_guard.scoring import (
    LEFT_EAR,
    LEFT_HIP,
    LEFT_SHOULDER,
    RIGHT_EAR,
    RIGHT_HIP,
    RIGHT_SHOULDER,
    ScoredPosture,
    SimpleLandmark,
    score_pose,
)

CFG = ScoringConfig()


def cue_for(pose, baseline=None):  # noqa: ANN001, ANN201 - test helper
    scored = score_pose(pose, CFG)
    assert isinstance(scored, ScoredPosture), scored
    return posture_cue(scored, CFG, baseline, mirror_sign(pose))


# Poses where the person's RIGHT side is the one that is off. In make_pose the
# person's right shoulder is at larger image x; mirror_x flips that, and the cue
# must still name the same side.
RIGHT_SHOULDER_LOW = make_pose(
    {
        RIGHT_SHOULDER: SimpleLandmark(x=0.60, y=0.64),  # ~11 deg, right side lower
        LEFT_EAR: SimpleLandmark(x=0.46, y=0.46),
        RIGHT_EAR: SimpleLandmark(x=0.54, y=0.48),  # ears follow the shoulder line
    }
)
HEAD_TILT_RIGHT = make_pose(
    {
        LEFT_EAR: SimpleLandmark(x=0.45, y=0.43),
        RIGHT_EAR: SimpleLandmark(x=0.55, y=0.47),  # right ear lower: toward right shoulder
    }
)
LEAN_RIGHT = make_pose(
    {   # shoulders and head shifted toward the right-hip side
        LEFT_SHOULDER: SimpleLandmark(x=0.46, y=0.60),
        RIGHT_SHOULDER: SimpleLandmark(x=0.66, y=0.60),
        LEFT_EAR: SimpleLandmark(x=0.52, y=0.45),
        RIGHT_EAR: SimpleLandmark(x=0.60, y=0.45),
        LEFT_HIP: SimpleLandmark(x=0.44, y=0.90),
        RIGHT_HIP: SimpleLandmark(x=0.56, y=0.90),
    }
)


def test_upright_pose_has_no_cue():
    assert cue_for(make_pose()) is None


def test_head_forward(slouched_pose):
    cue = cue_for(slouched_pose)
    assert cue.metric == "head_forward" and cue.side is None
    assert cue.title == "Head forward"
    assert "chin" in cue.fix and "ears back over your shoulders" in cue.fix
    assert cue.say.startswith("Head forward.")


@pytest.mark.parametrize("mirrored", [False, True])
def test_shoulder_side_is_the_persons_own(mirrored):
    pose = mirror_x(RIGHT_SHOULDER_LOW) if mirrored else RIGHT_SHOULDER_LOW
    cue = cue_for(pose)
    assert cue.id == "shoulder_level:right"
    assert cue.title == "Right shoulder dropped"
    assert "right shoulder" in cue.fix


@pytest.mark.parametrize("mirrored", [False, True])
def test_head_tilt_side_is_the_persons_own(mirrored):
    pose = mirror_x(HEAD_TILT_RIGHT) if mirrored else HEAD_TILT_RIGHT
    cue = cue_for(pose)
    assert cue.id == "head_tilt:right"
    assert cue.title == "Head tilted toward your right shoulder"


def test_head_tilt_left(tilted_head_pose):
    # conftest: right ear higher than the left -> tilted toward the LEFT shoulder.
    assert cue_for(tilted_head_pose).id == "head_tilt:left"


@pytest.mark.parametrize("mirrored", [False, True])
def test_trunk_lean_side_is_the_persons_own(mirrored):
    pose = mirror_x(LEAN_RIGHT) if mirrored else LEAN_RIGHT
    cue = cue_for(pose)
    assert cue.id == "trunk_lean:right"
    assert cue.title == "Leaning to your right"


@pytest.mark.parametrize(
    ("right_shoulder_y", "expected"),
    [
        # Head forward 15.4 deg (1.93x its 8 deg band) beats shoulders 7.1 deg (1.19x of 6).
        (0.625, "head_forward"),
        # Shoulders 11.3 deg (1.88x) beat head forward 14.0 deg (1.75x).
        (0.64, "shoulder_level"),
    ],
)
def test_metric_furthest_past_its_band_wins(right_shoulder_y, expected):
    pose = make_pose(
        {
            LEFT_EAR: SimpleLandmark(x=0.48, y=0.54),
            RIGHT_EAR: SimpleLandmark(x=0.56, y=0.54),
            RIGHT_SHOULDER: SimpleLandmark(x=0.60, y=right_shoulder_y),
        }
    )
    assert cue_for(pose).metric == expected


def test_landmark_jitter_on_an_upright_pose_gives_no_cue():
    # ~1 deg of shoulder jitter must not produce "left shoulder dropped".
    jitter = make_pose({RIGHT_SHOULDER: SimpleLandmark(x=0.60, y=0.6035)})
    assert cue_for(jitter) is None


def test_drift_from_baseline_is_reported_with_its_own_sign():
    # Raw shoulder level 2 deg is inside the exit band, but the person's
    # recorded neutral is -3 deg: a 5 deg drift with the right side lower.
    metrics = ScoredPosture(0.0, 0.0, 0.0, 2.0)
    baseline = ScoredPosture(0.0, 0.0, 0.0, -3.0)
    cue = posture_cue(metrics, CFG, baseline)
    assert cue.id == "shoulder_level:right"
    assert posture_cue(metrics, CFG, None) is None


def test_trunk_ignored_when_hips_not_tracked():
    metrics = ScoredPosture(0.0, 40.0, 0.0, 0.0, trunk_lean_available=False)
    assert posture_cue(metrics, CFG) is None


def test_payload_shape():
    cue = posture_cue(ScoredPosture(20.0, 0.0, 0.0, 0.0), CFG)
    assert cue.to_payload() == {
        "id": "head_forward:-", "metric": "head_forward", "side": None,
        "title": cue.title, "fix": cue.fix, "say": cue.say,
    }
