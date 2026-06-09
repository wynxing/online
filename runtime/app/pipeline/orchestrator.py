"""Main pipeline orchestrator: wires together capture, segment, ASR, and translation."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Awaitable, Callable

from ..asr_provider import ChatCompletionASRProvider, OpenAICompatibleASRProvider
from ..audio_capture import AudioCapture
from ..models import GlossaryTerm, RuntimeConfig
from ..segmenter import AudioSegmenter
from ..translation_provider import RealTranslationProvider
from .asr_worker import QueuedAudioSegment, SegmentTiming, run_asr_processors
from .metrics import emit_metrics
from .segment_processor import run_segmenter
from .signal_monitor import run_signal_monitor
from .translation_worker import run_translation_processors
from .utils import (
    broadcast_error,
    broadcast_stopped,
    finish_task,
    get_asr_api_key,
    get_asr_base_url,
    get_device_params,
    is_loopback_device,
    now_iso,
    parse_device_index,
    put_latest,
)

if TYPE_CHECKING:
    from .metrics import Broadcast

logger = logging.getLogger("pipeline.real")


def create_asr_provider(config: RuntimeConfig) -> "OpenAICompatibleASRProvider | ChatCompletionASRProvider":
    asr_url = get_asr_base_url(config)
    asr_key = get_asr_api_key(config)

    if config.asrFormat == "chat-completions":
        return ChatCompletionASRProvider(
            base_url=asr_url,
            api_key=asr_key,
            model=config.asrModel,
            language=config.asrLanguage,
        )

    return OpenAICompatibleASRProvider(
        base_url=asr_url,
        api_key=asr_key,
        model=config.asrModel,
        language=config.asrLanguage,
    )


def _create_segmenter(config: RuntimeConfig, sample_rate: int, channels: int, is_loopback: bool) -> AudioSegmenter:
    max_duration = max(config.segmentMaxDuration, config.segmentMinDuration)
    if is_loopback:
        logger.info("Using low-volume loopback segmentation thresholds")
        return AudioSegmenter(
            sample_rate=sample_rate,
            channels=channels,
            max_duration=max_duration,
            min_duration=config.segmentMinDuration,
            silence_threshold=140.0,
            silence_duration=config.segmentSilenceDuration,
            min_energy_threshold=90.0,
        )

    return AudioSegmenter(
        sample_rate=sample_rate,
        channels=channels,
        max_duration=max_duration,
        min_duration=config.segmentMinDuration,
        silence_duration=config.segmentSilenceDuration,
    )


async def run_real_subtitle_pipeline(
    session_id: str,
    config: RuntimeConfig,
    broadcast: "Broadcast",
    should_stop: Callable[[], bool],
    device_id: str,
    glossary_terms: list[GlossaryTerm],
) -> None:
    """Run the real-time subtitle pipeline: capture → segment → ASR → translation → broadcast."""
    from .constants import SEGMENT_QUEUE_MAXSIZE, TRANSLATION_QUEUE_MAXSIZE

    await broadcast(
        "session.status",
        {"sessionId": session_id, "status": "running", "updatedAt": now_iso()},
    )

    device_index = parse_device_index(device_id)
    if device_index is None:
        await broadcast_error(
            broadcast,
            "AUDIO_DEVICE_INVALID",
            f"Cannot parse audio device id: {device_id}",
            recoverable=False,
        )
        await broadcast_stopped(session_id, broadcast)
        return

    sample_rate, channels = get_device_params(device_index)
    loopback = is_loopback_device(device_id)
    logger.info(
        "Using audio device: id=%s, index=%d, rate=%d, channels=%d, loopback=%s",
        device_id,
        device_index,
        sample_rate,
        channels,
        loopback,
    )

    capture = AudioCapture(device_index, sample_rate, channels)
    segmenter = _create_segmenter(config, sample_rate, channels, loopback)
    asr = create_asr_provider(config)
    translation = RealTranslationProvider(
        base_url=config.baseUrl,
        api_key=config.apiKey,
        model=config.translationModel,
    )

    frame_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=200)
    segment_queue: asyncio.Queue[QueuedAudioSegment] = asyncio.Queue(maxsize=SEGMENT_QUEUE_MAXSIZE)
    from .asr_worker import RecognizedSegment
    translation_queue: asyncio.Queue[RecognizedSegment] = asyncio.Queue(maxsize=TRANSLATION_QUEUE_MAXSIZE)

    try:
        capture.start(frame_queue)
    except Exception as e:
        await asr.aclose()
        await translation.aclose()
        await broadcast_error(
            broadcast,
            "AUDIO_DEVICE_UNAVAILABLE",
            f"Cannot open audio device: {e}",
            recoverable=False,
        )
        await broadcast_stopped(session_id, broadcast)
        return

    segmenter_task = asyncio.create_task(
        run_segmenter(session_id, frame_queue, segment_queue, segmenter, broadcast, should_stop, config.diagnosticsEnabled)
    )
    asr_task = asyncio.create_task(
        run_asr_processors(
            session_id,
            segment_queue,
            translation_queue,
            asr,
            broadcast,
            should_stop,
            config.asrConcurrency,
            config.asrLanguage,
            config.diagnosticsEnabled,
            asr_target_rate=config.asrTargetRate,
        )
    )
    translation_task = asyncio.create_task(
        run_translation_processors(
            session_id,
            translation_queue,
            translation,
            glossary_terms,
            broadcast,
            should_stop,
            config.translationConcurrency,
            config.diagnosticsEnabled,
        )
    )
    signal_task = asyncio.create_task(
        run_signal_monitor(session_id, segmenter, broadcast, should_stop, config.diagnosticsEnabled)
    )

    try:
        while not should_stop():
            await asyncio.sleep(0.2)
    except asyncio.CancelledError:
        pass

    capture.stop()

    remaining = segmenter.flush()
    if remaining:
        segment_id = "seg_flush"
        queued_at = asyncio.get_running_loop().time()
        put_latest(
            segment_queue,
            QueuedAudioSegment(
                segment_id=segment_id,
                segment=remaining,
                queued_at=queued_at,
                timing=SegmentTiming(segment_queued_at=queued_at),
            ),
            "segment",
        )

    await finish_task(segmenter_task, timeout=5)
    await finish_task(asr_task, timeout=20)
    await finish_task(translation_task, timeout=20)
    await finish_task(signal_task, timeout=2)

    await asr.aclose()
    await translation.aclose()
    await broadcast_stopped(session_id, broadcast)
