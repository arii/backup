"""Audio worker: chime-then-voice nudge playback (spec §audio.py).

Pre-renders every prompt to WAV at startup — the chime is synthesized tone
pairs (no dependency), speech via pico2wave with espeak-ng as fallback — so
playback is a single paplay call on the configured sink (aplay is the
fallback when paplay cannot be launched, e.g. no PulseAudio/PipeWire; with no
player at all the failure is a status, never an exception). Custom WAVs from
audio.bad_sound / audio.good_sound replace the built-in chimes when the files
exist. One daemon thread
owns the queue: prompts serialize, never overlap, and enqueue() never blocks
the camera or state-machine threads. External commands all flow through an
injected runner, so tests stub the subprocess layer entirely.
"""

from __future__ import annotations

import logging
import math
import queue
import shutil
import struct
import subprocess
import tempfile
import threading
import wave
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from posture_guard.config import AudioConfig
from posture_guard.state import Nudge

SAMPLE_RATE = 44100

logger = logging.getLogger(__name__)

Runner = Callable[[Sequence[str]], "CommandResult"]
Which = Callable[[str], str | None]


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str = ""


@dataclass(frozen=True)
class AudioStatus:
    """Operational status, safe to render on the dashboard."""

    ready: bool  # at least one prompt is playable
    sink: str | None  # resolved sink name, None = paplay default
    tts_backend: str | None  # "pico2wave" | "espeak-ng" | None
    error: str | None = None
    warnings: tuple[str, ...] = ()  # e.g. a configured custom sound is missing
    player: str | None = None  # "paplay" | "aplay" | None before the first play


# Reminder "uh-oh": two notes stepping DOWN a tritone (E5 -> B-flat 4), the
# classic "wrong answer" interval, so it can't be mistaken for the rising
# good-posture arpeggio. Odd harmonics give it a reedy, buzzer-like edge.
# docs/app/app.js plays the same notes, durations and harmonics.
BAD_NOTES = ((659.25, 0.18), (466.16, 0.42))
BAD_HARMONICS = ((1, 1.0), (3, 0.35), (5, 0.15))


def _render_chime(path: Path) -> None:
    """Falling two-note "uh-oh" (659 -> 466 Hz) with exponential decay, 16-bit mono WAV."""
    samples: list[float] = []
    # Normalize to the waveform's true peak (as Web Audio's createPeriodicWave
    # does), so the reminder is as loud as a pure-sine chime would be.
    norm = max(
        abs(sum(amp * math.sin(k * 2 * math.pi * j / 1000) for k, amp in BAD_HARMONICS))
        for j in range(1000)
    )
    for freq, seconds in BAD_NOTES:
        total = int(SAMPLE_RATE * seconds)
        for i in range(total):
            decay = math.exp(-3.0 * i / total)
            phase = 2 * math.pi * freq * i / SAMPLE_RATE
            wave_sum = sum(amp * math.sin(k * phase) for k, amp in BAD_HARMONICS)
            samples.append(0.6 * decay * wave_sum / norm)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(b"".join(struct.pack("<h", int(s * 32767)) for s in samples))


def _render_positive_chime(path: Path) -> None:
    """Bright ascending major arpeggio (C5-E5-G5-C6, ~0.8 s), 16-bit mono WAV —
     deliberately distinct from the falling "uh-oh" reminder."""
    samples: list[float] = []
    for freq in (523.25, 659.25, 783.99, 1046.50):
        total = int(SAMPLE_RATE * 0.2)
        for i in range(total):
            decay = math.exp(-3.0 * i / total)
            samples.append(0.6 * decay * math.sin(2 * math.pi * freq * i / SAMPLE_RATE))
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(b"".join(struct.pack("<h", int(s * 32767)) for s in samples))


