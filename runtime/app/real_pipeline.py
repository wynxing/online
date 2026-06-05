"""Real subtitle pipeline: capture -> segment -> ASR -> translation -> WebSocket."""

from __future__ import annotations

import asyncio
import logging
import re
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Awaitable, Callable

from .asr_provider import ChatCompletionASRProvider, OpenAICompatibleASRProvider, pcm_to_wav
from .audio_capture import AudioCapture
from .models import GlossaryTerm, RuntimeConfig, RuntimeErrorPayload, SubtitleSegment, SubtitleStatus
from .segmenter import AudioSegment, AudioSegmenter
from .storage import upsert_segment
from .translation_provider import RealTranslationProvider, TranslationContext

logger = logging.getLogger("pipeline.real")

Broadcast = Callable[[str, dict], Awaitable[None]]
ShouldStop = Callable[[], bool]
ASRProvider = OpenAICompatibleASRProvider | ChatCompletionASRProvider

NO_SIGNAL_GRACE_SECONDS = 8.0
SIGNAL_CHECK_INTERVAL_SECONDS = 2.0
SEGMENT_QUEUE_MAXSIZE = 10
TRANSLATION_QUEUE_MAXSIZE = 8
ASR_STALE_SECONDS = 12.0
TRANSLATION_STALE_SECONDS = 10.0

_CJK_RE = re.compile(r"[\u3400-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_ROLE_PREFIX_RE = re.compile(
    r"^\s*(?:assistant|user|system|transcript|translation|answer)\s*[:：]\s*",
    re.IGNORECASE,
)
_PROMPT_ECHO_RE = re.compile(r"^\s*(?:previous\s+context|context)\s*[:：]", re.IGNORECASE)
_THINK_BLOCK_RE = re.compile(r"(?is)<think>.*?</think>")
_TAG_RE = re.compile(r"</?[^>\n]+>")
_LEADING_THINK_RE = re.compile(r"^\s*(?:think|reasoning|analysis)\s*(?:>|:|-)\s*", re.IGNORECASE)
_LEADING_LOWER_THINK_WORD_RE = re.compile(r"^\s*think\s+(?=[A-Z<])")
_NUMERIC_NOISE_RE = re.compile(r"^\s*\d+\s*[A-Za-z]?\s*[\W_]*\s*$")
_SHORT_MARKER_RE = re.compile(r"^\s*(?:[A-Za-z]|\d+[A-Za-z]?)\s*[\W_]*\s*$")


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
    segment: AudioSegment
    queued_at: float
    timing: SegmentTiming


@dataclass
class RecognizedSegment:
    segment: SubtitleSegment
    source_text: str
    recognized_at: float
    timing: SegmentTiming


@dataclass(frozen=True)
class SanitizedASRText:
    text: str
    reject_reason: str | None = None


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def get_asr_base_url(config: RuntimeConfig) -> str:
    return config.asrBaseUrl or config.baseUrl


def get_asr_api_key(config: RuntimeConfig) -> str:
    return config.asrApiKey or config.apiKey


