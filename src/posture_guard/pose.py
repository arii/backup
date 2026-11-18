"""Pose bridge: color frame in, landmarks out (spec section: pose worker).

MediaPipe Pose runs on the newest color frame. The MediaPipe import is lazy —
CI and dev machines without the webcam extra run the synthetic detector
instead, which is what makes the no-camera pipeline runnable.
"""

from __future__ import annotations

import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

from posture_guard.scoring import (
    LEFT_EAR,
    LEFT_HIP,
    LEFT_SHOULDER,
    RIGHT_EAR,
    RIGHT_HIP,
    RIGHT_SHOULDER,
    SimpleLandmark,
)

if TYPE_CHECKING:
    from posture_guard.camera import Frame


@dataclass(frozen=True)
class PoseDetection:
    """Landmarks in normalized MediaPipe order; None when no pose was found."""

    landmarks: Sequence[SimpleLandmark] | None


PoseDetector = Callable[["Frame"], PoseDetection]


def _good_pose() -> list[SimpleLandmark]:
    """A level, upright seated pose: ears over shoulder-mid, trunk vertical."""
    pose = [SimpleLandmark(x=0.5, y=0.5) for _ in range(33)]
    pose[LEFT_SHOULDER] = SimpleLandmark(x=0.40, y=0.60)
    pose[RIGHT_SHOULDER] = SimpleLandmark(x=0.60, y=0.60)
    pose[LEFT_EAR] = SimpleLandmark(x=0.46, y=0.45)
    pose[RIGHT_EAR] = SimpleLandmark(x=0.54, y=0.45)
    pose[LEFT_HIP] = SimpleLandmark(x=0.44, y=0.90)
    pose[RIGHT_HIP] = SimpleLandmark(x=0.56, y=0.90)
    return pose


def _slouch_pose() -> list[SimpleLandmark]:
    """Head pushed forward and dropped (~18 deg head-forward), trunk vertical."""
    pose = _good_pose()
    pose[LEFT_EAR] = SimpleLandmark(x=0.48, y=0.54)
    pose[RIGHT_EAR] = SimpleLandmark(x=0.56, y=0.54)
    return pose


class SyntheticPoseDetector:
    """Synthetic pose — the no-hardware path.

    By default a fixed good pose. With demo_cycle_s it alternates on the frame
    clock: demo_cycle_s of good posture, then demo_cycle_s of slouch, so the
    synthetic demo walks through GOOD -> chime -> voice -> recovery.
    """

    def __init__(
        self,
        pose: Sequence[SimpleLandmark] | None = None,
        *,
        demo_cycle_s: float | None = None,
    ):
        self._pose = _good_pose() if pose is None else list(pose)
        self._slouch = _slouch_pose()
        self._cycle = demo_cycle_s if demo_cycle_s and demo_cycle_s > 0 else None

    def pose_at(self, t: float) -> list[SimpleLandmark]:
        if self._cycle is None:
            return self._pose
        return self._pose if int(t // self._cycle) % 2 == 0 else self._slouch

    def __call__(self, frame: Frame) -> PoseDetection:
        return PoseDetection(self.pose_at(frame.timestamp_s))


class MediaPipePoseDetector:
    """MediaPipe Pose over the color frame; SDK imported lazily."""

    def __init__(self, model_complexity: int = 1):
        import cv2
        import mediapipe as mp

        self._cv2 = cv2
        self._pose = mp.solutions.pose.Pose(model_complexity=model_complexity)

    def __call__(self, frame: Frame) -> PoseDetection:
        rgb = self._cv2.cvtColor(frame.color, self._cv2.COLOR_BGR2RGB)
        result = self._pose.process(rgb)
        if result.pose_landmarks is None:
            return PoseDetection(None)
        landmarks = [
            SimpleLandmark(x=lm.x, y=lm.y, visibility=lm.visibility)
            for lm in result.pose_landmarks.landmark
        ]
        return PoseDetection(landmarks)


def default_detector() -> PoseDetector:
    """MediaPipe when usable, the synthetic pose otherwise.

    Any failure to build the MediaPipe detector — missing package, or an
    incompatible version such as mediapipe 1.x without mp.solutions — degrades
    to the synthetic pose. Surfaced on stderr, never fatal: the dashboard and
    state machine run on degraded input rather than crashing at startup.
    """
    try:
        return MediaPipePoseDetector()
    except Exception as exc:  # noqa: BLE001 — degraded mode is the contract here
        print(f"MediaPipe pose unavailable ({exc}); using the synthetic pose", file=sys.stderr)
        return SyntheticPoseDetector()


# Tracked landmark indices, in the order the dashboard payload reports them.
TRACKED_INDICES = (
    LEFT_EAR,
    RIGHT_EAR,
    LEFT_SHOULDER,
    RIGHT_SHOULDER,
    LEFT_HIP,
    RIGHT_HIP,
)


def tracked_landmarks(landmarks: Sequence[SimpleLandmark]) -> tuple[tuple[float, float], ...]:
    """Normalized (x, y) of the ears, shoulders and hips for the overlay."""
    return tuple(
        (landmarks[index].x, landmarks[index].y) for index in TRACKED_INDICES
    )
