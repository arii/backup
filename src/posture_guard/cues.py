# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Posture cues: say *what* is off and *how* to fix it, not just "fix your posture".

posture_cue picks the metric that is furthest past its band - either the raw
angle against its threshold, or its drift from the slow personal baseline (the
same two checks state.py uses) - and turns it into a short title, a fix, and a
sentence for the spoken prompt.

Sides are the person's own left and right. MediaPipe labels landmarks by the
person's side, so the sign of each metric is mapped through `mirror` (the
direction of the person's left->right shoulder line in the image) to stay
correct whether or not the camera image is mirrored.

Mirrored line for line in docs/app/posture-core.js (postureCue); the golden
timeline test checks both produce the same cue on every frame.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from posture_guard.config import ScoringConfig
from posture_guard.scoring import LEFT_SHOULDER, RIGHT_SHOULDER, Landmark, ScoredPosture

# Fixed order: breaks ties deterministically (same order in posture-core.js).
_METRICS = ("head_forward", "head_tilt", "shoulder_level", "trunk_lean")


@dataclass(frozen=True)
class PostureCue:
    metric: str  # head_forward | head_tilt | shoulder_level | trunk_lean
    side: str | None  # "left" | "right" (the person's own side), None if sideless
    title: str  # short label, e.g. "Right shoulder dropped"
    fix: str  # what to do, e.g. "Lift your right shoulder ..."
    say: str  # spoken prompt

    @property
    def id(self) -> str:
        return f"{self.metric}:{self.side or '-'}"

    def to_payload(self) -> dict[str, object]:
        return {"id": self.id, "metric": self.metric, "side": self.side,
                "title": self.title, "fix": self.fix, "say": self.say}


def mirror_sign(landmarks: Sequence[Landmark] | None) -> float:
    """+1 when the person's right shoulder is at larger image x, else -1."""
    if landmarks is None:
        return 1.0
    dx = landmarks[RIGHT_SHOULDER].x - landmarks[LEFT_SHOULDER].x
    return -1.0 if dx < 0 else 1.0


def _text(metric: str, side: str) -> tuple[str, str, str]:
    if metric == "head_forward":
        return (
            "Head forward",
            "Tuck your chin and bring your ears back over your shoulders.",
            "Head forward. Tuck your chin and bring your ears back over your shoulders.",
        )
    if metric == "head_tilt":
        return (
            f"Head tilted toward your {side} shoulder",
            "Straighten your neck so your ears are level.",
            f"Your head is tilted to the {side}. Straighten your neck.",
        )
    if metric == "shoulder_level":
        return (
            f"{side.capitalize()} shoulder dropped",
            f"Lift your {side} shoulder and take your weight off that elbow.",
            f"Your {side} shoulder is low. Level your shoulders.",
        )
    return (
        f"Leaning to your {side}",
        "Sit up straight with your weight even on both hips.",
        f"You're leaning to the {side}. Sit up straight.",
    )


def _side(metric: str, signed: float, mirror: float) -> str | None:
    """The person's side for a signed metric value (raw angle or drift)."""
    if metric == "head_forward":
        return None
    if metric == "shoulder_level":
        # atan2(dy, |dx|) with dy = right.y - left.y: positive = right lower,
        # already independent of mirroring.
        return "right" if signed > 0 else "left"
    if metric == "head_tilt":
        # Right ear lower than the shoulder line <=> sign(tilt) * mirror < 0.
        return "right" if signed * mirror < 0 else "left"
    # trunk_lean: shoulders shifted toward the right-hip side.
    return "right" if signed * mirror > 0 else "left"


def posture_cue(
    metrics: ScoredPosture,
    cfg: ScoringConfig,
    baseline: ScoredPosture | None = None,
    mirror: float = 1.0,
) -> PostureCue | None:
    """The cue for the metric furthest past its band, or None when every
    metric is inside its exit threshold (raw and, when a baseline exists,
    drift from it)."""
    values = {
        "head_forward": (metrics.head_forward_deg, cfg.head_forward_deg),
        "head_tilt": (metrics.head_tilt_deg, cfg.head_tilt_deg),
        "shoulder_level": (metrics.shoulder_level_deg, cfg.shoulder_level_deg),
        "trunk_lean": (metrics.trunk_lean_deg, cfg.trunk_lean_deg),
    }
    refs = {} if baseline is None else {
        "head_forward": baseline.head_forward_deg,
        "head_tilt": baseline.head_tilt_deg,
        "shoulder_level": baseline.shoulder_level_deg,
        "trunk_lean": baseline.trunk_lean_deg,
    }
    trunk_ok = cfg.trunk_lean_required and metrics.trunk_lean_available
    best: tuple[float, str, float] | None = None  # (ratio, metric, signed value)
    for metric in _METRICS:
        if metric == "trunk_lean" and not trunk_ok:
            continue
        value, threshold = values[metric]
        if threshold <= 0:
            continue
        exit_at = cfg.bad_exit(threshold)
        candidates = [value]
        if metric in refs:
            candidates.append(value - refs[metric])
        for signed in candidates:
            if abs(signed) <= exit_at:
                continue
            ratio = abs(signed) / threshold
            if best is None or ratio > best[0]:
                best = (ratio, metric, signed)
    if best is None:
        return None
    _, metric, signed = best
    side = _side(metric, signed, mirror)
    title, fix, say = _text(metric, side or "")
    return PostureCue(metric=metric, side=side, title=title, fix=fix, say=say)
