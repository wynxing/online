from __future__ import annotations

from uuid import uuid4

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .devices import list_audio_devices
from .models import GlossaryTerm, GlossaryTermInput, RuntimeConfig, StartSessionRequest
from .state import RuntimeState
from .storage import (
    delete_glossary_term,
    init_storage,
    list_glossary,
    list_segments,
    list_sessions,
    load_config,
    save_config,
    save_glossary_term,
    seed_glossary,
)

app = FastAPI(title="AI Simultaneous Interpretation Runtime")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://127.0.0.1:1420", "tauri://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

state = RuntimeState()


@app.on_event("startup")
async def startup() -> None:
    init_storage()
    state.config = load_config()
    seed_glossary(
        [
            GlossaryTerm(id="term_vector_db", source="vector database", target="向量数据库", domain="AI"),
            GlossaryTerm(id="term_edge", source="edge computing", target="边缘计算", domain="Cloud"),
            GlossaryTerm(id="term_latency", source="latency", target="延迟", domain="Systems"),
        ]
    )


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/api/devices")
async def devices() -> dict:
    return {"devices": [device.model_dump(mode="json") for device in list_audio_devices()]}


@app.get("/api/config")
async def get_config() -> RuntimeConfig:
    return state.config


@app.post("/api/config")
async def post_config(config: RuntimeConfig) -> RuntimeConfig:
    state.config = save_config(config)
    return state.config


@app.post("/api/session/start")
async def start_session(request: StartSessionRequest):
    return await state.start_session(request)


@app.post("/api/session/stop")
async def stop_session():
    stopped = await state.stop_session()
    return stopped or {"status": "idle"}


@app.get("/api/sessions")
async def sessions() -> dict:
    return {"sessions": [session.model_dump(mode="json") for session in list_sessions()]}


@app.get("/api/sessions/{session_id}/segments")
async def session_segments(session_id: str) -> dict:
    return {"segments": [segment.model_dump(mode="json") for segment in list_segments(session_id)]}


@app.get("/api/glossary")
async def glossary() -> dict:
    return {"terms": [term.model_dump(mode="json") for term in list_glossary()]}


@app.post("/api/glossary")
async def create_glossary_term(term_input: GlossaryTermInput) -> GlossaryTerm:
    term = GlossaryTerm(id=f"term_{uuid4().hex[:10]}", **term_input.model_dump())
    return save_glossary_term(term)


@app.put("/api/glossary/{term_id}")
async def update_glossary_term(term_id: str, term_input: GlossaryTermInput) -> GlossaryTerm:
    term = GlossaryTerm(id=term_id, **term_input.model_dump())
    return save_glossary_term(term)


@app.delete("/api/glossary/{term_id}")
async def remove_glossary_term(term_id: str) -> dict:
    delete_glossary_term(term_id)
    return {"deleted": True}


@app.websocket("/ws/subtitles")
async def subtitles(websocket: WebSocket) -> None:
    await state.hub.connect(websocket)
    try:
        await websocket.send_json({"type": "session.status", "payload": {"status": "connected"}})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await state.hub.disconnect(websocket)