async def run_real_subtitle_pipeline(
    session_id: str,
    config: RuntimeConfig,
    broadcast: Broadcast,
    should_stop: ShouldStop,
    device_id: str,
    glossary_terms: list[GlossaryTerm],
) -> None:
    """Run the real-time subtitle pipeline."""
    await broadcast(
        "session.status",
        {"sessionId": session_id, "status": "running", "updatedAt": now_iso()},
    )

    device_index = _parse_device_index(device_id)
    if device_index is None:
        await _broadcast_error(
            broadcast,
            "AUDIO_DEVICE_INVALID",
            f"Cannot parse audio device id: {device_id}",
            recoverable=False,
        )
        await _broadcast_stopped(session_id, broadcast)
        return

    sample_rate, channels = _get_device_params(device_index)
    is_loopback = _is_loopback_device(device_id)
    logger.info(
        "Using audio device: id=%s, index=%d, rate=%d, channels=%d, loopback=%s",
        device_id,
        device_index,
        sample_rate,
        channels,
        is_loopback,
    )

    capture = AudioCapture(device_index, sample_rate, channels)
    segmenter = _create_segmenter(config, sample_rate, channels, is_loopback)
    asr = _create_asr_provider(config)
    translation = RealTranslationProvider(
        base_url=config.baseUrl,
        api_key=config.apiKey,
        model=config.translationModel,
    )

    frame_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=200)
    segment_queue: asyncio.Queue[QueuedAudioSegment] = asyncio.Queue(maxsize=SEGMENT_QUEUE_MAXSIZE)
    translation_queue: asyncio.Queue[RecognizedSegment] = asyncio.Queue(maxsize=TRANSLATION_QUEUE_MAXSIZE)

    try:
        capture.start(frame_queue)
    except Exception as e:
        await asr.aclose()
        await translation.aclose()
        await _broadcast_error(
            broadcast,
            "AUDIO_DEVICE_UNAVAILABLE",
            f"Cannot open audio device: {e}",
            recoverable=False,
        )
        await _broadcast_stopped(session_id, broadcast)
        return

    segmenter_task = asyncio.create_task(
        _run_segmenter(session_id, frame_queue, segment_queue, segmenter, broadcast, should_stop, config.diagnosticsEnabled)
    )
    asr_task = asyncio.create_task(
        _run_asr_processors(
            session_id,
            segment_queue,
            translation_queue,
            asr,
            broadcast,
            should_stop,
            config.asrConcurrency,
            config.asrLanguage,
            config.diagnosticsEnabled,
        )
    )
    translation_task = asyncio.create_task(
        _run_translation_processors(
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
        _run_signal_monitor(session_id, segmenter, broadcast, should_stop, config.diagnosticsEnabled)
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
        _put_latest(
            segment_queue,
            QueuedAudioSegment(
                segment_id=segment_id,
                segment=remaining,
                queued_at=queued_at,
                timing=SegmentTiming(segment_queued_at=queued_at),
            ),
            "segment",
        )

    await _finish_task(segmenter_task, timeout=5)
    await _finish_task(asr_task, timeout=20)
    await _finish_task(translation_task, timeout=20)
    await _finish_task(signal_task, timeout=2)

    await asr.aclose()
    await translation.aclose()
    await _broadcast_stopped(session_id, broadcast)


def _create_asr_provider(config: RuntimeConfig) -> ASRProvider:
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


def sanitize_asr_text(raw_text: str, source_lang: str = "en") -> SanitizedASRText:
    text = raw_text.strip()
    if not text:
        return SanitizedASRText(text="", reject_reason="empty")

    if _PROMPT_ECHO_RE.match(text):
        return SanitizedASRText(text="", reject_reason="prompt_echo")

    text = _THINK_BLOCK_RE.sub(" ", text)
    text = text.replace("```", " ")
    text = _TAG_RE.sub(" ", text)
    text = _LEADING_THINK_RE.sub("", text)
    text = _LEADING_LOWER_THINK_WORD_RE.sub("", text)

    for _ in range(3):
        stripped = _ROLE_PREFIX_RE.sub("", text)
        if stripped == text:
            break
        text = stripped

    text = re.sub(r"\s+", " ", text).strip(" \t\r\n\"'")
    if not text:
        return SanitizedASRText(text="", reject_reason="empty_after_cleanup")

    if _PROMPT_ECHO_RE.match(text):
        return SanitizedASRText(text="", reject_reason="prompt_echo")

    if _NUMERIC_NOISE_RE.match(text) or _SHORT_MARKER_RE.match(text) or not any(ch.isalpha() for ch in text):
        return SanitizedASRText(text="", reject_reason="numeric_or_symbol_noise")

    latin_count = len(_LATIN_RE.findall(text))
    cjk_count = len(_CJK_RE.findall(text))
    if source_lang.lower().startswith("en") and cjk_count > 0 and latin_count == 0:
        return SanitizedASRText(text="", reject_reason="target_language_output")

    return SanitizedASRText(text=text)


async def _run_segmenter(
    session_id: str,
    frame_queue: asyncio.Queue[bytes],
    segment_queue: asyncio.Queue[QueuedAudioSegment],
    segmenter: AudioSegmenter,
    broadcast: Broadcast,
    should_stop: ShouldStop,
    diagnostics_enabled: bool,
) -> None:
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
                await _emit_metrics(
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
            dropped = _put_latest(
                segment_queue,
                QueuedAudioSegment(
                    segment_id=segment_id,
                    segment=segment,
                    queued_at=queued_at,
                    timing=SegmentTiming(segment_queued_at=queued_at),
                ),
                "segment",
            )
            await _emit_metrics(
                broadcast,
                diagnostics_enabled,
                {
                    "sessionId": session_id,
                    "segmentId": segment_id,
                    "stage": "segment",
                    "status": "queued",
                    "audioStart": segment.start_time,
                    "audioEnd": segment.end_time,
                    "audioDurationMs": _duration_ms(segment.start_time, segment.end_time),
                    "segmentQueueSize": segment_queue.qsize(),
                },
            )
            if dropped:
                await _emit_drop_metrics(session_id, broadcast, diagnostics_enabled, dropped, "segment_queue_full")
    except asyncio.CancelledError:
        pass


async def _run_asr_processors(
    session_id: str,
    segment_queue: asyncio.Queue[QueuedAudioSegment],
    translation_queue: asyncio.Queue[RecognizedSegment],
    asr: ASRProvider,
    broadcast: Broadcast,
    should_stop: ShouldStop,
    concurrency: int,
    source_lang: str,
    diagnostics_enabled: bool,
) -> None:
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
                await _emit_drop_metrics(session_id, broadcast, diagnostics_enabled, queued, "asr_stale")
                continue

            queued.timing.asr_started_at = loop.time()
            await _emit_metrics(
                broadcast,
                diagnostics_enabled,
                _segment_metrics_payload(
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

            wav_bytes = pcm_to_wav(
                queued.segment.pcm_data,
                channels=queued.segment.channels,
                sample_rate=queued.segment.sample_rate,
            )

            async with recent_lock:
                prompt = recent_source[-1] if recent_source else ""

            try:
                source_text = await asr.transcribe(wav_bytes, prompt=prompt)
            except Exception as e:
                queued.timing.asr_finished_at = loop.time()
                logger.warning("ASR failed: segment=%s, error=%s", queued.segment_id, e)
                await _emit_metrics(
                    broadcast,
                    diagnostics_enabled,
                    _segment_metrics_payload(
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
                await _broadcast_error(
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
                _elapsed_ms(queued.timing.asr_started_at, queued.timing.asr_finished_at),
            )

            if cleaned.reject_reason:
                async with empty_lock:
                    empty_results += 1
                    should_warn_empty = empty_results == 3
                await _emit_drop_metrics(
                    session_id,
                    broadcast,
                    diagnostics_enabled,
                    queued,
                    cleaned.reject_reason,
                    stage="asr",
                )
                if should_warn_empty:
                    await _broadcast_error(
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
            dropped = _put_latest(
                translation_queue,
                RecognizedSegment(
                    segment=interim,
                    source_text=source_text,
                    recognized_at=loop.time(),
                    timing=queued.timing,
                ),
                "translation",
            )
            await _emit_metrics(
                broadcast,
                diagnostics_enabled,
                _segment_metrics_payload(
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
                await _emit_drop_metrics(session_id, broadcast, diagnostics_enabled, dropped, "translation_queue_full")

    workers = [asyncio.create_task(worker(i + 1)) for i in range(max(1, concurrency))]
    try:
        await asyncio.gather(*workers)
    except asyncio.CancelledError:
        for task in workers:
            task.cancel()


async def _run_translation_processors(
    session_id: str,
    translation_queue: asyncio.Queue[RecognizedSegment],
    translation: RealTranslationProvider,
    glossary_terms: list[GlossaryTerm],
    broadcast: Broadcast,
    should_stop: ShouldStop,
    concurrency: int,
    diagnostics_enabled: bool,
) -> None:
    context: deque[TranslationContext] = deque(maxlen=2)
    context_lock = asyncio.Lock()

    async def worker(worker_id: int) -> None:
        while not should_stop() or not translation_queue.empty():
            try:
                item = await asyncio.wait_for(translation_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            loop = asyncio.get_running_loop()
            translation_lag = loop.time() - item.recognized_at
            if translation_lag > TRANSLATION_STALE_SECONDS:
                logger.warning(
                    "Drop stale translation segment: segment=%s audio=%.2f-%.2f queueLag=%.2fs backlog=%d",
                    item.segment.id,
                    item.segment.startTime,
                    item.segment.endTime or item.segment.startTime,
                    translation_lag,
                    translation_queue.qsize(),
                )
                await _emit_drop_metrics(session_id, broadcast, diagnostics_enabled, item, "translation_stale")
                continue

            item.timing.translation_started_at = loop.time()
            await _emit_metrics(
                broadcast,
                diagnostics_enabled,
                _segment_metrics_payload(
                    session_id,
                    item.segment.id,
                    "translation",
                    "started",
                    item.segment,
                    item.timing,
                    worker_id=worker_id,
                    translation_queue_size=translation_queue.qsize(),
                    queue_lag_ms=translation_lag * 1000,
                ),
            )

            async with context_lock:
                context_snapshot = list(context)

            try:
                translated_text = await translation.translate(
                    source_text=item.source_text,
                    source_lang="en",
                    target_lang="zh-CN",
                    glossary_terms=glossary_terms,
                    context=context_snapshot,
                )
            except Exception as e:
                logger.warning("Translation failed: segment=%s, error=%s", item.segment.id, e)
                await _broadcast_error(
                    broadcast,
                    "TRANSLATION_FAILED",
                    f"Translation request failed: {e}",
                    recoverable=True,
                )
                translated_text = "[translation failed]"

            item.timing.translation_finished_at = loop.time()
            final = item.segment.model_copy(
                update={
                    "translatedText": translated_text,
                    "status": SubtitleStatus.final,
                    "version": 2,
                    "updatedAt": now_iso(),
                }
            )
            logger.info(
                "Translation finalized: segment=%s source=%r translated=%r asrMs=%.0f translationMs=%.0f pipelineMs=%.0f",
                item.segment.id,
                item.source_text[:160],
                translated_text[:160],
                _elapsed_ms(item.timing.asr_started_at, item.timing.asr_finished_at),
                _elapsed_ms(item.timing.translation_started_at, item.timing.translation_finished_at),
                _elapsed_ms(item.timing.segment_queued_at, item.timing.translation_finished_at),
            )
            upsert_segment(final)
            async with context_lock:
                context.append(TranslationContext(source_text=item.source_text, translated_text=translated_text))
            await broadcast("segment.updated", final.model_dump(mode="json"))
            await _emit_metrics(
                broadcast,
                diagnostics_enabled,
                _segment_metrics_payload(
                    session_id,
                    item.segment.id,
                    "translation",
                    "finished",
                    item.segment,
                    item.timing,
                    worker_id=worker_id,
                    translation_queue_size=translation_queue.qsize(),
                    queue_lag_ms=translation_lag * 1000,
                ),
            )

    workers = [asyncio.create_task(worker(i + 1)) for i in range(max(1, concurrency))]
    try:
        await asyncio.gather(*workers)
    except asyncio.CancelledError:
        for task in workers:
            task.cancel()


async def _run_signal_monitor(
    session_id: str,
    segmenter: AudioSegmenter,
    broadcast: Broadcast,
    should_stop: ShouldStop,
    diagnostics_enabled: bool,
) -> None:
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
            await _emit_metrics(
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
            await _broadcast_error(broadcast, "AUDIO_NO_SIGNAL", message, recoverable=True)
    except asyncio.CancelledError:
        pass


def _put_latest(queue: asyncio.Queue, item: object, label: str) -> object | None:
    dropped: object | None = None
    if queue.full():
        try:
            dropped = queue.get_nowait()
            metadata = _segment_metadata(dropped)
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


def _segment_metadata(item: object) -> tuple[str, float, float] | None:
    if isinstance(item, QueuedAudioSegment):
        return item.segment_id, item.segment.start_time, item.segment.end_time
    if isinstance(item, RecognizedSegment):
        return item.segment.id, item.segment.startTime, item.segment.endTime or item.segment.startTime
    if isinstance(item, AudioSegment):
        return "", item.start_time, item.end_time
    return None


async def _emit_drop_metrics(
    session_id: str,
    broadcast: Broadcast,
    diagnostics_enabled: bool,
    item: object,
    reason: str,
    stage: str = "queue",
) -> None:
    payload = {
        "sessionId": session_id,
        "stage": stage,
        "status": "dropped",
        "dropReason": reason,
    }
    if isinstance(item, QueuedAudioSegment):
        payload.update(
            _segment_metrics_payload(
                session_id,
                item.segment_id,
                stage,
                "dropped",
                item.segment,
                item.timing,
            )
        )
        payload["dropReason"] = reason
    elif isinstance(item, RecognizedSegment):
        payload.update(
            _segment_metrics_payload(
                session_id,
                item.segment.id,
                stage,
                "dropped",
                item.segment,
                item.timing,
            )
        )
        payload["dropReason"] = reason
    await _emit_metrics(broadcast, diagnostics_enabled, payload)


def _segment_metrics_payload(
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
    if isinstance(segment, AudioSegment):
        audio_start = segment.start_time
        audio_end = segment.end_time
    else:
        audio_start = segment.startTime
        audio_end = segment.endTime or segment.startTime

    payload = {
        "sessionId": session_id,
        "segmentId": segment_id,
        "stage": stage,
        "status": status,
        "audioStart": audio_start,
        "audioEnd": audio_end,
        "audioDurationMs": _duration_ms(audio_start, audio_end),
        "segmentQueuedAt": timing.segment_queued_at,
        "asrStartedAt": timing.asr_started_at,
        "asrFinishedAt": timing.asr_finished_at,
        "translationStartedAt": timing.translation_started_at,
        "translationFinishedAt": timing.translation_finished_at,
        "asrDurationMs": _elapsed_ms(timing.asr_started_at, timing.asr_finished_at),
        "translationDurationMs": _elapsed_ms(timing.translation_started_at, timing.translation_finished_at),
        "endToEndMs": _elapsed_ms(timing.segment_queued_at, timing.translation_finished_at),
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


async def _emit_metrics(broadcast: Broadcast, enabled: bool, payload: dict) -> None:
    if not enabled:
        return
    await broadcast("pipeline.metrics", payload | {"updatedAt": now_iso()})


def _elapsed_ms(start: float | None, end: float | None) -> float | None:
    if start is None or end is None:
        return None
    return max(0.0, (end - start) * 1000)


def _duration_ms(start: float, end: float) -> float:
    return max(0.0, (end - start) * 1000)


async def _finish_task(task: asyncio.Task, timeout: float) -> None:
    try:
        await asyncio.wait_for(task, timeout=timeout)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        task.cancel()


async def _broadcast_error(
    broadcast: Broadcast,
    code: str,
    message: str,
    recoverable: bool,
) -> None:
    await broadcast(
        "runtime.error",
        RuntimeErrorPayload(code=code, message=message, recoverable=recoverable).model_dump(),
    )


async def _broadcast_stopped(session_id: str, broadcast: Broadcast) -> None:
    await broadcast(
        "session.status",
        {"sessionId": session_id, "status": "stopped", "updatedAt": now_iso()},
    )


def _is_loopback_device(device_id: str) -> bool:
    return device_id.startswith("wasapi_loopback_")


def _parse_device_index(device_id: str) -> int | None:
    parts = device_id.split("_")
    try:
        return int(parts[-1])
    except (ValueError, IndexError):
        return None


def _get_device_params(device_index: int) -> tuple[int, int]:
    import pyaudiowpatch as pyaudio

    pa = pyaudio.PyAudio()
    try:
        info = pa.get_device_info_by_index(device_index)
        return int(info["defaultSampleRate"]), int(info["maxInputChannels"])
    finally:
        pa.terminate()
