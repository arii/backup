"""Webcam-extra smoke check: asserts the real mediapipe and opencv packages
expose the attributes pose.py and webcam.py rely on.

Not named test_*.py on purpose: it requires the `[webcam]` extra, so it is
run only by the dedicated CI job (and locally with that extra installed) —
plain `pytest` on a machine without the camera libraries must stay green.

Exits nonzero with a clear message when a required attribute is missing, so
API drift can never hide behind stubbed tests.
"""

import sys

failures: list[str] = []

try:
    import mediapipe as mp
except ImportError as err:
    print(f"FAIL: mediapipe import failed ({err}); is the [webcam] extra installed?")
    sys.exit(1)

# pose.py usage (MediaPipePoseDetector)
if not hasattr(mp, "solutions"):
    failures.append("mediapipe has no attribute 'solutions'")
elif not hasattr(mp.solutions, "pose"):
    failures.append("mp.solutions has no 'pose' module")
elif not hasattr(mp.solutions.pose, "Pose"):
    failures.append("mp.solutions.pose has no 'Pose' class")

# webcam.py usage (_open_capture) and pose.py's color conversion
try:
    import cv2
except ImportError as err:
    print(f"FAIL: cv2 import failed ({err}); is the [webcam] extra installed?")
    sys.exit(1)
for attr in (
    "VideoCapture",
    "CAP_PROP_FRAME_WIDTH",
    "CAP_PROP_FRAME_HEIGHT",
    "CAP_PROP_FPS",
    "cvtColor",
    "COLOR_BGR2RGB",
):
    if not hasattr(cv2, attr):
        failures.append(f"cv2 has no attribute {attr!r}")

if failures:
    print("FAIL: webcam-extra API smoke check:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("webcam-extra API smoke check passed")
