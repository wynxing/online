"""Audio segmenter consumer: feeds PCM frames and emits completed segments."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from ..segmenter import AudioSegmenter
from .metrics import emit_drop_metrics, emit_metrics
from .utils import put_latest

if TYPE_CHECKING:
    from collections.abc import Callable

    from .asr_worker import QueuedAudioSegment
    from .metrics import Broadcast

logger = logging.getLogger("pipeline.segment")


async def run_segmenter(
    session_id: str,
    frame_queue: asyncio.Queue[bytes],
    segment_queue: asyncio.Queue[QueuedAudioSegment],
    segmenter: AudioSegmenter,
    broadcast: Broadcast,
    should_stop: Callable[[], bool],
    diagnostics_enabled: bool,
) -> None:
    """Consume PCM frames from *frame_queue*, segment them, and enqueue completed segments."""
    from .asr_worker import QueuedAudioSegment, SegmentTiming

    segment_counter = 0
    try:
        while not should_stop():
            try:
                frame = await asyncio.wait_for(frame_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            drops_before = segmenter.stats.low_energy_drops
            segment = segmenter.feed(frame)
            if segmenter.stats.low_energy_drops > drops_before:
                await emit_metrics(
                    broadcast,
                    diagnostics_enabled,
                    {
                        "sessionId": session_id,
                        "stage": "segment",
                        "status": "dropped",
                        "dropReason": "low_energy",
                        "droppedCount": segmenter.stats.low_energy_drops,
                    },
                )
            if not segment:
                continue

            segment_counter += 1
            segment_id = f"seg_{segment_counter:03d}"
            queued_at = asyncio.get_running_loop().time()
            dropped = put_latest(
                segment_queue,
                QueuedAudioSegment(
                    segment_id=segment_id,
                    segment=segment,
                    queued_at=queued_at,
                    timing=SegmentTiming(segment_queued_at=queued_at),
                ),
                "segment",
            )
            await emit_metrics(
                broadcast,
                diagnostics_enabled,
                {
                    "sessionId": session_id,
                    "segmentId": segment_id,
                    "stage": "segment",
                    "status": "queued",
                    "audioStart": segment.start_time,
                    "audioEnd": segment.end_time,
                    "audioDurationMs": (segment.end_time - segment.start_time) * 1000,
                    "segmentQueueSize": segment_queue.qsize(),
                },
            )
            if dropped:
                await emit_drop_metrics(session_id, broadcast, diagnostics_enabled, dropped, "segment_queue_full")
    except asyncio.CancelledError:
        pass
