from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Awaitable, Callable

from .models import SubtitleSegment, SubtitleStatus
from .storage import upsert_segment_async


Broadcast = Callable[[str, dict], Awaitable[None]]
ShouldStop = Callable[[], bool]


SCRIPT = [
    {
        "draft": "Today we are going to talk about edge computing.",
        "final": "Today we are going to talk about edge computing.",
        "zh": "今天我们来聊边缘计算。",
        "corrected": None,
        "corrected_zh": None,
    },
    {
        "draft": "We use cashing to reduce latency.",
        "final": "We use caching to reduce latency.",
        "zh": "我们使用缓存来降低延迟。",
        "corrected": "We use caching to reduce latency near the user.",
        "corrected_zh": "我们在靠近用户的位置使用缓存来降低延迟。",
    },
    {
        "draft": "The model streams partial tokens while the speaker continues.",
        "final": "The model streams partial tokens while the speaker continues.",
        "zh": "说话人继续发言时，模型会流式输出部分结果。",
        "corrected": None,
        "corrected_zh": None,
    },
    {
        "draft": "A glossary keeps terms like vector database consistent.",
        "final": "A glossary keeps terms like vector database consistent.",
        "zh": "术语表可以让向量数据库等术语保持一致。",
        "corrected": None,
        "corrected_zh": None,
    },
]


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


async def run_mock_subtitle_pipeline(
    session_id: str,
    broadcast: Broadcast,
    should_stop: ShouldStop,
) -> None:
    await broadcast(
        "session.status",
        {"sessionId": session_id, "status": "running", "updatedAt": now_iso()},
    )
    start_time = 0.0
    index = 0

    while not should_stop():
        item = SCRIPT[index % len(SCRIPT)]
        segment_id = f"seg_{index + 1:03d}"

        interim = SubtitleSegment(
            id=segment_id,
            sessionId=session_id,
            sourceText=item["draft"],
            translatedText="正在生成译文...",
            status=SubtitleStatus.interim,
            version=1,
            startTime=start_time,
            endTime=None,
            updatedAt=now_iso(),
        )
        await broadcast("segment.created", interim.model_dump(mode="json"))
        await asyncio.sleep(0.9)
        if should_stop():
            break

        final = SubtitleSegment(
            id=segment_id,
            sessionId=session_id,
            sourceText=item["final"],
            translatedText=item["zh"],
            status=SubtitleStatus.final,
            version=2,
            startTime=start_time,
            endTime=start_time + 3.2,
            updatedAt=now_iso(),
        )
        await upsert_segment_async(final)
        await broadcast("segment.updated", final.model_dump(mode="json"))
        await asyncio.sleep(1.2)
        if should_stop():
            break

        if item["corrected"] and item["corrected_zh"]:
            corrected = SubtitleSegment(
                id=segment_id,
                sessionId=session_id,
                sourceText=item["corrected"],
                translatedText=item["corrected_zh"],
                status=SubtitleStatus.corrected,
                version=3,
                startTime=start_time,
                endTime=start_time + 3.6,
                updatedAt=now_iso(),
            )
            upsert_segment(corrected)
            await broadcast("segment.corrected", corrected.model_dump(mode="json"))
            await asyncio.sleep(0.35)
            await broadcast("segment.updated", final.model_dump(mode="json"))

        start_time += 3.8
        index += 1
        await asyncio.sleep(0.9)

    await broadcast(
        "session.status",
        {"sessionId": session_id, "status": "stopped", "updatedAt": now_iso()},
    )
