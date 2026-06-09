"""Pipeline subpackage: audio capture → segmentation → ASR → translation → broadcast.

Re-exports all public symbols for backward compatibility with existing imports
from ``app.real_pipeline``.
"""

from .asr_worker import (
    ASRProvider,
    QueuedAudioSegment,
    RecognizedSegment,
    SegmentTiming,
    run_asr_processors,
)
from .constants import (
    ASR_STALE_SECONDS,
    NO_SIGNAL_GRACE_SECONDS,
    SEGMENT_QUEUE_MAXSIZE,
    SIGNAL_CHECK_INTERVAL_SECONDS,
    TRANSLATION_MAX_CONCURRENCY,
    TRANSLATION_OPEN_TAIL_WAIT_SECONDS,
    TRANSLATION_QUEUE_MAXSIZE,
    TRANSLATION_QUEUE_POLL_SECONDS,
    TRANSLATION_REORDER_WAIT_SECONDS,
    TRANSLATION_STALE_SECONDS,
)
from .metrics import (
    emit_drop_metrics,
    emit_metrics,
    segment_metrics_payload,
)
from .orchestrator import (
    create_asr_provider,
    run_real_subtitle_pipeline,
)
from .segment_processor import run_segmenter
from .signal_monitor import run_signal_monitor
from .text_sanitize import sanitize_asr_text
from .translation_worker import run_translation_processors
from .utils import (
    Broadcast,
    ShouldStop,
    broadcast_error,
    broadcast_stopped,
    duration_ms,
    elapsed_ms,
    finish_task,
    get_asr_api_key,
    get_asr_base_url,
    get_device_params,
    is_loopback_device,
    now_iso,
    parse_device_index,
    put_latest,
    segment_metadata,
    segment_sequence,
)

__all__ = [
    # ASR worker
    "ASRProvider",
    "QueuedAudioSegment",
    "RecognizedSegment",
    "SegmentTiming",
    "run_asr_processors",
    # Constants
    "ASR_STALE_SECONDS",
    "NO_SIGNAL_GRACE_SECONDS",
    "SEGMENT_QUEUE_MAXSIZE",
    "SIGNAL_CHECK_INTERVAL_SECONDS",
    "TRANSLATION_MAX_CONCURRENCY",
    "TRANSLATION_OPEN_TAIL_WAIT_SECONDS",
    "TRANSLATION_QUEUE_MAXSIZE",
    "TRANSLATION_QUEUE_POLL_SECONDS",
    "TRANSLATION_REORDER_WAIT_SECONDS",
    "TRANSLATION_STALE_SECONDS",
    # Metrics
    "emit_drop_metrics",
    "emit_metrics",
    "segment_metrics_payload",
    # Orchestrator
    "create_asr_provider",
    "run_real_subtitle_pipeline",
    # Segment processor
    "run_segmenter",
    # Signal monitor
    "run_signal_monitor",
    # Text sanitize
    "sanitize_asr_text",
    # Translation worker
    "run_translation_processors",
    # Utils
    "Broadcast",
    "ShouldStop",
    "broadcast_error",
    "broadcast_stopped",
    "duration_ms",
    "elapsed_ms",
    "finish_task",
    "get_asr_api_key",
    "get_asr_base_url",
    "get_device_params",
    "is_loopback_device",
    "now_iso",
    "parse_device_index",
    "put_latest",
    "segment_metadata",
    "segment_sequence",
]
