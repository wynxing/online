"""Translation worker: consumes recognized segments, translates, and emits final subtitles."""

from __future__ import annotations

import asyncio
import logging
import re
from collections import deque
from typing import TYPE_CHECKING, Awaitable, Callable

from dataclasses import dataclass

from ..models import GlossaryTerm, SubtitleSegment, SubtitleStatus
from ..translation_provider import RealTranslationProvider, TranslationContext
from .asr_worker import RecognizedSegment, SegmentTiming
from .constants import (
    TRANSLATION_OPEN_TAIL_WAIT_SECONDS,
    TRANSLATION_QUEUE_POLL_SECONDS,
    TRANSLATION_REORDER_WAIT_SECONDS,
    TRANSLATION_STALE_SECONDS,
)
from .metrics import emit_drop_metrics, emit_metrics, segment_metrics_payload
from .utils import broadcast_error, now_iso, segment_sequence

if TYPE_CHECKING:
    from .metrics import Broadcast

logger = logging.getLogger("pipeline.translation")


@dataclass
class TranslationResult:
    session_id: str
    item: RecognizedSegment
    source_text: str
    final: SubtitleSegment
    event_type: str
    worker_id: int
    translation_queue_size: int
    translation_lag: float

_SENTENCE_BOUNDARY_RE = re.compile(r"[.!?…][\"')\]]*(?:\s+|$)")
_SENTENCE_END_RE = re.compile(r"[.!?…][\"')\]]*\s*$")
_LONG_SEGMENT_BOUNDARY_RE = re.compile(r"[,;][\"')\]]*\s+(?=[A-Z])")


def _is_sentence_complete(source_text: str) -> bool:
    text = source_text.strip()
    if _SENTENCE_END_RE.search(text):
        return True
    if len(text) > 80 and _LONG_SEGMENT_BOUNDARY_RE.search(text):
        return True
    return False


def _split_first_sentence(source_text: str) -> "tuple[str | None, str]":
    text = source_text.strip()
    match = _SENTENCE_BOUNDARY_RE.search(text)
    if match:
        end = match.end()
        return text[:end].strip(), text[end:].strip()
    if len(text) > 80:
        comma_match = _LONG_SEGMENT_BOUNDARY_RE.search(text)
        if comma_match:
            end = comma_match.end()
            return text[:end].strip(), text[end:].strip()
    return None, ""


def _join_source_text(*parts: str) -> str:
    text = " ".join(part.strip() for part in parts if part.strip())
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _recognized_with_source(item: RecognizedSegment, source_text: str) -> RecognizedSegment:
    return RecognizedSegment(
        segment=item.segment.model_copy(update={"sourceText": source_text}),
        source_text=source_text,
        recognized_at=item.recognized_at,
        timing=item.timing,
    )


def _recognized_from_segment(
    segment: SubtitleSegment,
    recognized_at: float,
    timing: SegmentTiming,
) -> RecognizedSegment:
    return RecognizedSegment(
        segment=segment,
        source_text=segment.sourceText,
        recognized_at=recognized_at,
        timing=timing,
    )


