"""Load config.yaml into typed dataclasses.

The dataclasses here are the single source of truth for thresholds and timings;
scoring.py and state.py take them as parameters, so a config edit is the only
edit needed to retune the system.
"""

from __future__ import annotations

import types
import typing
from dataclasses import dataclass, field
from pathlib import Path
from typing import get_type_hints

import yaml

CAMERA_SOURCES = ("webcam", "synthetic")


class ConfigError(ValueError):
    """config.yaml has an unknown key, a wrong-typed value or an invalid value.
    Raised at startup so a typo never silently falls back to a default."""


@dataclass(frozen=True)
class CameraConfig:
    # webcam: cv2.VideoCapture + MediaPipe (default, any USB/laptop camera).
    # synthetic: no camera, scripted good/slouch demo poses (headless demos
    # and tests).
    source: str = "webcam"
    device: int = 0  # webcam index for cv2.VideoCapture
    width: int = 640
    height: int = 480
    fps: int = 30
    # Synthetic demo: seconds of good posture, then the same of slouch, repeating.
    demo_cycle_s: float = 20.0


@dataclass(frozen=True)
class BaselineDeviationConfig:
    """Slow-baseline deviation check (whole-torso slouch gate).

    An exponential moving average of each scored angle over roughly window_s
    tracks the user's own recent neutral. Deviation thresholds REUSE the
    per-metric bands (head_forward_deg, trunk_lean_deg, ...): a metric is a
    deviation breach when |metric - baseline| passes the same threshold the
    raw metric would use, with the same hysteresis. This catches slouch that
    keeps head-vs-shoulder angles small (head and shoulders drift together)
    while an absolute angle change from the person's neutral grows.
    """

    enabled: bool = True
    window_s: float = 300.0


@dataclass(frozen=True)
class ScoringConfig:
    """Thresholds and gates for posture scoring.

    A metric is bad when |value| exceeds its threshold; it only counts as good
    again once |value| falls below (threshold - hysteresis_margin_deg).
    """

    head_forward_deg: float = 8.0
    trunk_lean_deg: float = 7.0
    head_tilt_deg: float = 8.0
    shoulder_level_deg: float = 4.0
    hysteresis_margin_deg: float = 3.0
    visibility_floor: float = 0.5
    # Framing gate: shoulder width as a fraction of the frame width stands in
    # for distance. Below min = too far, above max = too close.
    shoulder_width_min: float = 0.12
    shoulder_width_max: float = 0.65
    baseline_deviation: BaselineDeviationConfig = field(
        default_factory=BaselineDeviationConfig
    )
    # High-mount framing can keep hips permanently below the visibility floor;
    # set false to score ears/shoulders only (trunk lean drops out of the BAD
    # decision and reports unavailable) so head-forward reminders still fire.
    trunk_lean_required: bool = True
    # Degraded feedback: when trunk lean is required but only the hips fall
    # below the visibility floor, still score the ears/shoulders metrics (head
    # forward, head tilt, shoulder level) and report trunk lean as unavailable,
    # instead of gating all feedback. Ears or shoulders below the floor always
    # gates — they are the minimum usable set.
    degraded_feedback: bool = True

    def bad_exit(self, enter_threshold: float) -> float:
        """Exit threshold for a metric, per the hysteresis margin."""
        return enter_threshold - self.hysteresis_margin_deg


@dataclass(frozen=True)
class StateConfig:
    smoothing_window_s: float = 0.3
    bad_sustain_s: float = 2.0
    good_confirm_s: float = 1.0
    recovery_good_s: float = 3.0
    voice_delay_s: float = 10.0
    voice_repeat_cooldown_s: float = 30.0
    no_person_timeout_s: float = 2.0


@dataclass(frozen=True)
class AudioConfig:
    sink: str | None = None
    # Spoken-prompt wording rendered by TTS (the chime is a synthesized tone;
    # "chime_text" elsewhere in the UI/API means this spoken wording).
    voice_text: str = "Please fix your posture"
    # Optional custom WAV files. bad_sound replaces the reminder chime;
    # good_sound replaces the positive/recovery chime. A missing file logs a
    # warning and keeps the built-in sound.
    bad_sound: str | None = None
    good_sound: str | None = None


@dataclass(frozen=True)
class NeedleConfig:
    """Posture needle (display only; nudges use the scoring thresholds)."""

    tau_s: float = 0.5  # EMA time constant: alpha = 1 - exp(-dt / tau_s)


@dataclass(frozen=True)
class CalibrationConfig:
    window_s: float = 3.0  # seconds recorded per "Record good/slouch posture"
    min_samples: int = 5  # fewer scored frames than this fails the recording


