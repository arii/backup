"""Deterministic state-machine timeline tests.

Timestamps are injected; there are no sleeps and no wall-clock reads, so the
chime/voice schedule is asserted to the exact sample. Sample grid is 10 Hz
(0.1 s). Reference schedule for the default config:

    person appears 0.0        -> GOOD confirmed at 1.0
    slouch starts 10.0        -> chime at 12.0 (bad_sustain)
                              -> voice at 22.0 (voice_delay after chime)
                              -> voice repeats at 52.0, 82.0 (30 s cooldown)
    good from 20.1 in the recovery case -> back to GOOD at 23.1
"""

from __future__ import annotations

import pytest

from conftest import make_pose
from posture_guard.config import (
    BaselineDeviationConfig,
    FeedbackConfig,
    PositiveChimeConfig,
    ScoringConfig,
    StateConfig,
)
from posture_guard.feedback import RuntimeFeedback
from posture_guard.scoring import (
    LEFT_EAR,
    LEFT_HIP,
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

GOOD = score_pose(make_pose(), CFG)


def _bad_pose_score() -> ScoredPosture:
    """A slouched pose (head-forward ~18.4 deg) that lands in the bad zone."""
    pose = make_pose(
        {
            LEFT_EAR: SimpleLandmark(x=0.48, y=0.54),
            RIGHT_EAR: SimpleLandmark(x=0.56, y=0.54),
        }
    )
    return score_pose(pose, CFG)


NO_POSE = Unreliable(UnreliableReason.NO_POSE)
TOO_FAR = Unreliable(UnreliableReason.FRAMING_OUT_OF_BAND, "too far: shoulder width 0.05")
LOW_VIS = Unreliable(UnreliableReason.LOW_VISIBILITY)


def run(machine: PostureStateMachine, samples: list[tuple[float, object]]) -> list[object]:
    return [machine.update(result, now) for now, result in samples]


def grid(start: float, stop: float, step: float, result) -> list[tuple[float, object]]:  # noqa: ANN001
    now = start
    out = []
    while now <= stop + 1e-9:
        out.append((round(now, 3), result))
        now += step
    return out


class TestPositiveChime:
    """Positive reinforcement: in GOOD state, fire at most once per
    every_seconds of continuously good posture; the timer restarts on fire and
    on any departure from GOOD."""

    POSITIVE = FeedbackConfig(positive_chime=PositiveChimeConfig(enabled=True, every_seconds=10.0))

    def _machine(self, positive: FeedbackConfig | None = POSITIVE) -> PostureStateMachine:
        return PostureStateMachine(TIMINGS, CFG, positive_chime=positive)

    @staticmethod
    def _positive_times(samples, transitions):  # noqa: ANN001
        return [
            now for (now, _), transition in zip(samples, transitions, strict=False)
            if transition.nudge is Nudge.POSITIVE_CHIME
        ]

    def test_fires_only_after_sustained_good(self) -> None:
        machine = self._machine()
        samples = grid(0.0, 11.5, 0.1, GOOD)
        transitions = run(machine, samples)
        # GOOD confirmed at 1.0 -> first positive chime one full interval later.
        assert self._positive_times(samples, transitions) == [11.0]

    def test_cooldown_restarts_after_each_fire(self) -> None:
        machine = self._machine()
        samples = grid(0.0, 21.5, 0.1, GOOD)
        transitions = run(machine, samples)
        assert self._positive_times(samples, transitions) == [11.0, 21.0]

    def test_disabled_never_fires(self) -> None:
        machine = self._machine(
            FeedbackConfig(positive_chime=PositiveChimeConfig(enabled=False, every_seconds=10.0))
        )
        samples = grid(0.0, 25.0, 0.1, GOOD)
        transitions = run(machine, samples)
        assert self._positive_times(samples, transitions) == []

    def test_bad_episode_resets_the_interval(self) -> None:
        machine = self._machine()
        samples = grid(0.0, 12.0, 0.1, GOOD)
        samples += grid(12.1, 16.0, 0.1, _bad_pose_score())
        samples += grid(16.1, 29.5, 0.1, GOOD)
        transitions = run(machine, samples)
        # Recovered to GOOD at ~19.1 (recovery_good_s) -> next fire 10 s later.
        assert self._positive_times(samples, transitions) == pytest.approx([11.0, 29.2])

    def test_unreliable_frames_reset_the_interval(self) -> None:
        machine = self._machine()
        samples = grid(0.0, 9.0, 0.1, GOOD)
        samples += grid(9.1, 9.5, 0.1, LOW_VIS)
        samples += grid(9.6, 12.0, 0.1, GOOD)
        transitions = run(machine, samples)
        # GOOD re-confirmed at ~9.6 after the unreliable gap -> no fire by 12.0.
        assert self._positive_times(samples, transitions) == []


class TestLiveVoiceTimings:
    """Runtime voice-timing override: edits take effect with no restart
    (spec acceptance: verified by a state-machine test with a runtime override)."""

    def _machine(self, feedback: RuntimeFeedback) -> PostureStateMachine:
        return PostureStateMachine(TIMINGS, CFG, timings_override=feedback)

    @staticmethod
    def _voice_times(samples, transitions):  # noqa: ANN001
        return [
            now for (now, _), transition in zip(samples, transitions, strict=False)
            if transition.nudge is Nudge.VOICE
        ]

    def test_override_shortens_voice_delay_and_cooldown(self) -> None:
        feedback = RuntimeFeedback(voice_delay_s=3.0, voice_repeat_cooldown_s=6.0)
        machine = self._machine(feedback)

        samples = grid(0.0, 12.0, 0.1, _bad_pose_score())
        transitions = run(machine, samples)

        voice_times = self._voice_times(samples, transitions)
        # Chime at 2.0 (bad_sustain); voice 3 s later; repeat 6 s after that.
        assert voice_times[0] == pytest.approx(5.0)
        assert voice_times[1] == pytest.approx(11.0)

    def test_mid_run_edit_takes_effect_on_the_next_nudge(self) -> None:
        feedback = RuntimeFeedback()  # default 10 s delay at start
        machine = self._machine(feedback)

        samples = grid(0.0, 6.0, 0.1, _bad_pose_score())
        transitions = run(machine, samples)
        assert self._voice_times(samples, transitions) == []  # no voice before 6 s
        chime_times = [
            now for (now, _), transition in zip(samples, transitions, strict=False)
            if transition.nudge is Nudge.CHIME
        ]
        assert chime_times == [pytest.approx(2.0)]

        # Presenter tightens the delay mid-demo; the first sample that now
        # satisfies the edited delay fires the voice prompt.
        feedback.apply(voice_delay_s=1.5)
        samples = grid(6.0, 8.0, 0.1, _bad_pose_score())
        transitions = run(machine, samples)

        voice_times = self._voice_times(samples, transitions)
        assert voice_times == [pytest.approx(6.0)]  # 6.0 - chime 2.0 >= edited delay 1.5

    def test_no_override_keeps_config_schedule(self) -> None:
        machine = PostureStateMachine(TIMINGS, CFG)

        # Bad from t=0: chime at 2.0 (bad_sustain), voice at 12.0 (config
        # delay 10.0), repeat at 42.0 (config cooldown 30.0).
        samples = grid(0.0, 43.0, 0.1, _bad_pose_score())
        transitions = run(machine, samples)

        voice_times = self._voice_times(samples, transitions)
        assert voice_times[0] == pytest.approx(12.0)
        assert voice_times[1] == pytest.approx(42.0)


class TestNudgeSchedule:
    @staticmethod
    def _at(samples, transitions, state, nudge):  # noqa: ANN001
        """(timestamp, transition) pairs where state and nudge match."""
        return [
            (now, tr)
            for (now, _), tr in zip(samples, transitions, strict=True)
            if tr.state is state and tr.nudge is nudge
        ]

    def test_full_timeline_chime_and_voice_schedule(self):
        """Good 0.0-9.9 -> GOOD at 1.0; slouch from 10.0 -> chime exactly at
        12.0 (+2 s of bad), voice exactly at 22.0 (chime + 10 s)."""
        sm = PostureStateMachine(TIMINGS, CFG)
        samples = grid(0.0, 9.9, 0.1, GOOD) + grid(10.0, 30.0, 0.1, _bad_pose_score())
        transitions = run(sm, samples)

        good_entries = self._at(samples, transitions, PostureState.GOOD, Nudge.NONE)
        assert good_entries[0][0] == 1.0

        chimes = self._at(samples, transitions, PostureState.BAD_CHIME, Nudge.CHIME)
        assert len(chimes) == 1
        assert chimes[0][0] == 12.0
        assert chimes[0][1].seconds_bad == pytest.approx(2.0)

        voices = self._at(samples, transitions, PostureState.BAD_VOICE, Nudge.VOICE)
        assert voices[0][0] == 22.0
        assert voices[0][1].state is PostureState.BAD_VOICE

    def test_voice_repeats_at_most_every_30s(self):
        sm = PostureStateMachine(TIMINGS, CFG)
        samples = grid(0.0, 9.9, 0.1, GOOD) + grid(10.0, 90.0, 0.1, _bad_pose_score())
        transitions = run(sm, samples)

        voices = self._at(samples, transitions, PostureState.BAD_VOICE, Nudge.VOICE)
        voice_times = [t for t, _ in voices]
        assert voice_times == [22.0, 52.0, 82.0]
        assert all(
            later - earlier >= TIMINGS.voice_repeat_cooldown_s - 1e-9
            for earlier, later in zip(voice_times, voice_times[1:], strict=False)
        )

    def test_no_voice_before_voice_delay_elapses(self):
        sm = PostureStateMachine(TIMINGS, CFG)
        samples = grid(0.0, 9.9, 0.1, GOOD) + grid(10.0, 21.9, 0.1, _bad_pose_score())
        transitions = run(sm, samples)
        # Voice is due at 22.0 (chime 12.0 + 10 s); the timeline stops at
        # 21.9, so no VOICE may have fired yet.
        assert all(tr.nudge is not Nudge.VOICE for tr in transitions)

    def test_recovery_to_good_after_3s_of_good_is_silent(self):
        sm = PostureStateMachine(TIMINGS, CFG)
        samples = (
            grid(0.0, 9.9, 0.1, GOOD)
            + grid(10.0, 20.0, 0.1, _bad_pose_score())
            + grid(20.1, 30.0, 0.1, GOOD)
        )
        transitions = run(sm, samples)

        recovered = [
            (now, tr)
            for (now, _), tr in zip(samples, transitions, strict=True)
            if tr.state is PostureState.GOOD and now > 12.0  # after the chime at 12.0
        ]
        # good_since = 20.1 (first good sample after the bad streak);
        # recovery needs recovery_good (3.0) from that streak start.
        assert recovered[0][0] == 23.1
        assert recovered[0][1].nudge is Nudge.NONE


class TestSmoothingAndHysteresis:
    def test_single_bad_frame_does_not_leave_good(self):
        sm = PostureStateMachine(TIMINGS, CFG)
        transitions = run(
            sm, grid(0.0, 3.0, 0.1, GOOD) + [(3.1, _bad_pose_score())] + grid(3.2, 5.0, 0.1, GOOD)
        )
        assert all(tr.state is not PostureState.BAD_CHIME for tr in transitions)

    def test_hysteresis_band_holds_bad_state(self):
        """Uneven shoulders (~5.7 deg) sits between exit (3) and enter (6):
        neither recovered nor re-entered, so BAD_CHIME holds through 21.9 —
        silent, with voice escalation due only at 22.0."""
        neutral = score_pose(make_pose({RIGHT_SHOULDER: SimpleLandmark(x=0.60, y=0.62)}), CFG)
        sm = PostureStateMachine(TIMINGS, CFG)
        run(sm, grid(0.0, 9.9, 0.1, GOOD))
        run(sm, grid(10.0, 12.0, 0.1, _bad_pose_score()))
        assert sm.state is PostureState.BAD_CHIME
        tail = run(sm, grid(12.1, 21.9, 0.1, neutral))
        assert all(tr.state is PostureState.BAD_CHIME for tr in tail)
        assert all(tr.nudge is not Nudge.VOICE for tr in tail)


class TestUnreliableAndAbsent:
    def test_low_visibility_is_silent_and_resets_bad_streak(self):
        sm = PostureStateMachine(TIMINGS, CFG)
        run(sm, grid(0.0, 10.0, 0.1, GOOD))
        run(sm, grid(10.1, 11.5, 0.1, _bad_pose_score()))
        tr = sm.update(LOW_VIS, 11.6)
        assert tr.state is PostureState.UNRELIABLE
        assert tr.nudge is Nudge.NONE

        # Escalation restarts: bad must be sustained afresh after data returns.
        samples = grid(11.7, 13.0, 0.1, _bad_pose_score())
        transitions = run(sm, samples)
        assert all(tr.nudge is not Nudge.CHIME for tr in transitions)

    def test_framing_out_of_band_is_unreliable(self):
        sm = PostureStateMachine(TIMINGS, CFG)
        tr = sm.update(TOO_FAR, 5.0)
        assert tr.state is PostureState.UNRELIABLE

    def test_no_pose_times_out_to_no_person(self):
        sm = PostureStateMachine(TIMINGS, CFG)
        run(sm, grid(0.0, 5.0, 0.1, GOOD))
        samples = grid(5.1, 8.0, 0.1, NO_POSE)
        transitions = run(sm, samples)
        no_person = [
            (now, tr)
            for (now, _), tr in zip(samples, transitions, strict=True)
            if tr.state is PostureState.NO_PERSON
        ]
        assert no_person[0][0] == pytest.approx(7.1)  # absent_since 5.1 + 2.0 timeout

    def test_person_leaving_cancels_pending_voice(self):
        sm = PostureStateMachine(TIMINGS, CFG)
        run(sm, grid(0.0, 9.9, 0.1, GOOD))
        run(sm, grid(10.0, 12.0, 0.1, _bad_pose_score()))
        assert sm.state is PostureState.BAD_CHIME
        # Chime was at 12.0; person leaves before chime_at + 10.0.
        transitions = run(sm, grid(12.1, 25.0, 0.1, NO_POSE))
        assert any(tr.state is PostureState.NO_PERSON for tr in transitions)
        assert all(tr.nudge is not Nudge.VOICE for tr in transitions)

    def test_no_pose_feeds_no_person_timer(self):
        """NO_PERSON requires no pose detected, sustained."""
        sm = PostureStateMachine(TIMINGS, CFG)
        run(sm, grid(0.0, 5.0, 0.1, GOOD))
        transitions = run(sm, grid(5.1, 8.0, 0.1, NO_POSE))
        assert transitions[-1].state is PostureState.NO_PERSON

    def test_out_of_band_framing_with_tracked_pose_is_unreliable_not_absent(self):
        """Regression (NO PERSON flap): the pose is detected, so sitting too far
        or too close is an unscoreable frame — it must never feed the
        no-person timer."""
        sm = PostureStateMachine(TIMINGS, CFG)
        run(sm, grid(0.0, 5.0, 0.1, GOOD))
        transitions = run(sm, grid(5.1, 8.0, 0.1, TOO_FAR))
        assert {t.state for t in transitions} == {PostureState.UNRELIABLE}

    def test_person_returning_from_no_person_gets_good_confirmation(self):
        sm = PostureStateMachine(TIMINGS, CFG)
        run(sm, grid(0.0, 5.0, 0.1, GOOD))
        run(sm, grid(5.1, 8.0, 0.1, NO_POSE))
        transitions = run(sm, grid(8.1, 12.0, 0.1, GOOD))
        assert transitions[-1].state is PostureState.GOOD
        assert all(tr.nudge is not Nudge.CHIME for tr in transitions)


def _scored(head_forward: float, trunk: float = 0.0) -> ScoredPosture:
    """Synthetic score with control over the head-forward angle only."""
    return ScoredPosture(
        head_forward_deg=head_forward,
        trunk_lean_deg=trunk,
        head_tilt_deg=0.0,
        shoulder_level_deg=0.0,
    )


class TestBaselineDeviation:
    """scoring.baseline_deviation: a slow EMA baseline of each angle catches
    whole-torso slouch that keeps head-vs-shoulder angles small. These tests
    exercise the check end-to-end through the state machine."""

    def test_sustained_drift_breaches_while_raw_angles_stay_good(self):
        """Neutral calibrated at -2 deg (inside the 8 deg band); the person then
        drifts to +7 deg. Raw angles never breach, but the 9 deg deviation from
        their own recent neutral does — chime after bad_sustain_s."""
        machine = PostureStateMachine(TIMINGS, CFG)
        run(machine, grid(0.0, 30.0, 0.1, _scored(-2.0)))
        assert machine.state is PostureState.GOOD

        samples = grid(30.0, 34.0, 0.1, _scored(7.0))
        transitions = run(machine, samples)
        chimes = [t for t in transitions if t.nudge is Nudge.CHIME]
        assert len(chimes) == 1  # deviation zone feeds the same smoothing+sustain
        assert chimes[0].state is PostureState.BAD_CHIME
        assert chimes[0].seconds_bad is not None
        assert chimes[0].seconds_bad == pytest.approx(2.0, abs=0.1)

    def test_fast_transient_noise_does_not_nudge(self):
        """A 0.2 s deviation excursion (under the 0.3 s smoothing window) never
        confirms a bad streak, and the EMA baseline shrugs it off."""
        machine = PostureStateMachine(TIMINGS, CFG)
        run(machine, grid(0.0, 30.0, 0.1, _scored(-2.0)))
        assert machine.state is PostureState.GOOD

        samples = (
            grid(30.0, 30.1, 0.1, _scored(7.0))  # 0.2 s excursion
            + grid(30.2, 34.0, 0.1, _scored(-2.0))
        )
        transitions = run(machine, samples)
        assert all(t.nudge is Nudge.NONE for t in transitions)
        assert machine.state is PostureState.GOOD

    def test_feature_off_restores_current_behavior(self):
        """baseline_deviation.enabled=false: the machine never sees a deviation
        zone — the exact same drift timeline that chimes above stays GOOD."""
        cfg = ScoringConfig(
            baseline_deviation=BaselineDeviationConfig(enabled=False)
        )
        machine = PostureStateMachine(TIMINGS, cfg)
        run(machine, grid(0.0, 30.0, 0.1, _scored(-2.0)))
        assert machine.state is PostureState.GOOD

        transitions = run(machine, grid(30.0, 34.0, 0.1, _scored(7.0)))
        assert all(t.nudge is Nudge.NONE for t in transitions)
        assert machine.state is PostureState.GOOD

    def test_no_person_recalibrates_baseline(self):
        """NO_PERSON resets the baseline so a new sitting context (or person)
        calibrates from its own first scored frame, not the old neutral."""
        machine = PostureStateMachine(TIMINGS, CFG)
        run(machine, grid(0.0, 30.0, 0.1, _scored(-4.0)))
        assert machine.state is PostureState.GOOD
        # Lose the pose long enough to enter NO_PERSON (absence means no pose
        # detected — sitting too far with a tracked pose is UNRELIABLE).
        run(machine, grid(30.0, 32.5, 0.1, NO_POSE))
        assert machine.state is PostureState.NO_PERSON

        # Return at +4.9 deg: raw-good (below the 5 deg exit threshold), but
        # 8.9 deg from the old -4 deg baseline — it would breach deviation if
        # the stale baseline survived the absence. With the reset, the fresh
        # baseline anchors at +4.9 deg and the person sits in GOOD.
        transitions = run(machine, grid(32.5, 36.0, 0.1, _scored(4.9)))
        assert all(t.nudge is Nudge.NONE for t in transitions)
        assert machine.state is PostureState.GOOD


class TestSustainHysteresis:
    """Hysteresis applies to the sustain streak itself: once a bad streak is
    counting, neutral-band frames (between threshold - margin and threshold)
    must not reset it — only falling below threshold - margin does. Regression
    for boundary-hover chatter: a live instance wavering 11.5-12.4 deg against
    a 12.0 threshold never accumulated a 2 s bad streak, so feedback never
    fired even though posture sat at the threshold."""

    BOUNDARY_CFG = ScoringConfig(head_forward_deg=12.0, hysteresis_margin_deg=3.0)

    def _machine(self) -> PostureStateMachine:
        return PostureStateMachine(TIMINGS, self.BOUNDARY_CFG)

    @staticmethod
    def _chime_times(samples, transitions):  # noqa: ANN001
        return [
            now
            for (now, _), t in zip(samples, transitions, strict=False)
            if t.nudge is Nudge.CHIME
        ]

    def test_wavering_boundary_posture_accumulates_a_chime(self):
        """30 frames bad (12.2-12.4), 30 neutral (11.5-11.9), repeating: the
        streak must survive the neutral dips and chime after bad_sustain_s."""
        machine = self._machine()
        samples: list[tuple[float, object]] = []
        now = 0.0
        while now <= 4.0 + 1e-9:
            angle = 12.3 if (round(now * 10) % 6) < 3 else 11.7
            samples.append((round(now, 3), _scored(angle)))
            now += 0.1
        transitions = run(machine, samples)

        chimes = self._chime_times(samples, transitions)
        assert chimes == [pytest.approx(2.0)]  # first bad frame at t=0 + 2 s

    def test_sustained_below_exit_threshold_resets_the_streak(self):
        """Falling below threshold - margin (12 - 3 = 9) resets the counting
        streak: wavering afterwards needs a full bad_sustain_s again, it does
        not chime off the time already accumulated before the reset."""
        machine = self._machine()

        def wavering(t: float) -> ScoredPosture:
            return _scored(12.3 if (round(t * 10) % 6) < 3 else 11.7)

        # 1 s of boundary wavering starts a streak; 1 s clearly good (8 deg,
        # below the 9 deg exit threshold) resets it.
        run(machine, [(round(i * 0.1, 3), wavering(i * 0.1)) for i in range(10)])
        run(machine, grid(1.0, 2.0, 0.1, _scored(8.0)))

        # Wavering resumes at 2.0; the good frames age out of the 0.3 s window
        # by ~2.3, so the chime lands a full 2 s after the streak restarts.
        samples = [(round(2.0 + i * 0.1, 3), wavering(2.0 + i * 0.1)) for i in range(26)]
        transitions = run(machine, samples)

        chimes = self._chime_times(samples, transitions)
        # The essential property: a full fresh bad_sustain_s elapses after the
        # reset before the chime. Given the wavering pattern's phase after the
        # good frames age out (~2.4), the streak restarts at the first bad
        # frame (2.4) and chimes at 4.4 — definitely not off the pre-reset
        # clock, which would have chimed by ~3.2.
        assert len(chimes) == 1
        assert chimes[0] >= 4.0

    def test_clearly_good_posture_keeps_existing_sustain_behavior(self):
        """Clearly good posture (below the exit threshold) behaves exactly as
        before: GOOD confirmation, no nudges, and a constant breach after a
        clearly-good stretch chimes at bad_sustain_s on the dot."""
        machine = self._machine()
        run(machine, grid(0.0, 10.0, 0.1, _scored(8.0)))
        assert machine.state is PostureState.GOOD
        assert machine._bad_since is None  # no streak ever started

        samples = grid(10.0, 12.5, 0.1, _scored(12.3))
        transitions = run(machine, samples)
        # First bad frame at 10.0; once the good frames age out of the 0.3 s
        # smoothing window (the window keeps its boundary sample, so 10.0 is
        # still in it at 10.3) the streak counts from 10.0 and the chime lands
        # at 12.0: bad_sustain_s after the first bad frame, on the dot.
        assert self._chime_times(samples, transitions) == [pytest.approx(12.0)]


class TestNoPersonFlap:
    """Regression: NO PERSON must require no pose detected. A person who sits
    out of the framing band or whose landmarks fall below the visibility
    floor is present but unscoreable (UNRELIABLE) — never absent. The field
    flap showed the header on NO PERSON for seconds while the wireframe
    rendered and the metrics displayed the last reading."""

    LOWVIS = score_pose(
        make_pose(
            {
                LEFT_HIP: SimpleLandmark(x=0.44, y=0.90, visibility=0.2),
                RIGHT_HIP: SimpleLandmark(x=0.56, y=0.90, visibility=0.2),
            }
        ),
        ScoringConfig(degraded_feedback=False),
    )

    def test_tracked_pose_out_of_framing_band_never_reaches_no_person(self):
        machine = PostureStateMachine(TIMINGS, CFG)
        transitions = run(machine, grid(0.0, 6.0, 0.1, TOO_FAR))
        states = {t.state for t in transitions}
        assert states == {PostureState.UNRELIABLE}

    def test_low_visibility_never_reaches_no_person(self):
        """Healthy pose in frame, hips below the visibility floor:
        UNRELIABLE, not NO PERSON."""
        assert isinstance(self.LOWVIS, Unreliable)  # gated before the machine
        machine = PostureStateMachine(TIMINGS, CFG)
        transitions = run(machine, grid(0.0, 6.0, 0.1, self.LOWVIS))
        states = {t.state for t in transitions}
        assert states == {PostureState.UNRELIABLE}


class TestDegradedFeedbackFiring:
    """With degraded feedback, partial tracking (ears+shoulders ok, hips
    below the floor) still reaches BAD and fires reminders; ears below the
    floor gates; the flag off restores the old silent gating."""

    def _machine(self, cfg: ScoringConfig) -> PostureStateMachine:
        return PostureStateMachine(TIMINGS, cfg)

    def _slouched_hips_hidden(self) -> ScoredPosture:
        """Degraded-mode score: hips hidden, head slouched forward 18.4 deg."""
        pose = make_pose(
            {
                LEFT_HIP: SimpleLandmark(x=0.44, y=0.90, visibility=0.2),
                RIGHT_HIP: SimpleLandmark(x=0.56, y=0.90, visibility=0.2),
                LEFT_EAR: SimpleLandmark(x=0.48, y=0.54),
                RIGHT_EAR: SimpleLandmark(x=0.56, y=0.54),
            }
        )
        result = score_pose(pose, CFG)
        assert isinstance(result, ScoredPosture)
        assert result.trunk_lean_available is False
        return result

    def test_partial_visibility_reaches_bad_and_fires_a_chime(self):
        machine = self._machine(CFG)
        transitions = run(machine, grid(0.0, 4.0, 0.1, self._slouched_hips_hidden()))
        chimes = [t for t in transitions if t.nudge is Nudge.CHIME]
        assert chimes and chimes[0].state is PostureState.BAD_CHIME

    def test_ears_below_floor_gates_all_feedback(self):
        pose = make_pose(
            {LEFT_EAR: SimpleLandmark(x=0.46, y=0.45, visibility=0.2)}
        )
        gated = score_pose(pose, CFG)
        assert isinstance(gated, Unreliable)
        machine = self._machine(CFG)
        transitions = run(machine, grid(0.0, 4.0, 0.1, gated))
        assert all(t.nudge is Nudge.NONE for t in transitions)
        assert machine.state is PostureState.UNRELIABLE

    def test_flag_off_restores_silent_gating(self):
        cfg = ScoringConfig(degraded_feedback=False)
        pose = make_pose(
            {
                LEFT_HIP: SimpleLandmark(x=0.44, y=0.90, visibility=0.2),
                RIGHT_HIP: SimpleLandmark(x=0.56, y=0.90, visibility=0.2),
                LEFT_EAR: SimpleLandmark(x=0.48, y=0.54),
                RIGHT_EAR: SimpleLandmark(x=0.56, y=0.54),
            }
        )
        gated = score_pose(pose, cfg)
        assert isinstance(gated, Unreliable)
        machine = self._machine(cfg)
        transitions = run(machine, grid(0.0, 4.0, 0.1, gated))
        assert all(t.nudge is Nudge.NONE for t in transitions)
        assert machine.state is PostureState.UNRELIABLE


NON_FINITE = Unreliable(UnreliableReason.NON_FINITE)
FRAMING = Unreliable(UnreliableReason.FRAMING_OUT_OF_BAND, "too far: shoulder width 0.05")


class TestGlitchHold:
    """NaN/inf frames hold the previous state: no reset, no escalation."""

    def test_glitch_frames_hold_good(self):
        machine = PostureStateMachine(TIMINGS, CFG)
        run(machine, grid(0.0, 2.0, 0.1, GOOD))
        assert machine.state is PostureState.GOOD
        transitions = run(machine, grid(2.1, 6.0, 0.1, NON_FINITE))
        assert all(t.state is PostureState.GOOD and t.nudge is Nudge.NONE for t in transitions)

    def test_glitch_frames_do_not_reset_a_bad_streak(self):
        machine = PostureStateMachine(TIMINGS, CFG)
        run(machine, grid(0.0, 2.0, 0.1, GOOD))
        samples = grid(2.1, 3.0, 0.1, _bad_pose_score())
        samples += grid(3.1, 3.3, 0.1, NON_FINITE)
        samples += grid(3.4, 5.0, 0.1, _bad_pose_score())
        transitions = run(machine, samples)
        chimes = [now for (now, _), t in zip(samples, transitions, strict=True)
                  if t.nudge is Nudge.CHIME]
        # Streak from the first bad frame (2.1) survives the glitch: chime at 4.1.
        assert chimes == [pytest.approx(4.1)]

    def test_glitch_frames_do_not_reset_the_baseline(self):
        machine = PostureStateMachine(TIMINGS, CFG)
        run(machine, grid(0.0, 2.0, 0.1, GOOD))
        before = machine._baseline.metrics
        run(machine, grid(2.1, 8.0, 0.1, NON_FINITE))
        assert machine._baseline.metrics == before


class TestFramingGate:
    def test_framing_out_of_band_is_unreliable(self):
        machine = PostureStateMachine(TIMINGS, CFG)
        run(machine, grid(0.0, 2.0, 0.1, GOOD))
        assert machine.update(FRAMING, 2.1).state is PostureState.UNRELIABLE


class TestLowFrameRateSmoothing:
    """The smoothing window keeps its boundary sample, so GOOD and reminders
    confirm at any frame rate and with jittery timestamps."""

    @pytest.mark.parametrize("fps", [2.0, 3.0, 5.0, 30.0])
    def test_good_confirms_and_slouch_chimes_at_low_fps(self, fps):
        machine = PostureStateMachine(TIMINGS, CFG)
        step = 1.0 / fps
        transitions = run(machine, grid(0.0, 3.0, step, GOOD))
        assert transitions[-1].state is PostureState.GOOD
        samples = grid(3.0 + step, 8.0, step, _bad_pose_score())
        transitions = run(machine, samples)
        chimes = [now for (now, _), t in zip(samples, transitions, strict=True)
                  if t.nudge is Nudge.CHIME]
        assert len(chimes) == 1
        # Chime within one frame of bad_sustain_s after the window filled.
        first_bad = samples[0][0]
        assert TIMINGS.bad_sustain_s - 1e-6 <= chimes[0] - first_bad
        assert chimes[0] - first_bad <= TIMINGS.bad_sustain_s + TIMINGS.smoothing_window_s + step

    def test_jittered_timestamps_still_confirm_good(self):
        machine = PostureStateMachine(TIMINGS, CFG)
        now, jitter = 0.0, [0.031, 0.036, 0.029, 0.041, 0.033]
        state = None
        for i in range(120):
            now += jitter[i % len(jitter)]
            state = machine.update(GOOD, now).state
        assert state is PostureState.GOOD


class TestRecoveryAndAnchor:
    def test_recovered_flag_only_on_the_recovery_frame(self):
        machine = PostureStateMachine(TIMINGS, CFG)
        samples = grid(0.0, 2.0, 0.1, GOOD)
        samples += grid(2.1, 5.0, 0.1, _bad_pose_score())
        samples += grid(5.1, 10.0, 0.1, GOOD)
        transitions = run(machine, samples)
        recovered = [t for t in transitions if t.recovered]
        assert len(recovered) == 1
        assert recovered[0].state is PostureState.GOOD
        assert recovered[0].nudge is Nudge.NONE

    def test_baseline_anchor_survives_no_person(self):
        machine = PostureStateMachine(TIMINGS, CFG)
        anchor = ScoredPosture(1.0, 0.0, 0.0, 0.0)
        machine.set_baseline_anchor(anchor)
        run(machine, grid(0.0, 2.0, 0.1, GOOD))
        run(machine, grid(2.1, 6.0, 0.1, NO_POSE))
        assert machine.state is PostureState.NO_PERSON
        assert machine._baseline.metrics == anchor
