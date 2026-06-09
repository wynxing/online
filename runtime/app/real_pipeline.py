"""Real subtitle pipeline: capture -> segment -> ASR -> translation -> WebSocket.

This module is a backward-compatible re-export wrapper.  The actual
implementation lives in ``app.pipeline``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

# Re-export everything from the pipeline sub-package so that existing
# ``from app.real_pipeline import ...`` statements continue to work.
from .pipeline import (  # noqa: F401
    ASRProvider,
    ASR_STALE_SECONDS,
    Broadcast,
    NO_SIGNAL_GRACE_SECONDS,
    QueuedAudioSegment,
    RecognizedSegment,
    SEGMENT_QUEUE_MAXSIZE,
    SegmentTiming,
    SIGNAL_CHECK_INTERVAL_SECONDS,
    ShouldStop,
    TRANSLATION_MAX_CONCURRENCY,
    TRANSLATION_OPEN_TAIL_WAIT_SECONDS,
    TRANSLATION_QUEUE_MAXSIZE,
    TRANSLATION_QUEUE_POLL_SECONDS,
    TRANSLATION_REORDER_WAIT_SECONDS,
    TRANSLATION_STALE_SECONDS,
    broadcast_error,
    broadcast_stopped,
    create_asr_provider,
    duration_ms,
    elapsed_ms,
    emit_drop_metrics,
    emit_metrics,
    finish_task,
    get_asr_api_key,
    get_asr_base_url,
    get_device_params,
    is_loopback_device,
    now_iso,
    parse_device_index,
    put_latest,
    run_asr_processors,
    run_real_subtitle_pipeline,
    run_segmenter,
    run_signal_monitor,
    run_translation_processors,
    sanitize_asr_text,
    segment_metrics_payload,
    segment_metadata,
    segment_sequence,
)

# Also re-export upsert_segment_async so that tests can mock
# ``app.real_pipeline.upsert_segment_async``.
from .storage import upsert_segment_async  # noqa: F401

# Backward-compatible aliases for underscore-prefixed names used in tests.
_run_asr_processors = run_asr_processors  # noqa: F841
_run_translation_processors = run_translation_processors  # noqa: F841
_create_asr_provider = create_asr_provider  # noqa: F841
