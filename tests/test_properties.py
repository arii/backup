# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Property-based tests (hypothesis) for the correctness properties in
.kiro/specs/posture-guard/design.md:

1. Bounded needle: any landmarks -> score_pose never raises; needle is finite
   in [-1, 1] (or None before a valid sample).
2. Scale invariance: uniform scaling of landmarks leaves the angles unchanged.
3. Anti-chatter: neutral-band noise and bad runs shorter than bad_sustain_s
   never nudge.
4. Idempotent nudges: one CHIME per bad episode, VOICE spacing respects the
   delay and cooldown, at any frame rate.
5. Time safety: update() never raises for non-decreasing timestamps.
"""

from __future__ import annotations

import math

from hypothesis import given, settings
from hypothesis import strategies as st

from conftest import make_pose
from posture_guard.config import NeedleConfig, ScoringConfig, StateConfig
from posture_guard.needle import Calibration, NeedleSmoother, raw_needle
from posture_guard.scoring import (
    LEFT_EAR,
    LEFT_HIP,
    LEFT_SHOULDER,
    RIGHT_EAR,
    RIGHT_HIP,
    RIGHT_SHOULDER,
    ScoredPosture,
    SimpleLandmark,
    Unreliable,
    UnreliableReason,
    score_pose,
)
from posture_guard.state import Nudge, PostureState, PostureStateMachine

CFG = ScoringConfig()
TIMINGS = StateConfig()
TRACKED = (LEFT_EAR, RIGHT_EAR, LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP)
BAD_STATES = (PostureState.BAD_CHIME, PostureState.BAD_VOICE)
SLACK = 1e-6

GOOD = ScoredPosture(0.0, 0.0, 0.0, 0.0, depth_m=1.4)
BAD = ScoredPosture(20.0, 0.0, 0.0, 0.0, depth_m=1.4)
# Shoulder level 4.5 deg: above exit (6 - 3 = 3), below enter (6).
NEUTRAL = ScoredPosture(0.0, 0.0, 0.0, 4.5, depth_m=1.4)
NO_POSE = Unreliable(UnreliableReason.NO_POSE)
LOW_VIS = Unreliable(UnreliableReason.LOW_VISIBILITY)

PROPERTY_SETTINGS = settings(max_examples=200, deadline=None)

any_float = st.floats(allow_nan=True, allow_infinity=True)
any_vector = st.tuples(any_float, any_float, any_float, any_float)


def pose_from(coords: list[tuple[float, float]]) -> list[SimpleLandmark]:
    pairs = zip(TRACKED, coords, strict=True)
    return make_pose({i: SimpleLandmark(x=x, y=y) for i, (x, y) in pairs})


# -- Property 1: bounded needle --------------------------------------------------------


@PROPERTY_SETTINGS
@given(
    coords=st.lists(st.tuples(any_float, any_float), min_size=6, max_size=6),
    depth=any_float,
    calibration=st.none() | st.builds(Calibration, good=any_vector, bad=any_vector),
)
def test_needle_is_bounded_for_any_landmarks(coords, depth, calibration):
    result = score_pose(pose_from(coords), depth, CFG)  # must not raise
    if isinstance(result, ScoredPosture):
        raw = raw_needle(result, CFG, calibration)
        assert raw is None or (math.isfinite(raw) and -1.0 <= raw <= 1.0)


@PROPERTY_SETTINGS
@given(
    samples=st.lists(
        st.tuples(st.none() | any_float, any_float), min_size=1, max_size=50
    ),
    tau=st.floats(min_value=0.0, max_value=10.0),
)
def test_smoother_output_is_bounded(samples, tau):
    smoother = NeedleSmoother(NeedleConfig(tau_s=tau))
    for raw, now in samples:
        value = smoother.update(raw, now)
        assert value is None or (math.isfinite(value) and -1.0 <= value <= 1.0)


# -- Property 2: scale invariance -------------------------------------------------------

# Perturbations stay small so no body vector degenerates to zero length
# (atan2(0, 0) has no meaningful angle to be invariant).
jitter = st.floats(min_value=-0.03, max_value=0.03)


@PROPERTY_SETTINGS
@given(
    deltas=st.lists(st.tuples(jitter, jitter), min_size=6, max_size=6),
    k=st.floats(min_value=1e-3, max_value=1e3),
)
def test_angles_are_scale_invariant(deltas, k):
    base = make_pose()
    coords = [(base[i].x + dx, base[i].y + dy) for i, (dx, dy) in zip(TRACKED, deltas, strict=True)]
    scaled = [(x * k, y * k) for x, y in coords]
    a = score_pose(pose_from(coords), 1.4, CFG)
    b = score_pose(pose_from(scaled), 1.4, CFG)
    assert isinstance(a, ScoredPosture) and isinstance(b, ScoredPosture)
    for name in ("head_forward_deg", "trunk_lean_deg", "head_tilt_deg", "shoulder_level_deg"):
        assert math.isclose(getattr(a, name), getattr(b, name), abs_tol=1e-5), name


# -- Property 3: anti-chatter -----------------------------------------------------------

frame_dt = st.floats(min_value=0.005, max_value=0.25)


@PROPERTY_SETTINGS
@given(
    zones=st.lists(st.sampled_from([NEUTRAL, GOOD]), min_size=1, max_size=600),
    dts=st.lists(frame_dt, min_size=600, max_size=600),
)
def test_neutral_and_good_noise_never_nudges(zones, dts):
    machine = PostureStateMachine(TIMINGS, CFG)
    now = 0.0
    for result, dt in zip(zones, dts, strict=False):
        now += dt
        assert machine.update(result, now).nudge is Nudge.NONE


@PROPERTY_SETTINGS
@given(
    runs=st.lists(
        st.tuples(
            st.floats(min_value=0.0, max_value=TIMINGS.bad_sustain_s * 0.95),  # bad run
            st.floats(min_value=TIMINGS.smoothing_window_s + 0.6, max_value=3.0),  # good run
        ),
        min_size=1,
        max_size=15,
    ),
    dt=frame_dt,
)
def test_short_bad_runs_never_nudge(runs, dt):
    machine = PostureStateMachine(TIMINGS, CFG)
    now = 0.0
    for bad_s, good_s in runs:
        for result, duration in ((BAD, bad_s), (GOOD, good_s)):
            start = now
            while True:
                assert machine.update(result, now).nudge is Nudge.NONE
                if now + dt > start + duration:
                    break
                now += dt
            now += dt  # next segment starts one frame later


# -- Property 4: idempotent nudges ------------------------------------------------------

segment = st.tuples(
    st.sampled_from([GOOD, BAD, NEUTRAL, NO_POSE, LOW_VIS]),
    st.floats(min_value=0.0, max_value=45.0),
)


def run_segments(segments, dt):  # noqa: ANN001, ANN201 - test helper
    machine = PostureStateMachine(TIMINGS, CFG)
    now, out = 0.0, []
    for result, duration in segments:
        end = now + duration
        while now <= end:
            out.append((now, machine.update(result, now)))
            now += dt
    return out


@settings(max_examples=100, deadline=None)
@given(segments=st.lists(segment, min_size=1, max_size=12), dt=st.floats(0.01, 0.5))
def test_one_chime_per_bad_episode_and_voice_spacing(segments, dt):
    timeline = run_segments(segments, dt)
    in_bad = False
    chimes = 0
    chime_at = last_voice = None
    for now, tr in timeline:
        entering = tr.state in BAD_STATES and not in_bad
        if entering:
            chimes, chime_at, last_voice = 0, None, None
        if tr.nudge is Nudge.CHIME:
            assert entering, "CHIME only on entry to a bad episode"
            chimes += 1
            chime_at = now
        if tr.nudge is Nudge.VOICE:
            assert tr.state is PostureState.BAD_VOICE
            assert chime_at is not None
            if last_voice is None:
                assert now - chime_at >= TIMINGS.voice_delay_s - SLACK
            else:
                assert now - last_voice >= TIMINGS.voice_repeat_cooldown_s - SLACK
            last_voice = now
        if tr.recovered:
            assert in_bad and tr.state is PostureState.GOOD
        assert chimes <= 1
        in_bad = tr.state in BAD_STATES


# -- Property 5: time safety ------------------------------------------------------------


@PROPERTY_SETTINGS
@given(
    steps=st.lists(
        st.tuples(
            st.sampled_from([GOOD, BAD, NEUTRAL, NO_POSE, LOW_VIS]),
            st.floats(min_value=0.0, max_value=5.0),  # dt may be 0
        ),
        max_size=300,
    )
)
def test_update_never_raises_for_non_decreasing_time(steps):
    machine = PostureStateMachine(TIMINGS, CFG)
    now = 0.0
    for result, dt in steps:
        now += dt
        tr = machine.update(result, now)
        assert tr.state in PostureState
