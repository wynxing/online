from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import WebSocket

from .mock_pipeline import run_mock_subtitle_pipeline
from .models import RuntimeConfig, SessionRecord, StartSessionRequest
from .storage import create_session, finish_session


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class WebSocketHub:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._clients.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(websocket)

    async def broadcast(self, event_type: str, payload: dict) -> None:
        async with self._lock:
            clients = list(self._clients)
        for client in clients:
            try:
                await client.send_json({"type": event_type, "payload": payload})
            except Exception:
                await self.disconnect(client)


@dataclass
class ActiveSession:
    record: SessionRecord
    request: StartSessionRequest
    task: asyncio.Task
    stop_event: asyncio.Event


class RuntimeState:
    def __init__(self) -> None:
        self.hub = WebSocketHub()
        self.config = RuntimeConfig()
        self.active_session: ActiveSession | None = None

    async def start_session(self, request: StartSessionRequest) -> SessionRecord:
        if self.active_session:
            await self.stop_session()

        session_id = f"session_{uuid4().hex[:10]}"
        record = SessionRecord(
            id=session_id,
            title=f"同传会话 {datetime.now().strftime('%H:%M:%S')}",
            sourceLang=request.sourceLang,
            targetLang=request.targetLang,
            startedAt=now_iso(),
            endedAt=None,
        )
        create_session(record)
        stop_event = asyncio.Event()
        task = asyncio.create_task(
            run_mock_subtitle_pipeline(
                session_id=session_id,
                broadcast=self.hub.broadcast,
                should_stop=stop_event.is_set,
            )
        )
        self.active_session = ActiveSession(record, request, task, stop_event)
        return record

    async def stop_session(self) -> SessionRecord | None:
        if not self.active_session:
            return None

        active = self.active_session
        active.stop_event.set()
        try:
            await asyncio.wait_for(active.task, timeout=3)
        except asyncio.TimeoutError:
            active.task.cancel()

        ended_at = now_iso()
        finish_session(active.record.id, ended_at)
        stopped = active.record.model_copy(update={"endedAt": ended_at})
        self.active_session = None
        return stopped
