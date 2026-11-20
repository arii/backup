# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders. All rights reserved.
"""Golden timeline for the browser port (docs/app/posture-core.js).

Drives the real Python PosturePipeline through
a scripted session - good posture, slouch to chime and voice, recovery, head
tilt, neutral-band wobble, hidden hips, NaN glitches, leaving the desk, sitting
too far, and good/slouch calibration - and records every frame's result,
state, nudges and needle. tests/js/posture-core.test.mjs replays the same
frames through the JS engine and must match; tests/test_browser_golden.py
regenerates this file in memory and checks the committed copy is current.

    python tests/browser_golden.py   # rewrite tests/fixtures/browser_golden.json
"""

from __future__ import annotations

import dataclasses
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "browser_golden.json"

if str(ROOT / "src") not in sys.path:  # runnable as a plain script
    sys.path.insert(0, str(ROOT / "src"))

from posture_guard.calibration import CalibrationKind  # noqa: E402
from posture_guard.camera import Frame, SyntheticFrameSource  # noqa: E402
from posture_guard.config import load_config  # noqa: E402
from posture_guard.pipeline import PosturePipeline  # noqa: E402
from posture_guard.pose import PoseDetection  # noqa: E402
from posture_guard.scoring import (  # noqa: E402
    LEFT_EAR,
    LEFT_HIP,
    LEFT_SHOULDER,
    RIGHT_EAR,
    RIGHT_HIP,
    RIGHT_SHOULDER,
    ScoredPosture,
    SimpleLandmark,
)
from posture_guard.state import Nudge  # noqa: E402

TRACKED = (LEFT_EAR, RIGHT_EAR, LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP)
FPS = 8.0
SEED = 2026

# Tracked landmarks as (x, y, visibility), in TRACKED order.
GOOD = [(0.46, 0.45, 0.99), (0.54, 0.45, 0.99), (0.40, 0.60, 0.99),
        (0.60, 0.60, 0.99), (0.44, 0.90, 0.9), (0.56, 0.90, 0.9)]


def _variant(**changes: tuple[float, float, float]) -> list[tuple[float, float, float]]:
    pose = list(GOOD)
    names = {"le": 0, "re": 1, "ls": 2, "rs": 3, "lh": 4, "rh": 5}
    for key, value in changes.items():
        pose[names[key]] = value
    return pose


POSES: dict[str, list[tuple[float, float, float]] | None] = {
    "good": GOOD,
    "slouch": _variant(le=(0.48, 0.54, 0.99), re=(0.56, 0.54, 0.99)),
    "tilt": _variant(le=(0.45, 0.47, 0.99), re=(0.55, 0.43, 0.99)),
    # shoulder level ~4.6 deg: between exit (3) and enter (6) -> neutral band
    "neutral": _variant(rs=(0.60, 0.616, 0.99)),
    "low_vis": _variant(le=(0.46, 0.45, 0.2)),
    "hips_hidden": _variant(lh=(0.44, 0.90, 0.1), rh=(0.56, 0.90, 0.1)),
    "far": [(0.49, 0.55, 0.99), (0.51, 0.55, 0.99), (0.47, 0.60, 0.99),
            (0.53, 0.60, 0.99), (0.48, 0.75, 0.9), (0.52, 0.75, 0.9)],
    "nan": _variant(le=(float("nan"), 0.45, 0.99)),
    "none": None,
}
# An unmirrored webcam sees the user's left side on the image's right: the
# same poses with x -> 1 - x (exercises the shoulder-level fold).
POSES["good_mirror"] = [(1.0 - x, y, v) for x, y, v in GOOD]
POSES["shrug_mirror"] = [(1.0 - x, y, v) for x, y, v in _variant(rs=(0.60, 0.64, 0.99))]

# (pose, seconds, calibration event at the segment start)
SCRIPT: list[tuple[str, float, str | None]] = [
    ("good", 4.0, None),
    ("slouch", 14.0, None),       # chime at ~2 s, voice at ~12 s
    ("good", 4.5, None),          # recovery (+ recovery chime)
    ("nan", 0.5, None),           # glitch: held
    ("good", 2.0, None),
    ("tilt", 3.0, None),          # second episode -> chime
    ("good", 4.0, None),
    ("neutral", 6.0, None),       # neutral band: no reminder
    ("hips_hidden", 3.0, None),   # degraded feedback
    ("low_vis", 1.0, None),       # UNRELIABLE
    ("good", 3.0, None),
    ("none", 3.0, None),          # NO_PERSON after 2 s
    ("far", 1.5, None),           # framing gate
    ("good", 4.0, "good"),        # record good posture (3 s window)
    ("slouch", 4.0, "bad"),       # record slouch posture
    ("good", 3.0, None),          # calibrated needle back to -1
    ("slouch", 3.0, None),
    ("good", 4.0, None),
    ("good_mirror", 3.0, None),   # mirrored framing stays GOOD
    ("shrug_mirror", 3.0, None),  # uneven shoulders, mirrored -> chime
    ("good_mirror", 4.0, None),
    ("good", 100.0, None),        # long good streak: dense-to-lean praise (~15, ~32, ~74 s)
]


