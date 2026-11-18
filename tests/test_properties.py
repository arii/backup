# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Property-based tests (hypothesis) for the correctness properties in
.kiro/specs/posture-guard/design.md:

P1 Bounded needle: for any landmarks (NaN, inf, extreme), any visibility and
   any calibration, score_pose never raises and the needle is None or a
   finite float in [-1, 1]; the smoother stays bounded.
P2 Scale invariance: scaling every landmark by k > 0 leaves the angle metrics
   (and the threshold needle) unchanged within 1e-5.
P3 Anti-chatter / dwell: neutral-band and good noise, and bad runs shorter
   than bad_sustain_s, never produce a reminder - at any frame rate.
P4 Idempotent reminders: at most one CHIME per bad episode and only on entry,
   VOICE honours voice_delay_s and voice_repeat_cooldown_s, the recovered flag
   fires exactly once per episode that recovers, and the pipeline enqueues
   exactly one RECOVERY per recovery - regardless of frame rate.
P5 Glitch transparency: inserting NaN/inf frames anywhere leaves the state and
   reminders on every other frame unchanged (held state, nothing reset).
P6 Time safety: update() never raises for non-decreasing timestamps.
"""

from __future__ import annotations

import math
from dataclasses import replace

import numpy as np
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from conftest import make_pose
from posture_guard.camera import Frame, SyntheticFrameSource
from posture_guard.config import (
    AppConfig,
    FeedbackConfig,
    NeedleConfig,
    PositiveChimeConfig,
    RecoveryChimeConfig,
    ScoringConfig,
    StateConfig,
)
from posture_guard.pipeline import PosturePipeline
from posture_guard.pose import PoseDetection
from posture_guard.posture_needle import Calibration, NeedleSmoother, raw_needle
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
REMINDERS = (Nudge.CHIME, Nudge.VOICE)
SLACK = 1e-6

GOOD = ScoredPosture(0.0, 0.0, 0.0, 0.0)
BAD = ScoredPosture(18.0, 0.0, 0.0, 0.0)
# Shoulder level 2.5 deg: past the exit threshold (4 - 3 = 1), below enter (4).
NEUTRAL = ScoredPosture(0.0, 0.0, 0.0, 2.5)
NO_POSE = Unreliable(UnreliableReason.NO_POSE)
LOW_VIS = Unreliable(UnreliableReason.LOW_VISIBILITY)
GLITCH = Unreliable(UnreliableReason.NON_FINITE)
FRAMING = Unreliable(UnreliableReason.FRAMING_OUT_OF_BAND, "too far")
ALL_RESULTS = [GOOD, BAD, NEUTRAL, NO_POSE, LOW_VIS, GLITCH, FRAMING]

PROPS = settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.too_slow])
HEAVY = settings(max_examples=60, deadline=None, suppress_health_check=[HealthCheck.too_slow])

any_float = st.floats(allow_nan=True, allow_infinity=True)
any_posture = st.builds(
    ScoredPosture,
    head_forward_deg=any_float,
    trunk_lean_deg=any_float,
    head_tilt_deg=any_float,
    shoulder_level_deg=any_float,
    trunk_lean_available=st.booleans(),
)
frame_dt = st.floats(min_value=0.01, max_value=0.5)


def pose_from(coords, visibility: float = 1.0) -> list[SimpleLandmark]:  # noqa: ANN001
    pairs = zip(TRACKED, coords, strict=True)
    return make_pose({i: SimpleLandmark(x=x, y=y, visibility=visibility) for i, (x, y) in pairs})


def machine() -> PostureStateMachine:
    return PostureStateMachine(TIMINGS, CFG)


def bounded(value: float | None) -> bool:
    return value is None or (math.isfinite(value) and -1.0 <= value <= 1.0)


# -- P1: bounded needle -----------------------------------------------------------------


@PROPS
@given(
    coords=st.lists(st.tuples(any_float, any_float), min_size=6, max_size=6),
    visibility=st.floats(allow_nan=True, allow_infinity=False),
    calibration=st.none() | st.builds(Calibration, good=any_posture, bad=any_posture),
)
def test_p1_needle_is_bounded_for_any_landmarks(coords, visibility, calibration):
    result = score_pose(pose_from(coords, visibility), CFG)
    if isinstance(result, ScoredPosture):
        for name in ("head_forward_deg", "head_tilt_deg", "shoulder_level_deg", "trunk_lean_deg"):
            assert math.isfinite(getattr(result, name)), name
        assert bounded(raw_needle(result, CFG, calibration))
    else:
        assert isinstance(result.reason, UnreliableReason)


@PROPS
@given(metrics=any_posture, calibration=st.none() | st.builds(
    Calibration, good=any_posture, bad=any_posture))
def test_p1_raw_needle_is_bounded_for_any_metrics(metrics, calibration):
    assert bounded(raw_needle(metrics, CFG, calibration))


@PROPS
@given(
    samples=st.lists(st.tuples(st.none() | any_float, any_float), min_size=1, max_size=60),
    tau=st.floats(min_value=0.0, max_value=10.0),
)
def test_p1_smoother_output_is_bounded(samples, tau):
    smoother = NeedleSmoother(NeedleConfig(tau_s=tau))
    for raw, now in samples:
        assert bounded(smoother.update(raw, now))


# -- P2: scale invariance ---------------------------------------------------------------

# Small perturbations keep every body vector well away from zero length
# (atan2(0, 0) has no meaningful angle to be invariant).
jitter = st.floats(min_value=-0.03, max_value=0.03)
# The framing gate measures shoulder width in the frame, i.e. distance, so it
# is deliberately NOT scale invariant; open it all the way to test the angles.
OPEN_FRAMING = replace(CFG, shoulder_width_min=1e-9, shoulder_width_max=1e9)


@PROPS
@given(
    deltas=st.lists(st.tuples(jitter, jitter), min_size=6, max_size=6),
    k=st.floats(min_value=1e-3, max_value=1e3),
)
def test_p2_angles_and_needle_are_scale_invariant(deltas, k):
    base = make_pose()
    pairs = zip(TRACKED, deltas, strict=True)
    coords = [(base[i].x + dx, base[i].y + dy) for i, (dx, dy) in pairs]
    scaled = [(x * k, y * k) for x, y in coords]
    a = score_pose(pose_from(coords), OPEN_FRAMING)
    b = score_pose(pose_from(scaled), OPEN_FRAMING)
    assert isinstance(a, ScoredPosture) and isinstance(b, ScoredPosture)
    for name in ("head_forward_deg", "trunk_lean_deg", "head_tilt_deg", "shoulder_level_deg"):
        assert math.isclose(getattr(a, name), getattr(b, name), abs_tol=1e-5), name
    assert math.isclose(raw_needle(a, CFG), raw_needle(b, CFG), abs_tol=1e-5)


# -- P3: anti-chatter / dwell -----------------------------------------------------------


@PROPS
@given(
    zones=st.lists(st.sampled_from([NEUTRAL, GOOD]), min_size=1, max_size=400),
    dts=st.lists(frame_dt, min_size=400, max_size=400),
)
def test_p3_neutral_and_good_noise_never_reminds(zones, dts):
    sm = machine()
    now = 0.0
    for result, dt in zip(zones, dts, strict=False):
        now += dt
        assert sm.update(result, now).nudge not in REMINDERS


@PROPS
@given(
    runs=st.lists(
        st.tuples(
            st.floats(min_value=0.0, max_value=TIMINGS.bad_sustain_s * 0.95),  # bad run
            st.floats(min_value=TIMINGS.smoothing_window_s + 1.1, max_value=4.0),  # good run
        ),
        min_size=1,
        max_size=12,
    ),
    dt=frame_dt,
)
def test_p3_bad_runs_shorter_than_sustain_never_remind(runs, dt):
    sm = machine()
    # Precondition: the session starts upright. The slow deviation baseline
    # seeds from the first scored frame, so a session that STARTS slouched
    # learns the slouch as neutral and later reads upright posture as a
    # deviation (documented in design.md; "Record good posture" anchors the
    # baseline to avoid exactly that).
    now = 0.0
    while now < 2.0:
        assert sm.update(GOOD, now).nudge not in REMINDERS
        now += dt
    for bad_s, good_s in runs:
        for result, duration in ((BAD, bad_s), (GOOD, good_s)):
            start = now
            while True:
                assert sm.update(result, now).nudge not in REMINDERS
                if now + dt > start + duration:
                    break
                now += dt
            now += dt  # next segment starts one frame later


# -- P4: idempotent reminders -----------------------------------------------------------

segment = st.tuples(st.sampled_from(ALL_RESULTS), st.floats(min_value=0.0, max_value=45.0))


def run_segments(segments, dt, sm=None):  # noqa: ANN001, ANN201 - test helper
    sm = sm or machine()
    now, out = 0.0, []
    for result, duration in segments:
        end = now + duration
        while now <= end:
            out.append((now, result, sm.update(result, now)))
            now += dt
    return out


@HEAVY
@given(segments=st.lists(segment, min_size=1, max_size=10), dt=st.floats(0.02, 0.5))
def test_p4_one_chime_per_episode_and_voice_spacing(segments, dt):
    in_bad = False
    chimes = 0
    chime_at = last_voice = None
    for now, _, tr in run_segments(segments, dt):
        assert tr.nudge is not Nudge.RECOVERY  # never emitted by the machine
        entering = tr.state in BAD_STATES and not in_bad
        if entering:
            chimes, chime_at, last_voice = 0, None, None
        if tr.nudge is Nudge.CHIME:
            assert entering, "CHIME only on entry to a bad episode"
            chimes += 1
            chime_at = now
        if tr.nudge is Nudge.VOICE:
            assert tr.state is PostureState.BAD_VOICE and chime_at is not None
            if last_voice is None:
                assert now - chime_at >= TIMINGS.voice_delay_s - SLACK
            else:
                assert now - last_voice >= TIMINGS.voice_repeat_cooldown_s - SLACK
            last_voice = now
        if tr.recovered:
            assert in_bad and tr.state is PostureState.GOOD
        assert chimes <= 1
        in_bad = tr.state in BAD_STATES


class RecordingAudio:
    def __init__(self) -> None:
        self.enqueued: list[Nudge] = []

    def enqueue(self, nudge: Nudge, *, force: bool = False) -> None:
        self.enqueued.append(nudge)


class ScriptDetector:
    def __init__(self) -> None:
        self.pose: list[SimpleLandmark] | None = make_pose()

    def __call__(self, frame: Frame) -> PoseDetection:
        return PoseDetection(self.pose)


SLOUCH_POSE = make_pose(
    {LEFT_EAR: SimpleLandmark(x=0.48, y=0.54), RIGHT_EAR: SimpleLandmark(x=0.56, y=0.54)}
)


@HEAVY
@given(
    segments=st.lists(
        st.tuples(st.sampled_from(["good", "bad", "none"]), st.floats(0.0, 8.0)),
        min_size=1, max_size=8,
    ),
    fps=st.sampled_from([5, 10, 15, 30]),
)
def test_p4_pipeline_enqueues_one_recovery_per_recovery(segments, fps):
    """End to end through the pipeline at any frame rate: each recovery to GOOD
    enqueues the good sound exactly once, and never more recoveries than chimes."""
    config = AppConfig(
        feedback=FeedbackConfig(
            positive_chime=PositiveChimeConfig(enabled=False),
            recovery_chime=RecoveryChimeConfig(enabled=True),
        )
    )
    audio, detector = RecordingAudio(), ScriptDetector()
    pipeline = PosturePipeline(SyntheticFrameSource(), config, audio=audio, detector=detector)
    color = np.zeros((4, 4, 3), dtype=np.uint8)
    poses = {"good": make_pose(), "bad": SLOUCH_POSE, "none": None}
    index, recoveries = 0, 0
    for kind, seconds in segments:
        detector.pose = poses[kind]
        for _ in range(int(seconds * fps)):
            tr = pipeline.process_once(Frame(color, index / fps))
            recoveries += tr.recovered
            index += 1
    assert audio.enqueued.count(Nudge.RECOVERY) == recoveries
    assert recoveries <= audio.enqueued.count(Nudge.CHIME)


# -- P5: glitch transparency ------------------------------------------------------------


@HEAVY
@given(
    segments=st.lists(segment, min_size=1, max_size=8),
    dt=st.floats(0.02, 0.5),
    glitch_every=st.integers(min_value=1, max_value=7),
)
def test_p5_nan_frames_do_not_change_the_timeline(segments, dt, glitch_every):
    clean = run_segments(segments, dt)
    sm = machine()
    for i, (now, result, expected) in enumerate(clean):
        if i % glitch_every == 0:
            # A glitch frame strictly between the previous frame and this one.
            held = sm.update(GLITCH, now - dt / 2)
            assert held.nudge is Nudge.NONE
        got = sm.update(result, now)
        assert (got.state, got.nudge, got.recovered) == (
            expected.state, expected.nudge, expected.recovered
        )


# -- P6: time safety --------------------------------------------------------------------


@PROPS
@given(
    steps=st.lists(
        st.tuples(st.sampled_from(ALL_RESULTS) | any_posture, st.floats(0.0, 5.0)),
        max_size=200,
    )
)
def test_p6_update_never_raises_for_non_decreasing_time(steps):
    sm = machine()
    now = 0.0
    for result, dt in steps:
        now += dt
        tr = sm.update(result, now)
        assert tr.state in PostureState
