"""FastAPI dashboard app (spec §dashboard).

Surfaces over the shared hub, all clients sharing one upstream buffer:
GET /video.mjpg streams annotated JPEGs; WS /ws pushes the metrics JSON and
drops dead clients; POST /nudge/test fires the audio test prompt;
POST /sound/test/{good,bad} previews the custom sounds; POST /calibrate/{good,bad},
DELETE /calibrate and GET /calibrate/status drive few-shot calibration.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Protocol

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from starlette.websockets import WebSocket, WebSocketDisconnect

from posture_guard.calibration import CalibrationKind, CalibrationRecorder
from posture_guard.dashboard.hub import DashboardHub

MJPEG_BOUNDARY = "frame"


class NudgeSink(Protocol):
    """The audio surface the dashboard needs — AudioWorker satisfies it."""

    def test_nudge(self) -> None: ...


def create_app(
    hub: DashboardHub,
    audio: NudgeSink,
    *,
    should_stop: Callable[[], bool] | None = None,
    calibration: CalibrationRecorder | None = None,
) -> FastAPI:
    """Build the dashboard app.

    should_stop, when provided, ends the MJPEG generator's poll loop — used by
    tests (the TestClient close does not propagate a disconnect to a sync
    generator) and available for clean shutdown.
    """
    app = FastAPI(title="Posture Guard")

    @app.get("/video.mjpg")
    def video_mjpg() -> StreamingResponse:
        def frames() -> Iterator[bytes]:
            last_seq = -1
            while should_stop is None or not should_stop():
                latest = hub.latest_video()
                if latest is not None and latest[1] != last_seq:
                    jpeg, seq = latest
                    last_seq = seq
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\nContent-Length: "
                        + str(len(jpeg)).encode()
                        + b"\r\n\r\n"
                        + jpeg
                        + b"\r\n"
                    )
                else:
                    time.sleep(0.04)  # poll for the next frame; hub holds one slot

        return StreamingResponse(
            frames(),
            media_type=f"multipart/x-mixed-replace; boundary={MJPEG_BOUNDARY}",
        )

    @app.websocket("/ws")
    async def ws_metrics(websocket: WebSocket) -> None:
        await websocket.accept()
        hub.add_client(websocket)
        last_seq = -1
        try:
            while True:
                latest = hub.latest_metrics()
                if latest is not None and latest[1] != last_seq:
                    snapshot, seq = latest
                    last_seq = seq
                    await websocket.send_json(snapshot.to_payload())
                # Short receive timeout doubles as disconnect detection, so a
                # dead client is dropped even when no new metrics arrive.
                try:
                    message = await asyncio.wait_for(websocket.receive(), timeout=0.02)
                except asyncio.TimeoutError:
                    continue
                if message.get("type") == "websocket.disconnect":
                    break
        except (RuntimeError, WebSocketDisconnect):
            pass  # client went away mid-send: dropped in finally, never fatal
        finally:
            hub.drop_client(websocket)

    @app.post("/nudge/test")
    def nudge_test() -> dict[str, str]:
        audio.test_nudge()
        return {"status": "queued"}

    @app.post("/sound/test/{kind}")
    def sound_test(kind: str) -> dict[str, str]:
        if kind not in ("good", "bad"):
            raise HTTPException(status_code=404, detail="kind must be good or bad")
        play = getattr(audio, "test_sound", None)
        if play is None or not play(kind):
            raise HTTPException(status_code=409, detail=f"no {kind} sound available")
        return {"status": "queued"}

    def _recorder() -> CalibrationRecorder:
        if calibration is None:
            raise HTTPException(status_code=503, detail="calibration not available")
        return calibration

    @app.post("/calibrate/{kind}")
    def calibrate(kind: str) -> dict[str, object]:
        try:
            parsed = CalibrationKind(kind)
        except ValueError:
            raise HTTPException(status_code=404, detail="kind must be good or bad") from None
        recorder = _recorder()
        recorder.start(parsed)
        return recorder.status.to_payload()

    @app.delete("/calibrate")
    def calibrate_reset() -> dict[str, object]:
        recorder = _recorder()
        recorder.reset()
        return recorder.status.to_payload()

    @app.get("/calibrate/status")
    def calibrate_status() -> dict[str, object]:
        return _recorder().status.to_payload()

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(Path(__file__).parent / "static" / "index.html")

    return app