class AudioWorker:
    """Serialized nudge playback on a dedicated daemon thread.

    Duplicate pending nudges are dropped (the state machine already enforces
    the voice cooldown); test_nudge() bypasses dedupe so the dashboard button
    always fires the full chime + voice sequence for hardware verification.
    """

    def __init__(
        self,
        config: AudioConfig,
        *,
        sound_dir: Path | None = None,
        paplay_cmd: str = "paplay",
        aplay_cmd: str = "aplay",
        pactl_cmd: str = "pactl",
        which: Which = shutil.which,
        runner: Runner | None = None,
    ):
        self._config = config
        self._paplay = paplay_cmd
        self._aplay = aplay_cmd
        self._player: str | None = None  # set once a play succeeds
        self._warnings: list[str] = []
        self._cue_voices: dict[str, Path] = {}  # spoken cue sentence -> rendered WAV
        self._pactl = pactl_cmd
        self._which = which
        self._runner: Runner = runner or self._run_subprocess
        self._sound_dir = Path(sound_dir or tempfile.mkdtemp(prefix="posture-guard-audio-"))
        self._queue: queue.Queue[tuple[Nudge, Path, str | None] | None] = queue.Queue()
        self._pending: set[Nudge] = set()
        self._pending_lock = threading.Lock()
        self._sounds: dict[Nudge, Path] = {}
        self._sounds_lock = threading.Lock()  # guards _sounds swaps vs enqueue reads
        self._playing_path: Path | None = None  # WAV the playback thread is reading
        self._voice_seq = 0  # names re-rendered voice WAVs uniquely
        self._sink: str | None = None
        self._tts_backend: str | None = None
        self._error: str | None = None
        self._thread: threading.Thread | None = None

    # -- lifecycle -----------------------------------------------------------------

    def start(self) -> AudioStatus:
        """Pre-render prompts, resolve the sink, and start the playback thread."""
        self._render_sounds()
        self._sink = self._config.sink or self._discover_usb_sink()
        self._thread = threading.Thread(
            target=self._playback_loop, name="audio-worker", daemon=True
        )
        self._thread.start()
        return self.status

    def close(self) -> None:
        self._queue.put(None)
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    @property
    def status(self) -> AudioStatus:
        return AudioStatus(
            ready=bool(self._sounds),
            sink=self._sink,
            tts_backend=self._tts_backend,
            error=self._error,
            warnings=tuple(self._warnings),
            player=self._player,
        )

    # -- public API (caller-side, never blocks on playback) -------------------------

    def enqueue(self, nudge: Nudge, *, force: bool = False, text: str | None = None) -> None:
        """Queue a nudge for playback. Returns immediately; a duplicate of a
        nudge that is queued or currently playing is dropped.

        text (voice only) speaks that sentence instead of the configured
        prompt, e.g. a specific posture cue. It is rendered with TTS on the
        playback thread (cached per sentence), so enqueue never blocks; if the
        render fails the configured prompt plays instead."""
        with self._sounds_lock:
            path = self._sounds.get(nudge)
        if path is None:
            return  # nothing rendered for this nudge (e.g. no TTS backend)
        with self._pending_lock:
            if not force and nudge in self._pending:
                return
            self._pending.add(nudge)
        self._queue.put((nudge, path, text if nudge is Nudge.VOICE else None))

    def test_nudge(self) -> None:
        """Dashboard hook: force-play chime then voice, bypassing dedupe."""
        self.play_chime()
        self.play_voice()

    def play_chime(self) -> None:
        """Dashboard hook: force-play the chime only, bypassing dedupe and mode."""
        self.enqueue(Nudge.CHIME, force=True)

    def test_sound(self, kind: str) -> bool:
        """Dashboard hook: force-play the "bad" (reminder) or "good" sound,
        bypassing dedupe and mode. False when nothing is playable for kind."""
        nudge = {"bad": Nudge.CHIME, "good": Nudge.RECOVERY}.get(kind)
        if nudge is None:
            return False
        with self._sounds_lock:
            if nudge not in self._sounds:
                return False
        self.enqueue(nudge, force=True)
        return True

    def play_voice(self) -> None:
        """Dashboard hook: force-play the spoken prompt only, bypassing dedupe
        and mode (spec: test endpoints are hardware-verification commands)."""
        self.enqueue(Nudge.VOICE, force=True)

    # -- internals -------------------------------------------------------------------

    def render_prompt(self, text: str) -> str | None:
        """Re-render the spoken prompt for edited text (spec §settings API).

        Renders to a fresh file, then swaps it in under the sounds lock: a
        queued prompt keeps its old path and finishes cleanly, the next enqueue
        picks up the new wording. Returns the backend used, or None when no TTS
        backend rendered the prompt (worker error field then names the cause).
        """
        with self._sounds_lock:
            self._voice_seq += 1
            path = self._sound_dir / f"voice-{self._voice_seq}.wav"
        backend = self._render_voice(text, path)
        if backend is None:
            path.unlink(missing_ok=True)
            return None
        self._tts_backend = backend
        self._error = None  # a successful re-render supersedes a stale backend error
        with self._sounds_lock:
            previous = self._sounds.get(Nudge.VOICE)
            self._sounds[Nudge.VOICE] = path
        self._discard_stale(previous)
        return backend

    def _discard_stale(self, path: Path | None) -> None:
        """Delete a replaced voice WAV once no playback can still be reading it.
        A file being played right now is unlinked by the playback loop instead."""
        if path is None or path == self._playing_path:
            return
        path.unlink(missing_ok=True)

    def _render_sounds(self) -> None:
        self._sound_dir.mkdir(parents=True, exist_ok=True)
        chime_path = self._sound_dir / "chime.wav"
        _render_chime(chime_path)
        self._sounds[Nudge.CHIME] = chime_path
        positive_path = self._sound_dir / "positive-chime.wav"
        _render_positive_chime(positive_path)
        self._sounds[Nudge.POSITIVE_CHIME] = positive_path
        self._sounds[Nudge.RECOVERY] = positive_path
        bad = self._custom_sound("bad_sound", self._config.bad_sound)
        if bad is not None:
            self._sounds[Nudge.CHIME] = bad
        good = self._custom_sound("good_sound", self._config.good_sound)
        if good is not None:
            self._sounds[Nudge.POSITIVE_CHIME] = good
            self._sounds[Nudge.RECOVERY] = good
        voice_path = self._sound_dir / "voice.wav"
        backend = self._render_voice(self._config.voice_text, voice_path)
        if backend is not None:
            self._sounds[Nudge.VOICE] = voice_path
            self._tts_backend = backend

    def _cue_voice(self, text: str) -> Path | None:
        """WAV for a specific spoken cue, rendered once per sentence (playback
        thread only). None when no TTS backend can render it."""
        cached = self._cue_voices.get(text)
        if cached is not None:
            return cached
        path = self._sound_dir / f"cue-{len(self._cue_voices) + 1}.wav"
        if self._render_voice(text, path) is None:
            path.unlink(missing_ok=True)
            return None
        self._cue_voices[text] = path
        return path

    def _custom_sound(self, key: str, value: str | None) -> Path | None:
        """Validated path for a configured custom sound, or None (with a logged
        warning when one was configured but is not a readable file)."""
        if not value:
            return None
        path = Path(value).expanduser()
        if path.is_file():
            return path
        message = f"audio.{key}: {path} not found - using the built-in sound"
        logger.warning(message)
        self._warnings.append(message)
        return None

    def _render_voice(self, text: str, path: Path) -> str | None:
        """Render the spoken prompt to path; pico2wave first, espeak-ng fallback.
        Renders only — callers install the result into _sounds under the lock."""
        for backend in ("pico2wave", "espeak-ng"):
            binary = self._which(backend)
            if binary is None:
                continue
            result = self._runner([binary, "-w", str(path), text])
            if result.returncode == 0:
                return backend
        self._error = "no TTS backend available (install pico2wave or espeak-ng)"
        return None

    def _discover_usb_sink(self) -> str | None:
        """First USB audio sink from pactl, or None to use the paplay default."""
        if self._which(self._pactl) is None:
            return None
        result = self._runner([self._pactl, "list", "short", "sinks"])
        if result.returncode != 0:
            return None
        for line in result.stdout.splitlines():
            fields = line.split("\t")
            if fields and "usb" in fields[0].lower():
                return fields[0]
        return None

    def _playback_loop(self) -> None:
        while True:
            item = self._queue.get()
            if item is None:
                return
            nudge, path, text = item
            try:
                if text:
                    path = self._cue_voice(text) or path
                self._playing_path = path
                self._play(path)
            finally:
                self._playing_path = None
                self._queue.task_done()
                with self._pending_lock:
                    self._pending.discard(nudge)

    def _play(self, path: Path) -> None:
        """Play on the configured sink; on a non-zero exit, retry once with the
        paplay default sink before surfacing both attempts as status error."""
        sinks: tuple[str | None, ...] = (
            (self._sink, None) if self._sink is not None else (None,)
        )
        failures: list[str] = []
        for sink in sinks:
            cmd = [self._paplay]
            if sink is not None:
                cmd += ["--sink", sink]
            cmd.append(str(path))
            try:
                result = self._runner(cmd)
            except OSError as exc:
                # A missing or unlaunchable player (FileNotFoundError etc.) is
                # surfaced as status, never raised out of the worker thread —
                # a dead sink must not kill nudging. Headless boxes without
                # PulseAudio/PipeWire often still have ALSA's aplay.
                if self._play_aplay(path):
                    return
                self._error = f"{self._paplay} unavailable: {exc}"
                return
            if result.returncode == 0:
                self._error = None  # a successful play supersedes a stale error
                self._player = self._paplay
                logger.info("played %s on sink %s", path.name, sink or "default")
                return
            failures.append(f"sink {sink or 'default'}: exited {result.returncode}")
            logger.warning(
                "paplay failed for %s on %s (exit %d)",
                path.name,
                sink or "default",
                result.returncode,
            )
        self._error = f"{self._paplay} failed for {path.name}: " + "; ".join(failures)

    def _play_aplay(self, path: Path) -> bool:
        """Fallback player when paplay cannot be launched. True on success."""
        if self._which(self._aplay) is None:
            return False
        try:
            result = self._runner([self._aplay, "-q", str(path)])
        except OSError:
            return False
        if result.returncode != 0:
            return False
        self._error = None
        self._player = self._aplay
        logger.info("played %s with %s (paplay unavailable)", path.name, self._aplay)
        return True

    @staticmethod
    def _run_subprocess(cmd: Sequence[str]) -> CommandResult:
        completed = subprocess.run(cmd, capture_output=True, text=True, check=False)
        return CommandResult(returncode=completed.returncode, stdout=completed.stdout)