async def _translate_segment(
    session_id: str,
    item: RecognizedSegment,
    source_text: str,
    translation: RealTranslationProvider,
    glossary_terms: list[GlossaryTerm],
    context: deque[TranslationContext],
    context_lock: asyncio.Lock,
    broadcast: "Broadcast",
    diagnostics_enabled: bool,
    translation_queue_size: int,
    worker_id: int,
    event_type: str,
    status: SubtitleStatus,
) -> "TranslationResult":
    loop = asyncio.get_running_loop()
    translation_lag = loop.time() - item.recognized_at
    item.timing.translation_started_at = loop.time()
    await emit_metrics(
        broadcast,
        diagnostics_enabled,
        segment_metrics_payload(
            session_id,
            item.segment.id,
            "translation",
            "started",
            item.segment,
            item.timing,
            worker_id=worker_id,
            translation_queue_size=translation_queue_size,
            queue_lag_ms=translation_lag * 1000,
        ),
    )

    async with context_lock:
        context_snapshot = list(context)

    # Streaming translation state
    accumulated_text = ""
    last_stream_time = loop.time()
    pending_token_count = 0
    from .constants import STREAM_MIN_TOKENS, STREAM_MAX_INTERVAL, STREAM_MIN_INTERVAL

    async def on_stream_token(token: str) -> None:
        nonlocal accumulated_text, last_stream_time, pending_token_count
        accumulated_text += token
        pending_token_count += 1
        now = loop.time()
        elapsed = now - last_stream_time
        if (
            pending_token_count >= STREAM_MIN_TOKENS
            or elapsed >= STREAM_MAX_INTERVAL
        ) and elapsed >= STREAM_MIN_INTERVAL:
            last_stream_time = now
            pending_token_count = 0
            await broadcast(
                "segment.streaming",
                {
                    "id": item.segment.id,
                    "sessionId": session_id,
                    "translatedText": accumulated_text,
                    "status": "streaming",
                },
            )

    try:
        translated_text = await translation.translate_streaming(
            source_text=source_text,
            source_lang="en",
            target_lang="zh-CN",
            glossary_terms=glossary_terms,
            context=context_snapshot,
            on_token=on_stream_token,
        )
    except Exception as e:
        logger.warning("Translation failed: segment=%s, error=%s", item.segment.id, e)
        await broadcast_error(
            broadcast,
            "TRANSLATION_FAILED",
            f"Translation request failed: {e}",
            recoverable=True,
        )
        translated_text = "[translation failed]"

    item.timing.translation_finished_at = loop.time()
    final = item.segment.model_copy(
        update={
            "sourceText": source_text,
            "translatedText": translated_text,
            "status": status,
            "version": item.segment.version + 1,
            "updatedAt": now_iso(),
            "supersededBy": None,
        }
    )
    return TranslationResult(
        session_id=session_id,
        item=item,
        source_text=source_text,
        final=final,
        event_type=event_type,
        worker_id=worker_id,
        translation_queue_size=translation_queue_size,
        translation_lag=translation_lag,
    )


async def _emit_translation_result(
    result: "TranslationResult",
    broadcast: "Broadcast",
    diagnostics_enabled: bool,
) -> SubtitleSegment:
    from .utils import elapsed_ms

    # Late import to allow test mocking via app.real_pipeline.upsert_segment_async
    import sys
    _rp = sys.modules.get("app.real_pipeline")
    if _rp is not None:
        upsert_fn = _rp.upsert_segment_async
    else:
        from ..storage import upsert_segment_async as upsert_fn

    logger.info(
        "Translation finalized: event=%s segment=%s source=%r translated=%r asrMs=%.0f translationMs=%.0f pipelineMs=%.0f",
        result.event_type,
        result.item.segment.id,
        result.source_text[:160],
        result.final.translatedText[:160],
        elapsed_ms(result.item.timing.asr_started_at, result.item.timing.asr_finished_at),
        elapsed_ms(result.item.timing.translation_started_at, result.item.timing.translation_finished_at),
        elapsed_ms(result.item.timing.segment_queued_at, result.item.timing.translation_finished_at),
    )
    await upsert_fn(result.final)
    await broadcast(result.event_type, result.final.model_dump(mode="json"))
    await emit_metrics(
        broadcast,
        diagnostics_enabled,
        segment_metrics_payload(
            result.session_id,
            result.item.segment.id,
            "translation",
            "finished",
            result.final,
            result.item.timing,
            worker_id=result.worker_id,
            translation_queue_size=result.translation_queue_size,
            queue_lag_ms=result.translation_lag * 1000,
        ),
    )
    return result.final


async def _mark_superseded(
    item: RecognizedSegment,
    superseded_by: str,
    broadcast: "Broadcast",
) -> None:
    superseded = item.segment.model_copy(
        update={
            "translatedText": "",
            "status": SubtitleStatus.final,
            "version": item.segment.version + 1,
            "updatedAt": now_iso(),
            "supersededBy": superseded_by,
        }
    )
    await broadcast("segment.updated", superseded.model_dump(mode="json"))


