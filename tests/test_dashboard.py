"""Dashboard API tests (spec acceptance: TestClient against the fake hub).

No camera, no encoder, no audio hardware: the hub is fed synthetic snapshots
and JPEG bytes, and audio is a recording stub behind the NudgeSink protocol.
"""

from __future__ import annotations

import threading
import time

from fastapi.testclient import TestClient

from posture_guard.dashboard.app import create_app
from posture_guard.dashboard.hub import DashboardHub, MetricsSnapshot


class RecordingAudio:
    """NudgeSink double that counts test-nudge calls."""

    def __init__(self) -> None:
        self.calls = 0

    def test_nudge(self) -> None:
        self.calls += 1


def make_snapshot(**overrides: object) -> MetricsSnapshot:
    defaults: dict[str, object] = {
        "state": "good",
        "fps": 30.0,
        "depth_m": 1.4,
        "head_forward_deg": 0.0,
        "trunk_lean_deg": 0.0,
        "head_tilt_deg": 0.0,
        "shoulder_level_deg": 0.0,
        "camera_connected": True,
        "audio_ready": True,
        "warnings": (),
        "landmarks": ((0.4, 0.6), (0.6, 0.6)),
    }
    defaults.update(overrides)
    return MetricsSnapshot(**defaults)  # type: ignore[arg-type]


def test_nudge_endpoint_enqueues_test_prompt() -> None:
    hub, audio = DashboardHub(), RecordingAudio()
    client = TestClient(create_app(hub, audio))

    response = client.post("/nudge/test")

    assert response.status_code == 200
    assert response.json() == {"status": "queued"}
    assert audio.calls == 1


def test_mjpeg_streams_annotated_frames_from_shared_buffer() -> None:
    hub = DashboardHub()
    hub.publish_video(b"jpeg-bytes-one")
    stop = threading.Event()
    client = TestClient(create_app(hub, RecordingAudio(), should_stop=stop.is_set))

    with client.stream("GET", "/video.mjpg") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("multipart/x-mixed-replace")
        assert b"jpeg-bytes-one" in next(response.iter_raw())
        # End the generator so the stream closes cleanly (see create_app).
        stop.set()


def test_ws_pushes_metrics_json_schema() -> None:
    hub = DashboardHub()
    hub.publish_metrics(make_snapshot(state="good", warnings=("person too far",)))
    client = TestClient(create_app(hub, RecordingAudio()))

    with client.websocket_connect("/ws") as ws:
        payload = ws.receive_json()

    assert payload["type"] == "metrics"
    assert payload["state"] == "good"
    assert payload["fps"] == 30.0
    assert payload["depth_m"] == 1.4
    assert set(payload["metrics"]) == {
        "head_forward_deg",
        "trunk_lean_deg",
        "head_tilt_deg",
        "shoulder_level_deg",
    }
    assert payload["camera"] == {"connected": True, "usb_type": None, "error": None}
    assert payload["audio"]["ready"] is True
    assert payload["warnings"] == ["person too far"]
    assert payload["landmarks"] == [[0.4, 0.6], [0.6, 0.6]]


def test_ws_pushes_each_new_snapshot() -> None:
    hub = DashboardHub()
    hub.publish_metrics(make_snapshot(state="no_person"))
    client = TestClient(create_app(hub, RecordingAudio()))

    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["state"] == "no_person"
        hub.publish_metrics(make_snapshot(state="bad_chime"))
        assert ws.receive_json()["state"] == "bad_chime"


def test_dead_ws_client_is_dropped() -> None:
    hub = DashboardHub()
    hub.publish_metrics(make_snapshot())
    client = TestClient(create_app(hub, RecordingAudio()))

    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        deadline = time.monotonic() + 5.0
        while hub.client_count() == 0 and time.monotonic() < deadline:
            time.sleep(0.02)
        assert hub.client_count() == 1
    # Leaving the context closes the socket: the handler must drop the client.
    deadline = time.monotonic() + 5.0
    while hub.client_count() > 0 and time.monotonic() < deadline:
        time.sleep(0.05)
    assert hub.client_count() == 0


def test_index_page_is_served() -> None:
    client = TestClient(create_app(DashboardHub(), RecordingAudio()))

    response = client.get("/")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    # The page is plain DOM driven by the WS payload: overlay canvas, metric
    # tiles, state badge and the test-nudge button.
    for fragment in ("<canvas", "/ws", "/video.mjpg", "/nudge/test", "badge"):
        assert fragment in response.text


# -- needle, calibration and custom-sound surfaces -------------------------------------


class SoundAudio(RecordingAudio):
    """NudgeSink double with test_sound; only the "bad" sound is playable."""

    def __init__(self) -> None:
        super().__init__()
        self.sounds: list[str] = []

    def test_sound(self, kind: str) -> bool:
        if kind != "bad":
            return False
        self.sounds.append(kind)
        return True


def test_ws_payload_carries_needle_source_and_calibration() -> None:
    hub = DashboardHub()
    hub.publish_metrics(
        make_snapshot(
            needle=0.25,
            needle_calibrated=True,
            source="synthetic",
            calibration={"active": None, "calibrated": True},
        )
    )
    client = TestClient(create_app(hub, RecordingAudio()))

    with client.websocket_connect("/ws") as ws:
        payload = ws.receive_json()

    assert payload["needle"] == {"value": 0.25, "calibrated": True}
    assert payload["source"] == "synthetic"
    assert payload["calibration"]["calibrated"] is True


def test_sound_test_endpoint_plays_available_sound() -> None:
    audio = SoundAudio()
    client = TestClient(create_app(DashboardHub(), audio))

    assert client.post("/sound/test/bad").json() == {"status": "queued"}
    assert audio.sounds == ["bad"]
    assert client.post("/sound/test/good").status_code == 409
    assert client.post("/sound/test/loud").status_code == 404


def test_sound_test_without_support_is_409() -> None:
    client = TestClient(create_app(DashboardHub(), RecordingAudio()))
    assert client.post("/sound/test/bad").status_code == 409


def test_calibration_endpoints_drive_recorder() -> None:
    from posture_guard.calibration import CalibrationRecorder
    from posture_guard.config import CalibrationConfig

    recorder = CalibrationRecorder(CalibrationConfig())
    client = TestClient(create_app(DashboardHub(), RecordingAudio(), calibration=recorder))

    response = client.post("/calibrate/good")
    assert response.status_code == 200
    assert response.json()["active"] == "good"
    assert client.get("/calibrate/status").json()["active"] == "good"
    assert client.post("/calibrate/sideways").status_code == 404

    reset = client.delete("/calibrate").json()
    assert reset["active"] is None and reset["calibrated"] is False


def test_calibration_endpoints_without_recorder_are_503() -> None:
    client = TestClient(create_app(DashboardHub(), RecordingAudio()))
    assert client.get("/calibrate/status").status_code == 503
    assert client.post("/calibrate/good").status_code == 503


def test_index_page_has_needle_and_calibration_controls() -> None:
    client = TestClient(create_app(DashboardHub(), RecordingAudio()))
    html = client.get("/").text
    for fragment in ("needle-hand", "/calibrate/good", "/calibrate/bad", "/sound/test/good"):
        assert fragment in html
