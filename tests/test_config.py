"""Config loading: YAML mappings become typed dataclasses, nested included.

Unknown keys, wrong-typed values and invalid values raise ConfigError.

Regression: a nested mapping (scoring.baseline_deviation) used to pass through
as a raw dict, crashing the state machine at startup — visible only via
load_config, never in tests that construct dataclasses directly.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from posture_guard.config import (
    AppConfig,
    BaselineDeviationConfig,
    ConfigError,
    load_config,
)


def test_load_config_builds_nested_baseline_deviation(tmp_path) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "scoring:\n"
        "  head_forward_deg: 10.0\n"
        "  baseline_deviation:\n"
        "    enabled: false\n"
        "    window_s: 120.0\n"
    )
    config = load_config(config_file)
    baseline = config.scoring.baseline_deviation
    assert isinstance(baseline, BaselineDeviationConfig)
    assert baseline.enabled is False
    assert baseline.window_s == 120.0
    assert config.scoring.head_forward_deg == 10.0


def test_load_config_baseline_defaults_without_section(tmp_path) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text("scoring:\n  head_tilt_deg: 9.0\n")
    config = load_config(config_file)
    assert isinstance(config.scoring.baseline_deviation, BaselineDeviationConfig)
    assert config.scoring.baseline_deviation.enabled is True


def test_load_config_rejects_unknown_keys(tmp_path) -> None:
    """A typo must fail loudly at startup, never silently fall back to a default."""
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "scoring:\n"
        "  head_forward_deg: 10.0\n"
        "  not_a_real_field: 42\n"
    )
    with pytest.raises(ConfigError, match=r"scoring\.not_a_real_field"):
        load_config(config_file)


def test_load_config_rejects_unknown_nested_key(tmp_path) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text("feedback:\n  positive_chime:\n    every_second: 60\n")
    with pytest.raises(ConfigError, match=r"feedback\.positive_chime\.every_second"):
        load_config(config_file)


def test_load_config_rejects_unknown_section(tmp_path) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text("camra:\n  fps: 30\n")
    with pytest.raises(ConfigError, match="camra"):
        load_config(config_file)


@pytest.mark.parametrize(
    ("body", "match"),
    [
        ("state:\n  bad_sustain_s: soon\n", r"state\.bad_sustain_s"),
        ("camera:\n  fps: 29.97\n", r"camera\.fps"),
        ("scoring:\n  trunk_lean_required: 1\n", r"scoring\.trunk_lean_required"),
        ("needle:\n  tau_s: true\n", r"needle\.tau_s"),
        ("scoring: 5\n", "expected a mapping"),
    ],
)
def test_load_config_rejects_wrong_types(tmp_path, body, match) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text(body)
    with pytest.raises(ConfigError, match=match):
        load_config(config_file)


def test_load_config_accepts_int_for_float_and_null_for_optional(tmp_path) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text("state:\n  bad_sustain_s: 3\naudio:\n  sink: null\n")
    config = load_config(config_file)
    assert config.state.bad_sustain_s == 3
    assert config.audio.sink is None


@pytest.mark.parametrize(
    "body",
    [
        "camera:\n  source: kinect\n",
        "scoring:\n  shoulder_width_min: 0.7\n  shoulder_width_max: 0.5\n",
        "calibration:\n  window_s: 0\n",
    ],
)
def test_load_config_rejects_invalid_values(tmp_path, body) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text(body)
    with pytest.raises(ConfigError):
        load_config(config_file)


def test_repo_config_yaml_loads_cleanly() -> None:
    """The shipped config.yaml passes strict validation and sets the defaults
    the README documents."""
    config = load_config(Path(__file__).resolve().parent.parent / "config.yaml")
    assert config.camera.source == "webcam"
    assert config.feedback.recovery_chime.enabled is True
    assert config.needle.tau_s == 0.5


def test_empty_config_file_uses_defaults(tmp_path) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text("")
    assert load_config(config_file) == AppConfig()
