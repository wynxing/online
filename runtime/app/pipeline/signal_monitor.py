"""Audio signal monitor: detects no-signal conditions and emits diagnostics."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

from ..segmenter import AudioSegmenter
from .constants import NO_SIGNAL_GRACE_SECONDS, SIGNAL_CHECK_INTERVAL_SECONDS
from .metrics import emit_metrics
from .utils import broadcast_error

if TYPE_CHECKING:
    from .metrics import Broadcast

logger = logging.getLogger("pipeline.signal")


async def run_signal_monitor(
    session_id: str,
    segmenter: AudioSegmenter,
    broadcast: Broadcast,
    should_stop: Callable[[], bool],
    diagnostics_enabled: bool,
) -> None:
    """Periodically check audio signal stats and warn if no usable audio is detected."""
    started_at = asyncio.get_running_loop().time()
    sent_no_signal = False

    try:
        while not should_stop():
            await asyncio.sleep(SIGNAL_CHECK_INTERVAL_SECONDS)
            stats = segmenter.stats
            logger.info(
                "Audio signal stats: frames=%d, segments=%d, lowEnergyDrops=%d, lastFrameRms=%.0f, maxFrameRms=%.0f, lastSegmentRms=%.0f, maxSegmentRms=%.0f",
                stats.frames_seen,
                stats.segments_emitted,
                stats.low_energy_drops,
                stats.last_frame_rms,
                stats.max_frame_rms,
                stats.last_segment_rms,
                stats.max_segment_rms,
            )
            await emit_metrics(
                broadcast,
                diagnostics_enabled,
                {
                    "sessionId": session_id,
                    "stage": "audio",
                    "status": "stats",
                    "frames": stats.frames_seen,
                    "segments": stats.segments_emitted,
                    "lowEnergyDrops": stats.low_energy_drops,
                    "lastFrameRms": stats.last_frame_rms,
                    "maxFrameRms": stats.max_frame_rms,
                    "lastSegmentRms": stats.last_segment_rms,
                    "maxSegmentRms": stats.max_segment_rms,
                },
            )

            elapsed = asyncio.get_running_loop().time() - started_at
            if sent_no_signal or elapsed < NO_SIGNAL_GRACE_SECONDS or stats.segments_emitted > 0:
                continue

            sent_no_signal = True
            if stats.frames_seen == 0:
                message = "No audio frames have been captured. Confirm the selected audio device is active."
            else:
                message = (
                    "No usable system audio has been detected yet. Play audio through the selected [Loopback] device "
                    f"or raise playback volume. maxRms={stats.max_frame_rms:.0f}, lowEnergyDrops={stats.low_energy_drops}."
                )
            logger.warning(message)
            await broadcast_error(broadcast, "AUDIO_NO_SIGNAL", message, recoverable=True)
    except asyncio.CancelledError:
        pass
