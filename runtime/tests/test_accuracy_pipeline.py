from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import SubtitleSegment, SubtitleStatus
from app.real_pipeline import (
    QueuedAudioSegment,
    RecognizedSegment,
    SegmentTiming,
    _run_asr_processors,
    _run_translation_processors,
    sanitize_asr_text,
)
from app.segmenter import AudioSegment, AudioSegmenter


def pcm_frame(sample_rate: int, channels: int, duration: float, amplitude: int) -> bytes:
    sample_count = int(sample_rate * duration) * channels
    return np.full(sample_count, amplitude, dtype=np.int16).tobytes()


class ASRSanitizerTests(unittest.TestCase):
    def test_removes_model_protocol_noise(self) -> None:
        cases = {
            "think>\n<chinese> A confession against me.": "A confession against me.",
            "think<chinese> You're the greatest wife in the world.": "You're the greatest wife in the world.",
            "<chinese> Which authorities?": "Which authorities?",
            "<think>ignore this</think> The final answer.": "The final answer.",
            "assistant: Well, you did.": "Well, you did.",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                result = sanitize_asr_text(raw, source_lang="en")
                self.assertIsNone(result.reject_reason)
                self.assertEqual(result.text, expected)

    def test_rejects_prompt_echo_and_short_noise(self) -> None:
        for raw in ["Previous context: mm.", "1.", "10p.", "20.", "0.", "."]:
            with self.subTest(raw=raw):
                result = sanitize_asr_text(raw, source_lang="en")
                self.assertEqual(result.text, "")
                self.assertIsNotNone(result.reject_reason)

    def test_keeps_normal_and_mixed_transcripts(self) -> None:
        for raw in ["Well, you did.", "You? How could you?", "You are my own flesh and blood.", "Think about it."]:
            with self.subTest(raw=raw):
                result = sanitize_asr_text(raw, source_lang="en")
                self.assertIsNone(result.reject_reason)
                self.assertEqual(result.text, raw)

    def test_rejects_obvious_target_language_output_for_english_source(self) -> None:
        result = sanitize_asr_text("为啥？", source_lang="en")
        self.assertEqual(result.text, "")
        self.assertEqual(result.reject_reason, "target_language_output")


class SegmenterTests(unittest.TestCase):
    def test_low_energy_segments_are_dropped(self) -> None:
        segmenter = AudioSegmenter(
            sample_rate=1000,
            channels=1,
            max_duration=1.0,
            min_duration=0.5,
            silence_threshold=10.0,
            silence_duration=0.2,
            min_energy_threshold=100.0,
        )

        emitted = [
            segmenter.feed(pcm_frame(sample_rate=1000, channels=1, duration=0.1, amplitude=0))
            for _ in range(10)
        ]

        self.assertTrue(all(segment is None for segment in emitted))
        self.assertGreaterEqual(segmenter.stats.low_energy_drops, 1)

    def test_min_duration_prevents_short_segments(self) -> None:
        segmenter = AudioSegmenter(
            sample_rate=1000,
            channels=1,
            max_duration=1.6,
            min_duration=1.6,
            silence_threshold=10.0,
            silence_duration=0.1,
            min_energy_threshold=100.0,
        )

        frame = pcm_frame(sample_rate=1000, channels=1, duration=0.1, amplitude=500)
        early_segments = [segmenter.feed(frame) for _ in range(15)]
        final_segment = segmenter.feed(frame)

        self.assertTrue(all(segment is None for segment in early_segments))
        self.assertIsNotNone(final_segment)
        assert final_segment is not None
        self.assertGreaterEqual(final_segment.end_time - final_segment.start_time, 1.6)

    def test_shorter_realtime_segment_is_emitted(self) -> None:
        segmenter = AudioSegmenter(
            sample_rate=1000,
            channels=1,
            max_duration=1.2,
            min_duration=1.2,
            silence_threshold=10.0,
            silence_duration=0.1,
            min_energy_threshold=100.0,
        )

        frame = pcm_frame(sample_rate=1000, channels=1, duration=0.1, amplitude=700)
        segment = None
        for _ in range(12):
            segment = segmenter.feed(frame)

        self.assertIsNotNone(segment)
        assert segment is not None
        self.assertAlmostEqual(segment.end_time - segment.start_time, 1.2, places=1)


class FakeASR:
    def __init__(self, responses: list[tuple[float, str]]) -> None:
        self._responses = responses
        self.prompts: list[str] = []

    async def transcribe(self, wav_bytes: bytes, prompt: str = "") -> str:
        self.prompts.append(prompt)
        delay, text = self._responses.pop(0)
        await asyncio.sleep(delay)
        return text


class FakeTranslation:
    def __init__(self, delays: dict[str, float] | None = None) -> None:
        self.delays = delays or {}
        self.context_lengths: list[int] = []

    async def translate(self, source_text: str, source_lang: str, target_lang: str, glossary_terms: list, context=None) -> str:
        self.context_lengths.append(len(context or []))
        await asyncio.sleep(self.delays.get(source_text, 0.0))
        return f"译文：{source_text}"


def make_queued(segment_id: str, start: float) -> QueuedAudioSegment:
    loop = asyncio.get_running_loop()
    segment = AudioSegment(
        pcm_data=pcm_frame(sample_rate=1000, channels=1, duration=0.2, amplitude=500),
        sample_rate=1000,
        channels=1,
        start_time=start,
        end_time=start + 0.2,
    )
    now = loop.time()
    return QueuedAudioSegment(segment_id=segment_id, segment=segment, queued_at=now, timing=SegmentTiming(now))


def make_recognized(segment_id: str, source: str, start: float) -> RecognizedSegment:
    loop = asyncio.get_running_loop()
    now = loop.time()
    segment = SubtitleSegment(
        id=segment_id,
        sessionId="session_test",
        sourceText=source,
        translatedText="Translating...",
        status=SubtitleStatus.interim,
        version=1,
        startTime=start,
        endTime=start + 0.2,
        updatedAt="2026-06-05T00:00:00Z",
    )
    timing = SegmentTiming(segment_queued_at=now - 0.1, asr_started_at=now - 0.09, asr_finished_at=now - 0.05)
    return RecognizedSegment(segment=segment, source_text=source, recognized_at=now, timing=timing)


class PipelineConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_asr_workers_emit_metrics_and_keep_segment_ids(self) -> None:
        segment_queue: asyncio.Queue[QueuedAudioSegment] = asyncio.Queue()
        translation_queue: asyncio.Queue[RecognizedSegment] = asyncio.Queue()
        for index in range(3):
            segment_queue.put_nowait(make_queued(f"seg_{index + 1:03d}", start=float(index)))

        events: list[tuple[str, dict]] = []

        async def broadcast(event_type: str, payload: dict) -> None:
            events.append((event_type, payload))

        asr = FakeASR([(0.03, "First line."), (0.0, "0."), (0.01, "Third line.")])
        await _run_asr_processors(
            session_id="session_test",
            segment_queue=segment_queue,
            translation_queue=translation_queue,
            asr=asr,
            broadcast=broadcast,
            should_stop=lambda: True,
            concurrency=2,
            source_lang="en",
            diagnostics_enabled=True,
        )

        recognized: list[RecognizedSegment] = []
        while not translation_queue.empty():
            recognized.append(translation_queue.get_nowait())

        self.assertEqual({item.segment.id for item in recognized}, {"seg_001", "seg_003"})
        self.assertTrue(any(event == "segment.created" for event, _ in events))
        self.assertTrue(any(payload.get("dropReason") == "numeric_or_symbol_noise" for event, payload in events if event == "pipeline.metrics"))
        self.assertTrue(any(payload.get("stage") == "asr" and payload.get("status") == "finished" for event, payload in events if event == "pipeline.metrics"))

    async def test_translation_workers_broadcast_final_segments_and_context(self) -> None:
        translation_queue: asyncio.Queue[RecognizedSegment] = asyncio.Queue()
        translation_queue.put_nowait(make_recognized("seg_001", "First line.", 0.0))
        translation_queue.put_nowait(make_recognized("seg_002", "Second line.", 1.0))
        translation_queue.put_nowait(make_recognized("seg_003", "Third line.", 2.0))

        events: list[tuple[str, dict]] = []
        stored: list[SubtitleSegment] = []

        async def broadcast(event_type: str, payload: dict) -> None:
            events.append((event_type, payload))

        translation = FakeTranslation(delays={"First line.": 0.02, "Second line.": 0.0, "Third line.": 0.01})
        with patch("app.real_pipeline.upsert_segment", lambda segment: stored.append(segment)):
            await _run_translation_processors(
                session_id="session_test",
                translation_queue=translation_queue,
                translation=translation,
                glossary_terms=[],
                broadcast=broadcast,
                should_stop=lambda: True,
                concurrency=2,
                diagnostics_enabled=True,
            )

        updated_ids = [payload["id"] for event, payload in events if event == "segment.updated"]
        self.assertEqual(set(updated_ids), {"seg_001", "seg_002", "seg_003"})
        self.assertEqual({segment.id for segment in stored}, {"seg_001", "seg_002", "seg_003"})
        self.assertTrue(any(length > 0 for length in translation.context_lengths))
        self.assertTrue(
            any(
                payload.get("stage") == "translation" and payload.get("status") == "finished"
                for event, payload in events
                if event == "pipeline.metrics"
            )
        )


if __name__ == "__main__":
    unittest.main()
