"""Pipeline integration: the whole frame path on synthetic data, no camera.

Timelines are driven by frame timestamps (30 fps grid), so the chime/voice
schedule below is the real state machine's schedule with zero sleeps in the
deterministic tests; only the threaded smoke test touches the wall clock.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import replace

import numpy as np
import pytest

from conftest import make_pose
from posture_guard.camera import Frame, SourceStatus, SyntheticFrameSource
from posture_guard.config import AppConfig, FeedbackConfig, PositiveChimeConfig, ScoringConfig
from posture_guard.dashboard.hub import DashboardHub, ScoringThresholds
from posture_guard.feedback import FeedbackMode, RuntimeFeedback
from posture_guard.pipeline import PosturePipeline, placement_warnings, root_cause, wire_color_for
from posture_guard.pose import PoseDetection, SyntheticPoseDetector
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
    score_pose,
)
from posture_guard.state import Nudge


class RecordingAudio:
    """NudgeSink double recording the enqueue order."""

    def __init__(self) -> None:
        self.enqueued: list[Nudge] = []
        self.texts: list[str | None] = []

    def enqueue(self, nudge: Nudge, *, force: bool = False, text: str | None = None) -> None:
        self.enqueued.append(nudge)
        self.texts.append(text)


def fake_jpeg(
    color: np.ndarray, landmarks: object, state_text: str, info_text: str,
    reason_text: str = "", *,
    wire_color: str = "",
) -> bytes:
    return f"{state_text}|{info_text}|{reason_text}|{wire_color}".encode()


class MutableDetector:
    """Synthetic detector whose pose the timeline can switch mid-run."""

    def __init__(self, pose: Sequence[SimpleLandmark] | None):
        self.pose = pose

    def __call__(self, frame: Frame) -> PoseDetection:
        return PoseDetection(self.pose)


def make_frame(index: int) -> Frame:
    return Frame(color=np.zeros((480, 640, 3), dtype=np.uint8), timestamp_s=index / 30.0)


def feed(pipeline: PosturePipeline, detector: MutableDetector, seconds: float, index: int) -> int:
    """Feed 30 fps frames for a wall of simulated seconds; returns next index."""
    for _ in range(int(seconds * 30)):
        pipeline.process_once(make_frame(index))
        index += 1
    return index


def build_pipeline(
    detector: MutableDetector,
    feedback: RuntimeFeedback | None = None,
) -> tuple[PosturePipeline, DashboardHub, RecordingAudio]:
    hub = DashboardHub()
    audio = RecordingAudio()
    pipeline = PosturePipeline(
        SyntheticFrameSource(),
        AppConfig(),
        hub=hub,
        audio=audio,
        detector=detector,
        renderer=fake_jpeg,
        feedback=feedback,
    )
    return pipeline, hub, audio


def test_good_pose_reaches_good_state_with_zeroed_metrics() -> None:
    detector = MutableDetector(make_pose())
    pipeline, hub, _ = build_pipeline(detector)

    feed(pipeline, detector, 2.0, 0)

    snapshot, _ = hub.latest_metrics()
    assert snapshot.state == "good"
    assert snapshot.head_forward_deg == pytest.approx(0.0, abs=1.0)
    assert snapshot.trunk_lean_deg == pytest.approx(0.0, abs=1.0)
    assert len(snapshot.landmarks) == 6
    assert snapshot.warnings == ()
    assert snapshot.camera_connected is True
    # Config thresholds ride on every snapshot; the UI renders bands from them.
    scoring = pipeline._config.scoring
    assert snapshot.thresholds == ScoringThresholds(
        head_forward_deg=scoring.head_forward_deg,
        trunk_lean_deg=scoring.trunk_lean_deg,
        head_tilt_deg=scoring.head_tilt_deg,
        shoulder_level_deg=scoring.shoulder_level_deg,
        hysteresis_margin_deg=scoring.hysteresis_margin_deg,
        visibility_floor=scoring.visibility_floor,
    )
    assert snapshot.unreliable_detail is None


def test_full_nudge_timeline_chime_then_voice_then_recovery() -> None:
    detector = MutableDetector(make_pose())
    pipeline, hub, audio = build_pipeline(detector)

    index = feed(pipeline, detector, 2.0, 0)  # settle into GOOD
    assert hub.latest_metrics()[0].state == "good"

    detector.pose = make_pose(
        {
            7: SimpleLandmark(x=0.48, y=0.54),  # slouch: head-forward ~18.4 deg
            8: SimpleLandmark(x=0.56, y=0.54),
        }
    )
    index = feed(pipeline, detector, 2.5, index)  # bad sustained > 2 s
    assert hub.latest_metrics()[0].state == "bad_chime"
    assert audio.enqueued == [Nudge.CHIME]

    index = feed(pipeline, detector, 10.0, index)  # voice fires 10 s after the chime
    assert hub.latest_metrics()[0].state == "bad_voice"
    assert audio.enqueued == [Nudge.CHIME, Nudge.VOICE]

    index = feed(pipeline, detector, 1.0, index)  # still inside the 30 s voice cooldown
    assert audio.enqueued == [Nudge.CHIME, Nudge.VOICE]

    detector.pose = make_pose()
    feed(pipeline, detector, 4.0, index)  # recovery needs 3 s of good
    assert hub.latest_metrics()[0].state == "good"
    assert audio.enqueued == [Nudge.CHIME, Nudge.VOICE]  # silence on recovery


def _far_pose() -> list[SimpleLandmark]:
    """Shoulders span 0.06 of the frame: below the 0.12 framing floor."""
    return make_pose(
        {
            LEFT_SHOULDER: SimpleLandmark(x=0.47, y=0.60),
            RIGHT_SHOULDER: SimpleLandmark(x=0.53, y=0.60),
            LEFT_EAR: SimpleLandmark(x=0.49, y=0.55),
            RIGHT_EAR: SimpleLandmark(x=0.51, y=0.55),
        }
    )


def test_out_of_band_framing_surfaces_as_warning_not_no_person() -> None:
    """Regression (NO PERSON flap): the pose is detected, so sitting too far is
    an unscoreable frame for a present person — placement warning fires, the
    header never reports NO PERSON."""
    detector = MutableDetector(_far_pose())
    pipeline, hub, _ = build_pipeline(detector)

    feed(pipeline, detector, 3.0, 0)

    snapshot, _ = hub.latest_metrics()
    assert snapshot.state == "unreliable"
    assert snapshot.head_forward_deg is None
    assert len(snapshot.warnings) == 1
    assert snapshot.warnings[0].startswith("person too far")


def test_cropped_person_surfaces_low_visibility_warning() -> None:
    cropped = make_pose({RIGHT_SHOULDER: SimpleLandmark(x=0.60, y=0.60, visibility=0.1)})
    detector = MutableDetector(cropped)
    pipeline, hub, _ = build_pipeline(detector)

    feed(pipeline, detector, 1.0, 0)

    snapshot, _ = hub.latest_metrics()
    assert snapshot.state == "unreliable"
    assert snapshot.warnings == (
        "shoulders not visible - sit facing the camera, 0.6-1.2 m away",
    )
    # Landmark-level reliability detail: which tracked landmark failed and by
    # how much, consumed by the dashboard overlay and status row.
    assert snapshot.unreliable_detail == "shoulders not visible (right 0.10)"
    # Hips out of frame is the close-range geometry failure: name the lost
    # metric and the fix (move back), matching the runbook guidance.
    from posture_guard.pipeline import low_visibility_warning

    assert low_visibility_warning(
        make_pose({LEFT_HIP: SimpleLandmark(x=0.48, y=0.80, visibility=0.0),
                   RIGHT_HIP: SimpleLandmark(x=0.52, y=0.80, visibility=0.0)}),
        ScoringConfig(),
    ) == "hips not visible - trunk lean unavailable, move back to 0.6-1.2 m"


def test_low_visibility_warning_names_head_when_ears_cropped() -> None:
    from posture_guard.pipeline import low_visibility_warning

    cropped = make_pose({LEFT_EAR: SimpleLandmark(x=0.50, y=0.10, visibility=0.0),
                         RIGHT_EAR: SimpleLandmark(x=0.52, y=0.10, visibility=0.0)})
    detector = MutableDetector(cropped)
    pipeline, hub, _ = build_pipeline(detector)

    feed(pipeline, detector, 1.2, 0)

    snapshot, _ = hub.latest_metrics()
    assert snapshot.state == "unreliable"
    assert snapshot.warnings == (
        "head not visible - sit facing the camera, 0.6-1.2 m away",
    )
    # Pure-function fallback: no landmarks at all still names the generic fix.
    assert low_visibility_warning(None, pipeline._config.scoring) == (
        "person not fully in frame - sit facing the camera, 0.6-1.2 m away"
    )


def test_fps_converges_to_frame_rate() -> None:
    detector = MutableDetector(make_pose())
    pipeline, hub, _ = build_pipeline(detector)

    feed(pipeline, detector, 2.0, 0)

    snapshot, _ = hub.latest_metrics()
    assert snapshot.fps == pytest.approx(30.0, rel=0.01)


# -- feedback mode filter and nudge events -------------------------------------


def _drive_to_chime(detector: MutableDetector, pipeline: PosturePipeline, index: int) -> int:
    """Settle into GOOD, then slouch past the bad-sustain window."""
    index = feed(pipeline, detector, 2.0, index)
    detector.pose = make_pose(
        {
            7: SimpleLandmark(x=0.48, y=0.54),
            8: SimpleLandmark(x=0.56, y=0.54),
        }
    )
    return feed(pipeline, detector, 2.5, index)


def test_snapshot_without_feedback_wiring_reports_none() -> None:
    detector = MutableDetector(make_pose())
    pipeline, hub, _ = build_pipeline(detector)

    feed(pipeline, detector, 1.0, 0)

    snapshot, _ = hub.latest_metrics()
    assert snapshot.feedback is None
    assert snapshot.nudge_event is None


def test_silent_mode_drops_audio_but_state_and_events_continue() -> None:
    """The mode filter is the only enforcement point: the machine still emits
    and the dashboard still gets the (muted) visual event."""
    detector = MutableDetector(make_pose())
    feedback = RuntimeFeedback(mode=FeedbackMode.SILENT)
    pipeline, hub, audio = build_pipeline(detector, feedback)

    _drive_to_chime(detector, pipeline, 0)

    assert hub.latest_metrics()[0].state == "bad_chime"  # state logic unchanged
    assert audio.enqueued == []
    event = hub.latest_metrics()[0].nudge_event
    # The chime event names what to fix (the slouch here is head forward).
    assert event == {"kind": "chime", "seq": 1, "muted": True, "text": "Head forward"}
    assert hub.latest_metrics()[0].feedback is not None
    assert hub.latest_metrics()[0].feedback["mode"] == "silent"


def test_chime_only_mode_drops_voice_only() -> None:
    detector = MutableDetector(make_pose())
    feedback = RuntimeFeedback(mode=FeedbackMode.CHIME_ONLY)
    pipeline, hub, audio = build_pipeline(detector, feedback)

    index = _drive_to_chime(detector, pipeline, 0)
    assert audio.enqueued == [Nudge.CHIME]
    feed(pipeline, detector, 10.0, index)  # past the default 10 s voice delay

    assert hub.latest_metrics()[0].state == "bad_voice"
    assert audio.enqueued == [Nudge.CHIME]  # voice never reaches the sink
    # The voice event carries the specific spoken cue, not the generic prompt.
    assert hub.latest_metrics()[0].nudge_event == {
        "kind": "voice", "seq": 2, "muted": True,
        "text": "Head forward. Tuck your chin and bring your ears back over your shoulders.",
    }


def test_mode_takes_effect_on_the_next_nudge_without_restart() -> None:
    detector = MutableDetector(make_pose())
    feedback = RuntimeFeedback()  # chime + voice at start
    pipeline, hub, audio = build_pipeline(detector, feedback)

    index = _drive_to_chime(detector, pipeline, 0)
    assert audio.enqueued == [Nudge.CHIME]
    index = feed(pipeline, detector, 10.0, index)
    assert audio.enqueued == [Nudge.CHIME, Nudge.VOICE]

    # Presenter switches to silent mid-demo; the very next nudge is dropped.
    feedback.apply(mode="silent")
    index = feed(pipeline, detector, 30.0, index)  # past the 30 s repeat cooldown
    assert audio.enqueued == [Nudge.CHIME, Nudge.VOICE]
    assert hub.latest_metrics()[0].nudge_event["muted"] is True


def test_two_chime_emissions_produce_two_sequence_numbers() -> None:
    """Sequence numbers let the UI re-trigger the banner even when the state
    string is unchanged (spec: repeated nudges re-trigger the visual event)."""
    detector = MutableDetector(make_pose())
    feedback = RuntimeFeedback()
    pipeline, hub, _ = build_pipeline(detector, feedback)

    index = _drive_to_chime(detector, pipeline, 0)
    first = hub.latest_metrics()[0].nudge_event

    # Recover, then slouch again for a second chime.
    detector.pose = make_pose()
    index = feed(pipeline, detector, 4.0, index)
    index = _drive_to_chime(detector, pipeline, index)
    second = hub.latest_metrics()[0].nudge_event

    assert first["kind"] == "chime" and second["kind"] == "chime"
    assert second["seq"] > first["seq"]


def test_trunk_lean_optional_fires_reminders_with_hips_hidden() -> None:
    """High-mount reliability mode: hips permanently below the visibility floor
    must not block head-forward reminders (the stuck-UNRELIABLE bug report),
    and the trunk tile reports unavailable instead of a garbage angle."""
    hips_hidden = {
        LEFT_HIP: SimpleLandmark(x=0.44, y=0.90, visibility=0.3),
        RIGHT_HIP: SimpleLandmark(x=0.56, y=0.90, visibility=0.3),
    }
    detector = MutableDetector(make_pose(dict(hips_hidden)))
    hub = DashboardHub()
    audio = RecordingAudio()
    pipeline = PosturePipeline(
        SyntheticFrameSource(),
        AppConfig(scoring=ScoringConfig(trunk_lean_required=False)),
        hub=hub,
        audio=audio,
        detector=detector,
        renderer=fake_jpeg,
        feedback=RuntimeFeedback(),
    )

    index = feed(pipeline, detector, 2.0, 0)  # settles GOOD without hips
    detector.pose = make_pose(
        {
            7: SimpleLandmark(x=0.48, y=0.54),
            8: SimpleLandmark(x=0.56, y=0.54),
            **hips_hidden,
        }
    )
    feed(pipeline, detector, 2.5, index)  # slouch past bad_sustain_s

    assert hub.latest_metrics()[0].state == "bad_chime"
    assert audio.enqueued == [Nudge.CHIME]
    snapshot, _ = hub.latest_metrics()
    assert snapshot.trunk_lean_deg is None
    assert snapshot.trunk_note == "\u2014 trunk lean unavailable (hips not visible)"


def test_threaded_pipeline_runs_against_synthetic_source() -> None:
    hub = DashboardHub()
    audio = RecordingAudio()
    pipeline = PosturePipeline(
        SyntheticFrameSource(),
        AppConfig(),
        hub=hub,
        audio=audio,
        detector=SyntheticPoseDetector(),
        renderer=fake_jpeg,
    )
    pipeline.start()
    try:
        deadline = time.monotonic() + 5.0
        while hub.latest_metrics() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        snapshot, _ = hub.latest_metrics()
        assert snapshot is not None
        assert snapshot.state in ("no_person", "good")
        assert hub.latest_video() is not None
    finally:
        pipeline.close()


# -- placement_warnings unit coverage -------------------------------------------






def test_disconnected_camera_surfaces_error() -> None:
    camera = SourceStatus(connected=False, error="camera unavailable: boom")
    score = score_pose(make_pose(), ScoringConfig())

    warnings = placement_warnings(score, camera, ScoringConfig())

    assert warnings == ("camera unavailable: camera unavailable: boom",)




def _positive_pipeline(mode: FeedbackMode) -> tuple[PosturePipeline, DashboardHub, RecordingAudio]:
    config = AppConfig(
        feedback=FeedbackConfig(positive_chime=PositiveChimeConfig(enabled=True, every_seconds=5.0))
    )
    hub = DashboardHub()
    audio = RecordingAudio()
    pipeline = PosturePipeline(
        SyntheticFrameSource(),
        config,
        hub=hub,
        audio=audio,
        detector=MutableDetector(make_pose()),
        renderer=fake_jpeg,
        feedback=RuntimeFeedback(mode=mode),
    )
    return pipeline, hub, audio


def test_positive_chime_enqueued_after_sustained_good() -> None:
    pipeline, hub, audio = _positive_pipeline(FeedbackMode.CHIME_AND_VOICE)
    try:
        feed(pipeline, pipeline._detector, 8.0, 0)  # noqa: SLF001 - test harness access
        assert Nudge.POSITIVE_CHIME in audio.enqueued
        snapshot, _ = hub.latest_metrics()
        assert snapshot.nudge_event["kind"] == "positive_chime"
        assert snapshot.nudge_event["muted"] is False
    finally:
        pipeline.close()


def test_silent_mode_mutes_positive_chime_but_records_event() -> None:
    pipeline, hub, audio = _positive_pipeline(FeedbackMode.SILENT)
    try:
        feed(pipeline, pipeline._detector, 8.0, 0)  # noqa: SLF001 - test harness access
        assert audio.enqueued == []
        snapshot, _ = hub.latest_metrics()
        assert snapshot.nudge_event["kind"] == "positive_chime"
        assert snapshot.nudge_event["muted"] is True  # visible event, no audio
    finally:
        pipeline.close()


# -- root_cause and wire_color_for unit coverage ----------------------------------


def test_root_cause_flags_head_clipped_by_top_edge() -> None:
    pose = make_pose({LEFT_EAR: SimpleLandmark(x=0.46, y=0.05)})
    score = score_pose(pose, ScoringConfig())
    cause = root_cause(score, pose)
    assert cause == {"title": "top edge clipped", "action": "tilt camera up", "edge": "top"}


def test_root_cause_none_for_scored_in_frame_person() -> None:
    pose = make_pose()
    score = score_pose(pose, ScoringConfig())
    assert root_cause(score, pose) is None


def test_root_cause_low_visibility_reason() -> None:
    pose = make_pose(
        {LEFT_EAR: SimpleLandmark(x=0.46, y=0.45, visibility=0.1)}
    )
    result = score_pose(pose, ScoringConfig())
    assert isinstance(result, Unreliable)
    cause = root_cause(result, pose)
    assert cause["title"] == "low confidence"
    assert cause["action"] == "sit facing the camera"


def test_root_cause_framing_out_of_band_names_direction() -> None:
    far = _far_pose()
    cause = root_cause(score_pose(far, ScoringConfig()), far)
    assert cause["title"] == "person too far"
    assert cause["action"] == "move closer"
    close = make_pose(
        {
            LEFT_SHOULDER: SimpleLandmark(x=0.10, y=0.60),
            RIGHT_SHOULDER: SimpleLandmark(x=0.90, y=0.60),
        }
    )
    cause = root_cause(score_pose(close, ScoringConfig()), close)
    assert cause["title"] == "person too close"
    assert cause["action"] == "move back"


def test_root_cause_no_pose() -> None:
    result = score_pose(None, ScoringConfig())
    cause = root_cause(result, None)
    assert cause["title"] == "no person seen"
    assert cause["edge"] is None


def test_root_cause_boundary_check_beats_unreliable_reason() -> None:
    pose = make_pose({RIGHT_EAR: SimpleLandmark(x=0.54, y=0.04, visibility=0.1)})
    result = score_pose(pose, ScoringConfig())
    assert isinstance(result, Unreliable)
    cause = root_cause(result, pose)
    assert cause["title"] == "top edge clipped"


def test_wire_color_follows_state_before_angles() -> None:
    slouched = ScoredPosture(
        head_forward_deg=25.0, trunk_lean_deg=0.0, head_tilt_deg=0.0,
        shoulder_level_deg=0.0,
    )
    upright = replace(slouched, head_forward_deg=2.0)
    # Confirmed breach outranks the raw angle: crimson, not amber.
    assert wire_color_for("bad_voice", slouched, ScoringConfig()) == "#ef4444"
    # Drift: out of band but not yet confirmed.
    assert wire_color_for("good", slouched, ScoringConfig()) == "#f59e0b"
    assert wire_color_for("good", upright, ScoringConfig()) == "#10b981"
    # Untrustworthy frame beats every angle.
    assert wire_color_for("unreliable", slouched, ScoringConfig()) == "#8b95a3"


def test_snapshot_carries_root_cause_and_wire_color() -> None:
    pose = make_pose({LEFT_EAR: SimpleLandmark(x=0.46, y=0.05)})
    detector = MutableDetector(pose)
    pipeline, hub, _ = build_pipeline(detector)
    pipeline.process_once(make_frame(0))
    snapshot, _ = hub.latest_metrics()
    payload = snapshot.to_payload()
    assert payload["root_cause"]["title"] == "top edge clipped"
    # Scored frame inside the frame edge with a centered head: no cause.
    detector.pose = make_pose()
    pipeline.process_once(make_frame(1))
    snapshot, _ = hub.latest_metrics()
    assert snapshot.to_payload()["root_cause"] is None


# -- webcam frames, needle, calibration, recovery cue, glitch hold --------------------


def _slouch() -> list[SimpleLandmark]:
    return make_pose(
        {
            LEFT_EAR: SimpleLandmark(x=0.48, y=0.54),  # head-forward ~18.4 deg
            RIGHT_EAR: SimpleLandmark(x=0.56, y=0.54),
        }
    )


def test_webcam_frames_score_and_nudge() -> None:
    detector = MutableDetector(make_pose())
    pipeline, hub, audio = build_pipeline(detector)
    index = feed(pipeline, detector, 2.0, 0)
    snapshot = hub.latest_metrics()[0]
    assert snapshot.state == "good"

    detector.pose = _slouch()
    feed(pipeline, detector, 2.5, index)
    assert hub.latest_metrics()[0].state == "bad_chime"
    assert audio.enqueued == [Nudge.CHIME]


def test_too_far_carries_root_cause() -> None:
    detector = MutableDetector(_far_pose())
    pipeline, hub, _ = build_pipeline(detector)
    feed(pipeline, detector, 0.5, 0)
    snapshot = hub.latest_metrics()[0]
    assert snapshot.state == "unreliable"
    assert any(w.startswith("person too far") for w in snapshot.warnings)
    assert snapshot.root_cause["title"] == "person too far"


def test_needle_is_published_and_tracks_posture() -> None:
    detector = MutableDetector(make_pose())
    pipeline, hub, _ = build_pipeline(detector)
    index = feed(pipeline, detector, 1.0, 0)
    snapshot = hub.latest_metrics()[0]
    assert snapshot.needle == pytest.approx(-1.0, abs=0.01)
    assert snapshot.needle_calibrated is False
    assert snapshot.to_payload()["needle"]["value"] == pytest.approx(-1.0, abs=0.01)

    detector.pose = _slouch()
    feed(pipeline, detector, 3.0, index)
    assert pipeline.needle > -0.6  # head-forward at its cap, others level


def test_needle_holds_through_unscoreable_frames() -> None:
    detector = MutableDetector(make_pose())
    pipeline, _, _ = build_pipeline(detector)
    index = feed(pipeline, detector, 1.0, 0)
    before = pipeline.needle
    detector.pose = None
    feed(pipeline, detector, 1.0, index)
    assert pipeline.needle == before


def test_calibration_drives_needle_and_anchors_baseline() -> None:
    from posture_guard.calibration import CalibrationKind

    detector = MutableDetector(make_pose())
    pipeline, hub, _ = build_pipeline(detector)
    pipeline.calibration.start(CalibrationKind.GOOD)
    index = feed(pipeline, detector, 3.5, 0)
    assert pipeline._state_machine._baseline._anchor is not None  # good anchors baseline

    detector.pose = _slouch()
    pipeline.calibration.start(CalibrationKind.BAD)
    index = feed(pipeline, detector, 3.5, index)
    index = feed(pipeline, detector, 2.0, index)
    snapshot = hub.latest_metrics()[0]
    assert snapshot.needle_calibrated is True
    assert snapshot.calibration["calibrated"] is True
    assert snapshot.needle == pytest.approx(1.0, abs=0.01)  # at the slouch centroid

    detector.pose = make_pose()
    feed(pipeline, detector, 3.0, index)
    assert hub.latest_metrics()[0].needle == pytest.approx(-1.0, abs=0.01)


def test_recovery_chime_enqueued_once_when_enabled() -> None:
    from posture_guard.config import RecoveryChimeConfig

    detector = MutableDetector(make_pose())
    hub, audio = DashboardHub(), RecordingAudio()
    config = AppConfig(feedback=FeedbackConfig(recovery_chime=RecoveryChimeConfig(enabled=True)))
    pipeline = PosturePipeline(
        SyntheticFrameSource(), config, hub=hub, audio=audio,
        detector=detector, renderer=fake_jpeg,
    )
    index = feed(pipeline, detector, 2.0, 0)
    detector.pose = _slouch()
    index = feed(pipeline, detector, 2.5, index)
    detector.pose = make_pose()
    feed(pipeline, detector, 4.0, index)
    assert audio.enqueued == [Nudge.CHIME, Nudge.RECOVERY]
    assert hub.latest_metrics()[0].state == "good"


def test_recovery_chime_off_by_default() -> None:
    detector = MutableDetector(make_pose())
    pipeline, _, audio = build_pipeline(detector)
    index = feed(pipeline, detector, 2.0, 0)
    detector.pose = _slouch()
    index = feed(pipeline, detector, 2.5, index)
    detector.pose = make_pose()
    feed(pipeline, detector, 4.0, index)
    assert Nudge.RECOVERY not in audio.enqueued


def test_nan_glitch_frames_hold_state_and_warn() -> None:
    detector = MutableDetector(make_pose())
    pipeline, hub, _ = build_pipeline(detector)
    index = feed(pipeline, detector, 2.0, 0)
    assert hub.latest_metrics()[0].state == "good"
    detector.pose = make_pose({LEFT_EAR: SimpleLandmark(x=float("nan"), y=0.45)})
    feed(pipeline, detector, 1.0, index)
    snapshot = hub.latest_metrics()[0]
    assert snapshot.state == "good"
    assert any("tracking glitch" in w for w in snapshot.warnings)


# -- specific posture cues ------------------------------------------------------------


def test_cue_is_published_and_spoken_with_the_voice_reminder() -> None:
    detector = MutableDetector(make_pose())
    pipeline, hub, audio = build_pipeline(detector)
    index = feed(pipeline, detector, 2.0, 0)
    assert hub.latest_metrics()[0].cue is None  # upright: nothing to fix

    detector.pose = _slouch()
    feed(pipeline, detector, 12.5, index)  # chime at ~2 s, voice 10 s later
    snapshot = hub.latest_metrics()[0]
    assert snapshot.cue["title"] == "Head forward"
    assert snapshot.to_payload()["cue"]["id"] == "head_forward:-"
    assert audio.enqueued == [Nudge.CHIME, Nudge.VOICE]
    assert audio.texts == [None, snapshot.cue["say"]]  # the voice says what to fix


def test_specific_cues_off_keeps_the_configured_prompt() -> None:
    from posture_guard.config import AudioConfig

    detector = MutableDetector(make_pose())
    hub, audio = DashboardHub(), RecordingAudio()
    config = AppConfig(audio=AudioConfig(specific_cues=False))
    pipeline = PosturePipeline(
        SyntheticFrameSource(), config, hub=hub, audio=audio,
        detector=detector, renderer=fake_jpeg,
    )
    index = feed(pipeline, detector, 2.0, 0)
    detector.pose = _slouch()
    feed(pipeline, detector, 12.5, index)
    assert audio.enqueued == [Nudge.CHIME, Nudge.VOICE]
    assert audio.texts == [None, None]


def test_cue_clears_on_unscoreable_frames() -> None:
    detector = MutableDetector(_slouch())
    pipeline, _, _ = build_pipeline(detector)
    index = feed(pipeline, detector, 1.0, 0)
    assert pipeline.cue is not None
    detector.pose = None
    feed(pipeline, detector, 0.5, index)
    assert pipeline.cue is None