@dataclass(frozen=True)
class PositiveChimeConfig:
    """Positive reinforcement: an upbeat chime after posture stays GOOD for
    `every_seconds`; the timer restarts each time it plays."""

    enabled: bool = True
    every_seconds: float = 120.0


@dataclass(frozen=True)
class RecoveryChimeConfig:
    """Play the good sound once when posture recovers to GOOD after a reminder."""

    enabled: bool = False


@dataclass(frozen=True)
class FeedbackConfig:
    positive_chime: PositiveChimeConfig = field(default_factory=PositiveChimeConfig)
    recovery_chime: RecoveryChimeConfig = field(default_factory=RecoveryChimeConfig)


@dataclass(frozen=True)
class AppConfig:
    camera: CameraConfig = field(default_factory=CameraConfig)
    scoring: ScoringConfig = field(default_factory=ScoringConfig)
    state: StateConfig = field(default_factory=StateConfig)
    audio: AudioConfig = field(default_factory=AudioConfig)
    feedback: FeedbackConfig = field(default_factory=FeedbackConfig)
    needle: NeedleConfig = field(default_factory=NeedleConfig)
    calibration: CalibrationConfig = field(default_factory=CalibrationConfig)


def _type_ok(value: object, hint: object) -> bool:
    """Shallow type check for config scalars: int is accepted for float, bool
    is never accepted as a number, X | None accepts None."""
    origin = typing.get_origin(hint)
    if origin in (typing.Union, types.UnionType):
        return any(_type_ok(value, arg) for arg in typing.get_args(hint))
    if hint is type(None):
        return value is None
    if hint is bool:
        return isinstance(value, bool)
    if hint is int:
        return isinstance(value, int) and not isinstance(value, bool)
    if hint is float:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if hint is str:
        return isinstance(value, str)
    return True


def _build(cls, data: object, path: str):  # noqa: ANN201 - factory helper
    """Construct a frozen config dataclass from a YAML mapping.

    Unknown keys and wrong-typed values raise ConfigError naming the full key
    path (e.g. state.bad_sustain), so a typo can never silently fall back to
    a default. Nested dataclass-typed fields (scoring.baseline_deviation,
    feedback.positive_chime) are built recursively."""
    prefix = f"{path}." if path else ""
    where = path or "top level"
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise ConfigError(f"{where}: expected a mapping, got {type(data).__name__}")
    hints = get_type_hints(cls)
    fields = cls.__dataclass_fields__  # type: ignore[attr-defined]
    unknown = sorted(str(k) for k in data if k not in fields)
    if unknown:
        valid = ", ".join(sorted(fields))
        names = ", ".join(f"{prefix}{k}" for k in unknown)
        raise ConfigError(f"unknown config key(s): {names} (valid in {where}: {valid})")
    kwargs: dict[str, object] = {}
    for key, value in data.items():
        hint = hints[key]
        if hasattr(hint, "__dataclass_fields__"):
            value = _build(hint, value, f"{prefix}{key}")
        elif not _type_ok(value, hint):
            raise ConfigError(
                f"{prefix}{key}: expected {getattr(hint, '__name__', hint)}, got {value!r}"
            )
        kwargs[key] = value
    return cls(**kwargs)


def validate(config: AppConfig) -> AppConfig:
    """Value checks the type system cannot express. Returns config unchanged."""
    if config.camera.source not in CAMERA_SOURCES:
        raise ConfigError(
            f"camera.source: {config.camera.source!r} is not one of {', '.join(CAMERA_SOURCES)}"
        )
    sw = config.scoring
    if not 0 < sw.shoulder_width_min < sw.shoulder_width_max:
        raise ConfigError("scoring: need 0 < shoulder_width_min < shoulder_width_max")
    if config.needle.tau_s < 0:
        raise ConfigError("needle.tau_s: must be >= 0")
    if config.calibration.window_s <= 0:
        raise ConfigError("calibration.window_s: must be > 0")
    if config.state.smoothing_window_s < 0:
        raise ConfigError("state.smoothing_window_s: must be >= 0")
    return config


def load_config(path: str | Path) -> AppConfig:
    """Load and validate config from a YAML file.

    Raises FileNotFoundError if the file is missing, yaml.YAMLError if it is
    malformed, and ConfigError for unknown keys or invalid values — all
    surface-loud by design.
    """
    raw = yaml.safe_load(Path(path).read_text())
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise yaml.YAMLError(f"{path}: expected a mapping at the top level")
    return validate(_build(AppConfig, raw, ""))
