# Author: Ariel Anders
# Copyright (c) 2026 Ariel Anders
# SPDX-License-Identifier: MIT
"""The committed browser golden timeline must match the current Python pipeline.

tests/fixtures/browser_golden.json is what the browser port
(docs/app/posture-core.js) is tested against (tests/js/). If a change to
scoring/state/needle/calibration alters any frame, this test fails until the
fixture is regenerated with `python tests/browser_golden.py` - and the JS
parity test then shows whether the browser port needs the same change.
Numbers compare with a 1e-9 relative tolerance (libm may differ per platform);
states, nudges and reasons compare exactly.
"""

from __future__ import annotations

import json
import math

from browser_golden import FIXTURE, build_golden


def _same(a: object, b: object, where: str) -> None:
    if isinstance(a, float) or isinstance(b, float):
        assert a is not None and b is not None, where
        assert math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-12), f"{where}: {a} != {b}"
    elif isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys(), where
        for key in a:
            _same(a[key], b[key], f"{where}.{key}")
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b), f"{where}: length"
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            _same(x, y, f"{where}[{i}]")
    else:
        assert a == b, f"{where}: {a!r} != {b!r}"


def test_committed_golden_matches_the_python_pipeline() -> None:
    committed = json.loads(FIXTURE.read_text())
    _same(build_golden(), committed, "golden")


def test_golden_covers_every_reminder_kind_and_reason() -> None:
    frames = json.loads(FIXTURE.read_text())["frames"]
    nudges = {n for f in frames for n in f["expect"]["nudges"]}
    assert {"chime", "voice", "recovery"} <= nudges
    reasons = {f["expect"].get("reason") for f in frames}
    assert {"no_pose", "low_visibility", "non_finite", "framing_out_of_band"} <= reasons
    states = {f["expect"]["state"] for f in frames}
    assert states == {"no_person", "good", "bad_chime", "bad_voice", "unreliable"}
