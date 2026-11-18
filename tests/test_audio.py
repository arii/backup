"""Audio worker tests.

A stubbed command runner stands in for paplay, pactl and the TTS binaries, so
queue serialization, dedupe and sink targeting are verified with no audio
hardware — per the spec's acceptance criterion for audio.py.
"""

from __future__ import annotations

import threading
import time
import wave
from collections.abc import Callable

from posture_guard.audio import AudioWorker, CommandResult
from posture_guard.config import AudioConfig
from posture_guard.state import Nudge


def wait_until(predicate: Callable[[], bool], timeout_s: float = 5.0) -> bool:
    """Poll a condition without sleeps baked into the assertions."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return predicate()


class FakeRunner:
    """Records every external command; blocks the first paplay until released."""

    def __init__(self, pactl_sinks: str | None = None, fail_paplay: bool = False):
        self.calls: list[list[str]] = []
        self.pactl_sinks = pactl_sinks
        self.fail_paplay = fail_paplay
        self.first_play_started = threading.Event()
        self.release_first_play = threading.Event()

    def __call__(self, cmd: list[str]) -> CommandResult:
        self.calls.append(list(cmd))
        if cmd[0] == "pactl":
            return CommandResult(returncode=0, stdout=self.pactl_sinks or "")
        if cmd[0] == "paplay":
            if self.fail_paplay:
                return CommandResult(returncode=1)
            if not self.first_play_started.is_set():
                self.first_play_started.set()
                self.release_first_play.wait(timeout=5)
        return CommandResult(returncode=0)

    def play_calls(self) -> list[list[str]]:
        return [cmd for cmd in self.calls if cmd[0] == "paplay"]

    def render_calls(self, backend: str) -> list[list[str]]:
        # cmd[0] is the resolved binary path (e.g. /usr/bin/pico2wave).
        return [cmd for cmd in self.calls if cmd[0].endswith(backend)]


def make_which(available: set[str]) -> Callable[[str], str | None]:
    def which(name: str) -> str | None:
        return f"/usr/bin/{name}" if name in available else None

    return which


PACTL_SINKS = (
    "alsa_output.pci-0000_00_1f.3.analog-stereo\tmodule-alsa-card.c\tsink\n"
    "alsa_output.usb-C-Media_Electronics_Box-00.analog-stereo\tmodule-alsa-card.c\tsink\n"
)


def make_worker(
    tmp_path,
    runner: FakeRunner,
    available: set[str] = frozenset({"pico2wave"}),
    config: AudioConfig | None = None,
) -> AudioWorker:
    return AudioWorker(
        config or AudioConfig(),
        sound_dir=tmp_path / "sounds",
        which=make_which(available),
        runner=runner,
    )


def test_startup_pre_renders_chime_and_voice_prompt(tmp_path):
    runner = FakeRunner()
    worker = make_worker(tmp_path, runner)
    status = worker.start()
    try:
        assert (tmp_path / "sounds" / "chime.wav").stat().st_size > 0
        assert status.tts_backend == "pico2wave"
        assert status.ready
        assert len(runner.render_calls("pico2wave")) == 1
    finally:
        worker.close()


def test_voice_prompt_renders_voice_text_not_chime_text(tmp_path):
    """The spoken prompt is AudioConfig.voice_text, wired from config.yaml."""
    runner = FakeRunner()
    worker = make_worker(
        tmp_path, runner, config=AudioConfig(voice_text="please sit up")
    )
    worker.start()
    try:
        renders = runner.render_calls("pico2wave")
        assert len(renders) == 1
        assert renders[0][-1] == "please sit up"
    finally:
        worker.close()


def test_paplay_failure_falls_back_to_default_sink_and_records_both(tmp_path):
    """A dead configured sink retries once on the paplay default sink, and
    _error names both attempts so silence is diagnosable from the dashboard."""
    runner = FakeRunner(pactl_sinks=PACTL_SINKS, fail_paplay=True)
    worker = make_worker(
        tmp_path, runner, available={"pico2wave", "pactl"},
        config=AudioConfig(sink="alsa_output.usb-C-Media_Electronics_Box-00.analog-stereo"),
    )
    worker.start()
    worker.enqueue(Nudge.CHIME)
    try:
        assert wait_until(lambda: worker.status.error is not None)
        plays = runner.play_calls()
        assert len(plays) == 2
        assert plays[0][:3] == [
            "paplay", "--sink", "alsa_output.usb-C-Media_Electronics_Box-00.analog-stereo",
        ]
        assert "--sink" not in plays[1]  # second attempt: paplay default sink
        error = worker.status.error
        assert "exited 1" in error
        assert "default" in error  # both attempts named
    finally:
        worker.close()


def test_tts_falls_back_to_espeak_ng(tmp_path):
    runner = FakeRunner()
    worker = make_worker(tmp_path, runner, available={"espeak-ng"})
    status = worker.start()
    try:
        assert status.tts_backend == "espeak-ng"
        assert len(runner.render_calls("espeak-ng")) == 1
        assert runner.render_calls("pico2wave") == []
    finally:
        worker.close()


def test_no_tts_backend_leaves_chime_playable(tmp_path):
    runner = FakeRunner()
    worker = make_worker(tmp_path, runner, available=set())
    status = worker.start()
    try:
        assert status.tts_backend is None
        assert status.ready  # chime is always synthesized
        assert "TTS" in (status.error or "")
        worker.enqueue(Nudge.CHIME)
        assert wait_until(lambda: len(runner.play_calls()) == 1)
        worker.enqueue(Nudge.VOICE)  # nothing rendered -> silent no-op
        assert len(runner.play_calls()) == 1
    finally:
        runner.release_first_play.set()
        worker.close()


def test_queue_serializes_playback_never_overlapping(tmp_path):
    runner = FakeRunner()
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        worker.enqueue(Nudge.CHIME)
        assert runner.first_play_started.wait(timeout=5)
        # Second nudge queued while the first is mid-playback: recorded but
        # the worker must still be inside the first paplay call.
        worker.enqueue(Nudge.VOICE)
        assert len(runner.play_calls()) == 1
        runner.release_first_play.set()
        assert wait_until(lambda: len(runner.play_calls()) == 2)
        # Order is FIFO: chime first, then voice.
        assert runner.play_calls()[0][1].endswith("chime.wav")
        assert runner.play_calls()[1][1].endswith("voice.wav")
    finally:
        worker.close()


def test_enqueue_returns_immediately_while_playback_blocks(tmp_path):
    runner = FakeRunner()
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        worker.enqueue(Nudge.CHIME)
        assert runner.first_play_started.wait(timeout=5)
        start = time.monotonic()
        worker.enqueue(Nudge.VOICE)
        assert time.monotonic() - start < 1.0  # never blocked on the sink
    finally:
        runner.release_first_play.set()
        worker.close()


def test_duplicate_pending_nudges_are_deduplicated(tmp_path):
    runner = FakeRunner()
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        worker.enqueue(Nudge.CHIME)
        assert runner.first_play_started.wait(timeout=5)
        # Two duplicates while the chime is queued/in-flight: both dropped.
        worker.enqueue(Nudge.CHIME)
        worker.enqueue(Nudge.CHIME)
        runner.release_first_play.set()
        assert wait_until(lambda: len(runner.play_calls()) == 1)
        worker._queue.join()
        assert len(runner.play_calls()) == 1
        # Once no chime is pending, a new event plays again.
        worker.enqueue(Nudge.CHIME)
        assert wait_until(lambda: len(runner.play_calls()) == 2)
    finally:
        worker.close()


def test_playback_targets_configured_sink(tmp_path):
    runner = FakeRunner()
    worker = make_worker(tmp_path, runner, config=AudioConfig(sink="alsa_usb_2"))
    worker.start()
    try:
        assert worker.status.sink == "alsa_usb_2"
        worker.enqueue(Nudge.CHIME)
        assert wait_until(lambda: len(runner.play_calls()) == 1)
        cmd = runner.play_calls()[0]
        assert cmd[1:3] == ["--sink", "alsa_usb_2"]
    finally:
        worker.close()


def test_default_sink_discovered_from_pactl_usb_listing(tmp_path):
    runner = FakeRunner(pactl_sinks=PACTL_SINKS)
    worker = make_worker(tmp_path, runner, available={"pico2wave", "pactl"})
    status = worker.start()
    try:
        assert status.sink == "alsa_output.usb-C-Media_Electronics_Box-00.analog-stereo"
    finally:
        worker.close()


def test_paplay_failure_is_surfaced_as_status_not_exception(tmp_path):
    runner = FakeRunner(fail_paplay=True)
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        worker.enqueue(Nudge.CHIME)
        assert wait_until(lambda: worker.status.error is not None)
        assert "paplay" in worker.status.error
    finally:
        worker.close()


def test_missing_paplay_binary_kills_nothing_and_surfaces_status(tmp_path):
    """A player binary that cannot be launched at all (FileNotFoundError,
    e.g. paplay not installed) is surfaced as status and the playback loop
    keeps running — nudging survives a dead audio environment."""

    class MissingBinaryRunner(FakeRunner):
        def __call__(self, cmd: list[str]) -> CommandResult:
            self.calls.append(list(cmd))
            if cmd[0] == "pactl":
                return CommandResult(returncode=0, stdout=self.pactl_sinks or "")
            if cmd[0] == "paplay":
                raise FileNotFoundError(2, "No such file or directory", cmd[0])
            return CommandResult(returncode=0)

    runner = MissingBinaryRunner()
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        worker.enqueue(Nudge.CHIME)
        assert wait_until(lambda: worker.status.error is not None)
        assert "unavailable" in worker.status.error
        # The playback loop is still alive: the next item is consumed too.
        worker.enqueue(Nudge.VOICE)
        def last_play() -> str:
            return (runner.play_calls() or [[""]])[-1][-1]

        assert wait_until(lambda: last_play().endswith("voice.wav"))
    finally:
        worker.close()


def test_test_nudge_forces_chime_then_voice_past_dedupe(tmp_path):
    runner = FakeRunner()
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        runner.release_first_play.set()  # never block: both plays must complete
        worker.test_nudge()
        assert wait_until(lambda: len(runner.play_calls()) == 2)
        assert runner.play_calls()[0][1].endswith("chime.wav")
        assert runner.play_calls()[1][1].endswith("voice.wav")
    finally:
        runner.release_first_play.set()
        worker.close()


def test_startup_pre_renders_positive_chime(tmp_path):
    runner = FakeRunner()
    worker = make_worker(tmp_path, runner)
    status = worker.start()
    try:
        positive = tmp_path / "sounds" / "positive-chime.wav"
        assert positive.stat().st_size > 0
        with wave.open(str(positive)) as handle:
            assert handle.getframerate() == 44100
            assert handle.getnframes() > 44100 // 2  # at least ~0.5 s of audio
        worker.enqueue(Nudge.POSITIVE_CHIME)
        assert wait_until(lambda: len(runner.play_calls()) == 1)
        assert runner.play_calls()[0][1].endswith("positive-chime.wav")
        assert status.ready
    finally:
        worker.close()


# -- custom good / bad sounds, recovery cue, aplay fallback ---------------------------


def _wav(path) -> str:  # noqa: ANN001 - tmp_path child
    path.write_bytes(b"RIFF....WAVE")
    return str(path)


def test_custom_bad_sound_replaces_the_reminder_chime(tmp_path):
    runner = FakeRunner()
    runner.release_first_play.set()
    bad = _wav(tmp_path / "bad.wav")
    worker = make_worker(tmp_path, runner, config=AudioConfig(bad_sound=bad))
    worker.start()
    try:
        worker.enqueue(Nudge.CHIME)
        assert wait_until(lambda: len(runner.play_calls()) == 1)
        assert runner.play_calls()[0][-1] == bad
        assert worker.status.warnings == ()
    finally:
        worker.close()


def test_custom_good_sound_plays_for_positive_and_recovery(tmp_path):
    runner = FakeRunner()
    runner.release_first_play.set()
    good = _wav(tmp_path / "good.wav")
    worker = make_worker(tmp_path, runner, config=AudioConfig(good_sound=good))
    worker.start()
    try:
        worker.enqueue(Nudge.RECOVERY)
        assert wait_until(lambda: len(runner.play_calls()) == 1)
        worker.enqueue(Nudge.POSITIVE_CHIME)
        assert wait_until(lambda: len(runner.play_calls()) == 2)
        assert [cmd[-1] for cmd in runner.play_calls()] == [good, good]
    finally:
        worker.close()


def test_recovery_uses_builtin_positive_chime_by_default(tmp_path):
    runner = FakeRunner()
    runner.release_first_play.set()
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        worker.enqueue(Nudge.RECOVERY)
        assert wait_until(lambda: len(runner.play_calls()) == 1)
        assert runner.play_calls()[0][-1].endswith("positive-chime.wav")
    finally:
        worker.close()


def test_missing_custom_sounds_warn_and_keep_builtins(tmp_path):
    runner = FakeRunner()
    runner.release_first_play.set()
    config = AudioConfig(
        bad_sound=str(tmp_path / "nope-bad.wav"), good_sound=str(tmp_path / "nope-good.wav")
    )
    worker = make_worker(tmp_path, runner, config=config)
    status = worker.start()
    try:
        assert len(status.warnings) == 2
        assert all("not found" in w for w in status.warnings)
        worker.enqueue(Nudge.CHIME)
        assert wait_until(lambda: len(runner.play_calls()) == 1)
        assert runner.play_calls()[0][-1].endswith("chime.wav")
    finally:
        worker.close()


def test_test_sound_plays_and_reports_availability(tmp_path):
    runner = FakeRunner()
    runner.release_first_play.set()
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        assert worker.test_sound("bad") is True
        assert worker.test_sound("good") is True
        assert worker.test_sound("loud") is False
        assert wait_until(lambda: len(runner.play_calls()) == 2)
    finally:
        worker.close()


class NoPaplayRunner(FakeRunner):
    """paplay cannot be launched (headless box without PulseAudio/PipeWire)."""

    def __call__(self, cmd: list[str]) -> CommandResult:
        if cmd[0] == "paplay":
            self.calls.append(list(cmd))
            raise FileNotFoundError(2, "No such file or directory", "paplay")
        return super().__call__(cmd)


def test_aplay_fallback_when_paplay_is_missing(tmp_path):
    runner = NoPaplayRunner()
    worker = make_worker(tmp_path, runner, available={"pico2wave", "aplay"})
    worker.start()
    try:
        worker.enqueue(Nudge.CHIME)
        assert wait_until(lambda: any(cmd[0] == "aplay" for cmd in runner.calls))
        assert wait_until(lambda: worker.status.player == "aplay")
        aplay = [cmd for cmd in runner.calls if cmd[0] == "aplay"][0]
        assert aplay[-1].endswith("chime.wav")
        assert worker.status.error is None
    finally:
        worker.close()


def test_no_player_at_all_is_status_not_exception(tmp_path):
    runner = NoPaplayRunner()
    worker = make_worker(tmp_path, runner)  # no aplay either
    worker.start()
    try:
        worker.enqueue(Nudge.CHIME)
        assert wait_until(lambda: worker.status.error is not None)
        assert "unavailable" in worker.status.error
        worker.enqueue(Nudge.VOICE)  # the playback loop is still alive
        assert wait_until(lambda: len(runner.play_calls()) == 2)
    finally:
        worker.close()


# -- specific spoken cues ------------------------------------------------------------


def test_voice_with_text_renders_and_plays_that_sentence(tmp_path):
    runner = FakeRunner()
    runner.release_first_play.set()
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        worker.enqueue(Nudge.VOICE, text="Head forward. Tuck your chin.")
        assert wait_until(lambda: len(runner.play_calls()) == 1)
        renders = runner.render_calls("pico2wave")
        assert renders[-1][-1] == "Head forward. Tuck your chin."
        assert runner.play_calls()[0][-1] == renders[-1][2]  # plays the cue WAV
        assert "cue-" in runner.play_calls()[0][-1]
    finally:
        worker.close()


def test_repeated_cue_sentence_is_rendered_once(tmp_path):
    runner = FakeRunner()
    runner.release_first_play.set()
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        for expected in (1, 2):
            worker.enqueue(Nudge.VOICE, text="Level your shoulders.")
            assert wait_until(lambda n=expected: len(runner.play_calls()) == n)
        renders = runner.render_calls("pico2wave")
        cue_renders = [c for c in renders if c[-1] == "Level your shoulders."]
        assert len(cue_renders) == 1
    finally:
        worker.close()


def test_failed_cue_render_falls_back_to_the_configured_prompt(tmp_path):
    class CueRenderFails(FakeRunner):
        def __call__(self, cmd):  # noqa: ANN001, ANN204
            if cmd[0].endswith("pico2wave") and "cue-" in cmd[2]:
                self.calls.append(list(cmd))
                return CommandResult(returncode=1)
            return super().__call__(cmd)

    runner = CueRenderFails()
    runner.release_first_play.set()
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        worker.enqueue(Nudge.VOICE, text="Sit up straight.")
        assert wait_until(lambda: len(runner.play_calls()) == 1)
        assert runner.play_calls()[0][-1].endswith("voice.wav")
    finally:
        worker.close()


def test_text_is_ignored_for_non_voice_nudges(tmp_path):
    runner = FakeRunner()
    runner.release_first_play.set()
    worker = make_worker(tmp_path, runner)
    worker.start()
    try:
        worker.enqueue(Nudge.CHIME, text="should not be spoken")
        assert wait_until(lambda: len(runner.play_calls()) == 1)
        assert runner.play_calls()[0][-1].endswith("chime.wav")
        assert not any(c[-1] == "should not be spoken" for c in runner.calls)
    finally:
        worker.close()
