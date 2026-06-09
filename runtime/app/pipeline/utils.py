"""Shared pipeline utilities: queue helpers, broadcast wrappers, device helpers."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from ..models import RuntimeConfig, RuntimeErrorPayload
from .constants import _SEGMENT_SEQUENCE_RE

logger = logging.getLogger("pipeline.utils")

# Type aliases
Broadcast = "Callable[[str, dict], Awaitable[None]]"
ShouldStop = "Callable[[], bool]"


def now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string with Z suffix."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def get_asr_base_url(config: RuntimeConfig) -> str:
    return config.asrBaseUrl or config.baseUrl


def get_asr_api_key(config: RuntimeConfig) -> str:
    return config.asrApiKey or config.apiKey


def segment_sequence(segment_id: str) -> int:
    """Extract the numeric sequence from a segment ID like 'seg_003'."""
    match = _SEGMENT_SEQUENCE_RE.match(segment_id)
    if match:
        return int(match.group(1))
    return 1_000_000_000


def put_latest(queue: asyncio.Queue, item: object, label: str) -> object | None:
    """Put *item* into *queue*, dropping the oldest entry if full.

    Returns the dropped item, or None if nothing was dropped.
    """
    dropped: object | None = None
    if queue.full():
        try:
            dropped = queue.get_nowait()
            metadata = segment_metadata(dropped)
            if metadata:
                segment_id, start_time, end_time = metadata
                logger.warning("Drop oldest %s item: %s %.2f-%.2f", label, segment_id, start_time, end_time)
            else:
                logger.warning("Drop oldest %s item", label)
        except asyncio.QueueEmpty:
            pass

    try:
        queue.put_nowait(item)
    except asyncio.QueueFull:
        logger.warning("Drop new %s item because queue is full", label)
        return item
    return dropped


def segment_metadata(item: object) -> tuple[str, float, float] | None:
    """Extract (id, start, end) from various pipeline item types."""
    from .asr_worker import QueuedAudioSegment  # avoid circular import
    from .segment_processor import AudioSegment  # avoid circular import

    if isinstance(item, QueuedAudioSegment):
        return item.segment_id, item.segment.start_time, item.segment.end_time
    if hasattr(item, "segment") and hasattr(item.segment, "id"):
        # RecognizedSegment
        return item.segment.id, item.segment.startTime, item.segment.endTime or item.segment.startTime
    if isinstance(item, AudioSegment):
        return "", item.start_time, item.end_time
    return None


def elapsed_ms(start: float | None, end: float | None) -> float | None:
    """Compute elapsed milliseconds between two event-loop timestamps."""
    if start is None or end is None:
        return None
    return max(0.0, (end - start) * 1000)


def duration_ms(start: float, end: float) -> float:
    """Compute duration in milliseconds between two timestamps."""
    return max(0.0, (end - start) * 1000)


async def finish_task(task: asyncio.Task, timeout: float) -> None:
    """Wait for *task* with a timeout, cancelling on expiry."""
    try:
        await asyncio.wait_for(task, timeout=timeout)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        task.cancel()


async def broadcast_error(
    broadcast: Broadcast,
    code: str,
    message: str,
    recoverable: bool,
) -> None:
    """Emit a runtime.error event via the broadcast callback."""
    await broadcast(
        "runtime.error",
        RuntimeErrorPayload(code=code, message=message, recoverable=recoverable).model_dump(),
    )


async def broadcast_stopped(session_id: str, broadcast: Broadcast) -> None:
    """Emit a session.status stopped event."""
    await broadcast(
        "session.status",
        {"sessionId": session_id, "status": "stopped", "updatedAt": now_iso()},
    )


def is_loopback_device(device_id: str) -> bool:
    return device_id.startswith("wasapi_loopback_")


def parse_device_index(device_id: str) -> int | None:
    parts = device_id.split("_")
    try:
        return int(parts[-1])
    except (ValueError, IndexError):
        return None


def get_device_params(device_index: int) -> tuple[int, int]:
    import pyaudiowpatch as pyaudio

    pa = pyaudio.PyAudio()
    try:
        info = pa.get_device_info_by_index(device_index)
        return int(info["defaultSampleRate"]), int(info["maxInputChannels"])
    finally:
        pa.terminate()
