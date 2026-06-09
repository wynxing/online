"""ASR worker: consumes segmented audio, runs speech recognition, emits recognized text."""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Awaitable, Callable

from ..asr_provider import ChatCompletionASRProvider, OpenAICompatibleASRProvider, pcm_to_wav, prepare_for_asr
from ..models import SubtitleSegment, SubtitleStatus
from .constants import ASR_STALE_SECONDS
from .metrics import emit_drop_metrics, emit_metrics, segment_metrics_payload
from .text_sanitize import sanitize_asr_text
from .utils import now_iso, put_latest

if TYPE_CHECKING:
    from ..asr_provider import ChatCompletionASRProvider, OpenAICompatibleASRProvider
    from ..segmenter import AudioSegment
    from .metrics import Broadcast

logger = logging.getLogger("pipeline.asr")

ASRProvider = "OpenAICompatibleASRProvider | ChatCompletionASRProvider"


@dataclass
class SegmentTiming:
    segment_queued_at: float
    asr_started_at: float | None = None
    asr_finished_at: float | None = None
    translation_started_at: float | None = None
    translation_finished_at: float | None = None


@dataclass
class QueuedAudioSegment:
    segment_id: str
    segment: "AudioSegment"
    queued_at: float
    timing: SegmentTiming


@dataclass
class RecognizedSegment:
    segment: SubtitleSegment
    source_text: str
    recognized_at: float
    timing: SegmentTiming


async def run_asr_processors(
    session_id: str,
    segment_queue: asyncio.Queue[QueuedAudioSegment],
    translation_queue: asyncio.Queue[RecognizedSegment],
    asr: ASRProvider,
    broadcast: "Broadcast",
    should_stop: Callable[[], bool],
    concurrency: int,
    source_lang: str,
    diagnostics_enabled: bool,
    asr_target_rate: int = 16000,
) -> None:
    """Run *concurrency* ASR workers that consume from *segment_queue*."""
    recent_source: deque[str] = deque(maxlen=1)
    recent_lock = asyncio.Lock()
    empty_results = 0
    empty_lock = asyncio.Lock()

    async def worker(worker_id: int) -> None:
        nonlocal empty_results
        while not should_stop() or not segment_queue.empty():
            try:
                queued = await asyncio.wait_for(segment_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            loop = asyncio.get_running_loop()
            queue_lag = loop.time() - queued.queued_at
            if queue_lag > ASR_STALE_SECONDS:
                logger.warning(
                    "Drop stale ASR segment: segment=%s audio=%.2f-%.2f queueLag=%.2fs backlog=%d",
                    queued.segment_id,
                    queued.segment.start_time,
                    queued.segment.end_time,
                    queue_lag,
                    segment_queue.qsize(),
                )
                await emit_drop_metrics(session_id, broadcast, diagnostics_enabled, queued, "asr_stale")
                continue

            queued.timing.asr_started_at = loop.time()
            await emit_metrics(
                broadcast,
                diagnostics_enabled,
                segment_metrics_payload(
                    session_id,
                    queued.segment_id,
                    "asr",
                    "started",
                    queued.segment,
                    queued.timing,
                    worker_id=worker_id,
                    segment_queue_size=segment_queue.qsize(),
                    queue_lag_ms=queue_lag * 1000,
                ),
            )

            pcm_data, channels, sample_rate = prepare_for_asr(
                queued.segment.pcm_data,
                channels=queued.segment.channels,
                sample_rate=queued.segment.sample_rate,
                target_rate=asr_target_rate,
            )
            wav_bytes = pcm_to_wav(
                pcm_data,
                channels=channels,
                sample_rate=sample_rate,
            )

            async with recent_lock:
                prompt = recent_source[-1] if recent_source else ""

            try:
                source_text = await asr.transcribe(wav_bytes, prompt=prompt)
            except Exception as e:
                queued.timing.asr_finished_at = loop.time()
                logger.warning("ASR failed: segment=%s, error=%s", queued.segment_id, e)
                await emit_metrics(
                    broadcast,
                    diagnostics_enabled,
                    segment_metrics_payload(
                        session_id,
                        queued.segment_id,
                        "asr",
                        "failed",
                        queued.segment,
                        queued.timing,
                        worker_id=worker_id,
                    )
                    | {"error": str(e)},
                )
                from .utils import broadcast_error

                await broadcast_error(
                    broadcast,
                    "ASR_FAILED",
                    f"ASR request failed: {e}",
                    recoverable=True,
                )
                continue

            queued.timing.asr_finished_at = loop.time()
            cleaned = sanitize_asr_text(source_text, source_lang=source_lang)
            logger.info(
                "ASR cleaned: segment=%s raw=%r cleaned=%r reject=%s queueLag=%.2fs asrMs=%.0f",
                queued.segment_id,
                source_text[:160],
                cleaned.text[:160],
                cleaned.reject_reason,
                queue_lag,
                (queued.timing.asr_finished_at - queued.timing.asr_started_at) * 1000
                if queued.timing.asr_started_at
                else 0,
            )

            if cleaned.reject_reason:
                async with empty_lock:
                    empty_results += 1
                    should_warn_empty = empty_results == 3
                await emit_drop_metrics(
                    session_id,
                    broadcast,
                    diagnostics_enabled,
                    queued,
                    cleaned.reject_reason,
                    stage="asr",
                )
                if should_warn_empty:
                    from .utils import broadcast_error

                    await broadcast_error(
                        broadcast,
                        "ASR_EMPTY",
                        "ASR returned unusable text for several audio segments. Check loopback device, audio language, playback volume, and ASR model settings.",
                        recoverable=True,
                    )
                continue

            async with empty_lock:
                empty_results = 0
            source_text = cleaned.text
            async with recent_lock:
                recent_source.append(source_text)

            interim = SubtitleSegment(
                id=queued.segment_id,
                sessionId=session_id,
                sourceText=source_text,
                translatedText="Translating...",
                status=SubtitleStatus.interim,
                version=1,
                startTime=queued.segment.start_time,
                endTime=queued.segment.end_time,
                updatedAt=now_iso(),
            )
            await broadcast("segment.created", interim.model_dump(mode="json"))
            dropped = put_latest(
                translation_queue,
                RecognizedSegment(
                    segment=interim,
                    source_text=source_text,
                    recognized_at=loop.time(),
                    timing=queued.timing,
                ),
                "translation",
            )
            await emit_metrics(
                broadcast,
                diagnostics_enabled,
                segment_metrics_payload(
                    session_id,
                    queued.segment_id,
                    "asr",
                    "finished",
                    queued.segment,
                    queued.timing,
                    worker_id=worker_id,
                    segment_queue_size=segment_queue.qsize(),
                    translation_queue_size=translation_queue.qsize(),
                    queue_lag_ms=queue_lag * 1000,
                ),
            )
            if dropped:
                await emit_drop_metrics(session_id, broadcast, diagnostics_enabled, dropped, "translation_queue_full")

    workers = [asyncio.create_task(worker(i + 1)) for i in range(max(1, concurrency))]
    try:
        await asyncio.gather(*workers)
    except asyncio.CancelledError:
        for task in workers:
            task.cancel()
