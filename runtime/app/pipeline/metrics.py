"""Pipeline diagnostic metrics emission."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .utils import duration_ms, elapsed_ms, now_iso

if TYPE_CHECKING:
    from ..models import SubtitleSegment
    from ..segmenter import AudioSegment
    from .asr_worker import SegmentTiming

logger = logging.getLogger("pipeline.metrics")

# Sample rate: emit metrics every N-th call to reduce WebSocket pressure.
# Set to 1 to disable sampling (emit all events). Increase in production.
_METRICS_SAMPLE_RATE = 1


def segment_metrics_payload(
    session_id: str,
    segment_id: str,
    stage: str,
    status: str,
    segment: AudioSegment | SubtitleSegment,
    timing: SegmentTiming,
    worker_id: int | None = None,
    segment_queue_size: int | None = None,
    translation_queue_size: int | None = None,
    queue_lag_ms: float | None = None,
) -> dict:
    """Build a metrics payload dict for a pipeline event."""
    from ..segmenter import AudioSegment  # avoid circular at module level

    if isinstance(segment, AudioSegment):
        audio_start = segment.start_time
        audio_end = segment.end_time
    else:
        audio_start = segment.startTime
        audio_end = segment.endTime or segment.startTime

    payload: dict = {
        "sessionId": session_id,
        "segmentId": segment_id,
        "stage": stage,
        "status": status,
        "audioStart": audio_start,
        "audioEnd": audio_end,
        "audioDurationMs": duration_ms(audio_start, audio_end),
        "segmentQueuedAt": timing.segment_queued_at,
        "asrStartedAt": timing.asr_started_at,
        "asrFinishedAt": timing.asr_finished_at,
        "translationStartedAt": timing.translation_started_at,
        "translationFinishedAt": timing.translation_finished_at,
        "asrDurationMs": elapsed_ms(timing.asr_started_at, timing.asr_finished_at),
        "translationDurationMs": elapsed_ms(timing.translation_started_at, timing.translation_finished_at),
        "endToEndMs": elapsed_ms(timing.segment_queued_at, timing.translation_finished_at),
    }
    if worker_id is not None:
        payload["workerId"] = worker_id
    if segment_queue_size is not None:
        payload["segmentQueueSize"] = segment_queue_size
    if translation_queue_size is not None:
        payload["translationQueueSize"] = translation_queue_size
    if queue_lag_ms is not None:
        payload["queueLagMs"] = queue_lag_ms
    return payload


_emit_counter = 0


async def emit_metrics(broadcast: Broadcast, enabled: bool, payload: dict) -> None:
    """Emit a pipeline.metrics event if diagnostics are enabled.

    Samples metric events: only every _METRICS_SAMPLE_RATE-th non-critical call
    is emitted. Drop and error events are always emitted.
    """
    if not enabled:
        return
    global _emit_counter
    _emit_counter += 1
    status = payload.get("status", "")
    is_critical = status in ("dropped", "failed")
    if not is_critical and _emit_counter % _METRICS_SAMPLE_RATE != 0:
        return
    await broadcast("pipeline.metrics", payload | {"updatedAt": now_iso()})


async def emit_drop_metrics(
    session_id: str,
    broadcast: Broadcast,
    diagnostics_enabled: bool,
    item: object,
    reason: str,
    stage: str = "queue",
) -> None:
    """Emit a drop-related metrics event."""
    from .utils import segment_metadata

    payload: dict = {
        "sessionId": session_id,
        "stage": stage,
        "status": "dropped",
        "dropReason": reason,
    }
    meta = segment_metadata(item)
    if meta is not None:
        segment_id, start, end = meta
        # Build a minimal segment-like object for metrics
        from dataclasses import dataclass

        @dataclass
        class _MiniSegment:
            start_time: float = 0.0
            end_time: float = 0.0
            startTime: float = 0.0
            endTime: float | None = None

        mini = _MiniSegment(start_time=start, end_time=end, startTime=start, endTime=end)
        from .asr_worker import SegmentTiming

        timing = getattr(item, "timing", SegmentTiming(segment_queued_at=0))
        payload.update(
            segment_metrics_payload(
                session_id,
                segment_id,
                stage,
                "dropped",
                mini,  # type: ignore[arg-type]
                timing,
            )
        )
        payload["dropReason"] = reason
    await emit_metrics(broadcast, diagnostics_enabled, payload)


# Re-export type alias for convenience
from collections.abc import Awaitable, Callable  # noqa: E402

Broadcast = Callable[[str, dict], Awaitable[None]]