def _landmarks(tracked: list[tuple[float, float, float]] | None, rng: random.Random):
    if tracked is None:
        return None, None
    pose = [SimpleLandmark(x=0.5, y=0.5, visibility=0.9) for _ in range(33)]
    encoded = []
    for index, (x, y, v) in zip(TRACKED, tracked, strict=True):
        # Small deterministic jitter (uniform, rounded) so frames are not identical.
        jx = round(x + rng.uniform(-0.002, 0.002), 5) if x == x else x
        jy = round(y + rng.uniform(-0.002, 0.002), 5)
        pose[index] = SimpleLandmark(x=jx, y=jy, visibility=v)
        encoded.append([None if jx != jx else jx, jy, v])
    return pose, encoded


class _Audio:
    def __init__(self) -> None:
        self.enqueued: list[str] = []
        self.spoken: list[str] = []

    def enqueue(self, nudge: Nudge, *, force: bool = False, text: str | None = None) -> None:
        self.enqueued.append(nudge.value)
        if text:
            self.spoken.append(text)


class _Detector:
    def __init__(self) -> None:
        self.pose = None

    def __call__(self, frame: Frame) -> PoseDetection:
        return PoseDetection(self.pose)


def _result_payload(result) -> dict[str, object]:  # noqa: ANN001
    if isinstance(result, ScoredPosture):
        return {
            "kind": "scored",
            "metrics": [result.head_forward_deg, result.trunk_lean_deg,
                        result.head_tilt_deg, result.shoulder_level_deg],
            "trunk_ok": result.trunk_lean_available,
        }
    return {"kind": "unreliable", "reason": result.reason.value, "detail": result.detail}


def build_golden() -> dict[str, object]:
    config = load_config(ROOT / "config.yaml")
    rng = random.Random(SEED)
    audio, detector = _Audio(), _Detector()
    pipeline = PosturePipeline(SyntheticFrameSource(), config, audio=audio, detector=detector)
    results: list[object] = []
    original_update = pipeline._state_machine.update

    def capture(result, now):  # noqa: ANN001, ANN202 - records score_pose output
        results.append(result)
        return original_update(result, now)

    pipeline._state_machine.update = capture  # type: ignore[method-assign]

    frames: list[dict[str, object]] = []
    now = 0.0
    for name, seconds, calibrate in SCRIPT:
        end = now + seconds
        first = True
        while now < end - 1e-9:
            event = calibrate if first else None
            if event is not None:
                pipeline.calibration.start(CalibrationKind(event))
            first = False
            pose, encoded = _landmarks(POSES[name], rng)
            detector.pose = pose
            before = len(audio.enqueued)
            spoken_before = len(audio.spoken)
            tr = pipeline.process_once(Frame(color=None, timestamp_s=now))  # type: ignore[arg-type]
            frames.append({
                "t": now,
                "pose": encoded,
                "calibrate": event,
                "expect": {
                    **_result_payload(results[-1]),
                    "state": tr.state.value,
                    "nudge": tr.nudge.value,
                    "recovered": tr.recovered,
                    "needle": pipeline.needle,
                    "nudges": audio.enqueued[before:],
                    "cue": None if pipeline.cue is None else {
                        "id": pipeline.cue.id, "title": pipeline.cue.title,
                        "fix": pipeline.cue.fix, "say": pipeline.cue.say,
                    },
                    "spoken": audio.spoken[spoken_before:],
                },
            })
            now = round(now + 1.0 / FPS + rng.uniform(-0.015, 0.015), 4)
    picked = {k: dataclasses.asdict(getattr(config, k))
              for k in ("scoring", "state", "feedback", "needle", "calibration")}
    return {"fps": FPS, "seed": SEED, "config": picked, "frames": frames}


def main() -> None:
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    golden = build_golden()
    FIXTURE.write_text(json.dumps(golden, separators=(",", ":")) + "\n")
    nudges = [n for f in golden["frames"] for n in f["expect"]["nudges"]]
    print(f"wrote {FIXTURE.relative_to(ROOT)}: {len(golden['frames'])} frames, nudges {nudges}")


if __name__ == "__main__":
    main()