async def run_translation_processors(
    session_id: str,
    translation_queue: asyncio.Queue[RecognizedSegment],
    translation: RealTranslationProvider,
    glossary_terms: list[GlossaryTerm],
    broadcast: "Broadcast",
    should_stop: Callable[[], bool],
    concurrency: int,
    diagnostics_enabled: bool,
) -> None:
    """Run the translation processing pipeline with reordering and continuation support."""
    context: deque[TranslationContext] = deque(maxlen=4)
    context_lock = asyncio.Lock()
    ready_buffer: deque[RecognizedSegment] = deque()
    pending: dict[int, RecognizedSegment] = {}
    next_sequence = 1
    open_tail: RecognizedSegment | None = None
    max_concurrency = max(1, concurrency)
    worker_slots: asyncio.Queue[int] = asyncio.Queue()
    for worker_id in range(1, max_concurrency + 1):
        worker_slots.put_nowait(worker_id)
    scheduled_tasks: dict[int, asyncio.Task[TranslationResult]] = {}
    emit_order: deque[int] = deque()

    async def process_item(item: RecognizedSegment) -> None:
        nonlocal open_tail
        if open_tail is not None:
            await drain_scheduled(block=True)
            combined_source = _join_source_text(open_tail.source_text, item.source_text)
            completed_source, remainder = _split_first_sentence(combined_source)
            correction_source = completed_source or combined_source
            result = await _translate_segment(
                session_id=session_id,
                item=open_tail,
                source_text=correction_source,
                translation=translation,
                glossary_terms=glossary_terms,
                context=context,
                context_lock=context_lock,
                broadcast=broadcast,
                diagnostics_enabled=diagnostics_enabled,
                translation_queue_size=translation_queue.qsize(),
                worker_id=1,
                event_type="segment.corrected",
                status=SubtitleStatus.corrected,
            )
            corrected = await _emit_translation_result(
                result=result,
                broadcast=broadcast,
                diagnostics_enabled=diagnostics_enabled,
            )
            async with context_lock:
                if completed_source:
                    context.append(TranslationContext(source_text=correction_source, translated_text=corrected.translatedText))

            if remainder:
                remainder_item = _recognized_with_source(item, remainder)
                open_tail = None
                await process_item(remainder_item)
                return

            await _mark_superseded(
                item=item,
                superseded_by=open_tail.segment.id,
                broadcast=broadcast,
            )
            open_tail = None if completed_source else _recognized_from_segment(corrected, item.recognized_at, open_tail.timing)
            return

        if _is_sentence_complete(item.source_text):
            if max_concurrency <= 1 or not context:
                final = await translate_and_emit_serial(item, item.source_text, "segment.updated", SubtitleStatus.final)
                async with context_lock:
                    context.append(TranslationContext(source_text=item.source_text, translated_text=final.translatedText))
                open_tail = None
                return

            schedule_complete_translation(item)
            return

        await drain_scheduled(block=True)
        next_item = await wait_for_next_ordered_item()
        if next_item is not None:
            open_tail = item
            await process_item(next_item)
            return

        final = await translate_and_emit_serial(item, item.source_text, "segment.updated", SubtitleStatus.final)
        open_tail = _recognized_from_segment(final, item.recognized_at, item.timing)

    async def translate_and_emit_serial(
        item: RecognizedSegment,
        source_text: str,
        event_type: str,
        status: SubtitleStatus,
    ) -> SubtitleSegment:
        result = await _translate_segment(
            session_id=session_id,
            item=item,
            source_text=source_text,
            translation=translation,
            glossary_terms=glossary_terms,
            context=context,
            context_lock=context_lock,
            broadcast=broadcast,
            diagnostics_enabled=diagnostics_enabled,
            translation_queue_size=translation_queue.qsize(),
            worker_id=1,
            event_type=event_type,
            status=status,
        )
        return await _emit_translation_result(
            result=result,
            broadcast=broadcast,
            diagnostics_enabled=diagnostics_enabled,
        )

    def schedule_complete_translation(item: RecognizedSegment) -> None:
        sequence = segment_sequence(item.segment.id)
        emit_order.append(sequence)
        scheduled_tasks[sequence] = asyncio.create_task(run_scheduled_translation(item))

    async def run_scheduled_translation(item: RecognizedSegment) -> TranslationResult:
        worker_id = await worker_slots.get()
        try:
            return await _translate_segment(
                session_id=session_id,
                item=item,
                source_text=item.source_text,
                translation=translation,
                glossary_terms=glossary_terms,
                context=context,
                context_lock=context_lock,
                broadcast=broadcast,
                diagnostics_enabled=diagnostics_enabled,
                translation_queue_size=translation_queue.qsize(),
                worker_id=worker_id,
                event_type="segment.updated",
                status=SubtitleStatus.final,
            )
        finally:
            worker_slots.put_nowait(worker_id)

    async def drain_scheduled(block: bool) -> None:
        while emit_order:
            sequence = emit_order[0]
            task = scheduled_tasks[sequence]
            if not task.done():
                if not block:
                    return
                result = await task
            else:
                result = task.result()

            emit_order.popleft()
            del scheduled_tasks[sequence]
            final = await _emit_translation_result(
                result=result,
                broadcast=broadcast,
                diagnostics_enabled=diagnostics_enabled,
            )
            async with context_lock:
                context.append(TranslationContext(source_text=result.source_text, translated_text=final.translatedText))

    async def wait_for_next_ordered_item() -> RecognizedSegment | None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + TRANSLATION_OPEN_TAIL_WAIT_SECONDS
        while loop.time() < deadline:
            ready_buffer.extend(ordered_ready_items(force=False))
            if ready_buffer:
                return ready_buffer.popleft()

            timeout = min(TRANSLATION_QUEUE_POLL_SECONDS, max(0.0, deadline - loop.time()))
            if timeout <= 0:
                break
            await ingest_next_item(timeout)
        return None

    async def ingest_next_item(timeout: float) -> None:
        try:
            item = await asyncio.wait_for(translation_queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return

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
            await emit_drop_metrics(session_id, broadcast, diagnostics_enabled, item, "translation_stale")
            return

        pending[segment_sequence(item.segment.id)] = item

    def ordered_ready_items(force: bool) -> list[RecognizedSegment]:
        nonlocal next_sequence
        ready: list[RecognizedSegment] = []
        loop = asyncio.get_running_loop()
        while pending:
            if next_sequence in pending:
                ready.append(pending.pop(next_sequence))
                next_sequence += 1
                continue

            oldest_pending_at = min(item.recognized_at for item in pending.values())
            if not force and (loop.time() - oldest_pending_at) < TRANSLATION_REORDER_WAIT_SECONDS:
                break

            next_available = min(pending)
            logger.warning(
                "Skip missing ASR segment sequence before translation: expected=%d next_available=%d",
                next_sequence,
                next_available,
            )
            next_sequence = next_available
        return ready

    # Dynamic concurrency monitoring
    from .constants import TRANSLATION_BACKLOG_THRESHOLD
    _extra_slots_added = 0

    async def _monitor_backlog() -> None:
        nonlocal _extra_slots_added
        while not should_stop():
            await asyncio.sleep(2.0)
            backlog = translation_queue.qsize() + len(pending) + len(scheduled_tasks)
            if backlog >= TRANSLATION_BACKLOG_THRESHOLD and _extra_slots_added < 2:
                worker_slots.put_nowait(max_concurrency + _extra_slots_added + 1)
                _extra_slots_added += 1
                logger.info(
                    "Translation scale up: backlog=%d, extraSlots=%d",
                    backlog, _extra_slots_added,
                )
            elif backlog == 0 and _extra_slots_added > 0:
                logger.info(
                    "Translation scale down: backlog=%d, extraSlots=%d",
                    backlog, _extra_slots_added,
                )
                _extra_slots_added = 0

    backlog_monitor = asyncio.create_task(_monitor_backlog())

    try:
        while not should_stop() or not translation_queue.empty() or pending or ready_buffer or scheduled_tasks:
            force_order = should_stop() and translation_queue.empty()
            if not ready_buffer:
                if scheduled_tasks and translation_queue.empty() and not pending:
                    await drain_scheduled(block=True)
                    continue

                await ingest_next_item(timeout=0.2)
                ready_buffer.extend(ordered_ready_items(force=force_order))

            while ready_buffer:
                ordered_item = ready_buffer.popleft()
                await process_item(ordered_item)
                await drain_scheduled(block=False)

            await drain_scheduled(block=False)
    except asyncio.CancelledError:
        for task in scheduled_tasks.values():
            task.cancel()
        return
    finally:
        backlog_monitor.cancel()
    await drain_scheduled(block=True)
