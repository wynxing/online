from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app
from app.models import GlossaryTerm, SubtitleSegment, SubtitleStatus
from app.real_pipeline import (
    QueuedAudioSegment,
    RecognizedSegment,
    SegmentTiming,
    _run_asr_processors,
    _run_translation_processors,
    sanitize_asr_text,
)
from app.segmenter import AudioSegment, AudioSegmenter
from app.translation_provider import (
    RealTranslationProvider,
    TranslationContext,
    _clean_translation_text,
    _matched_glossary_terms,
)


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
            segmenter.feed(pcm_frame(sample_rate=1000, channels=1, duration=0.1, amplitude=0)) for _ in range(10)
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


class TranslationProviderTests(unittest.TestCase):
    def test_filters_glossary_to_matching_enabled_terms(self) -> None:
        terms = [
            GlossaryTerm(id="term_1", source="vector database", target="向量数据库", domain="AI"),
            GlossaryTerm(id="term_2", source="latency", target="延迟", domain="Systems"),
            GlossaryTerm(id="term_3", source="disabled term", target="禁用", enabled=False),
        ]

        matched = _matched_glossary_terms(
            "The vector database is faster.",
            [TranslationContext(source_text="Previous latency was high.", translated_text="之前延迟很高。")],
            terms,
        )

        self.assertEqual([term["source"] for term in matched], ["vector database", "latency"])

    def test_cleans_translation_protocol_noise(self) -> None:
        cleaned = _clean_translation_text('```text\nassistant: "这是译文。"\n```')
        self.assertEqual(cleaned, "这是译文。")


class FakeTranslationResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class FakeTranslationClient:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    async def post(self, *args, **kwargs) -> FakeTranslationResponse:
        return FakeTranslationResponse(self._payload)

    async def aclose(self) -> None:
        return None


class TranslationProviderAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_translation_content_raises(self) -> None:
        provider = RealTranslationProvider(
            base_url="https://example.test/v1",
            api_key="test-key",
            model="test-model",
        )
        await provider._client.aclose()
        provider._client = FakeTranslationClient({"choices": [{"message": {"content": ""}}]})

        with self.assertRaisesRegex(RuntimeError, "empty response"):
            await provider.translate(
                source_text="Hello world",
                source_lang="en",
                target_lang="zh-CN",
                glossary_terms=[],
            )

        await provider.aclose()


class FakeEndpointTranslationProvider:
    sample = "translated hello"
    error: Exception | None = None
    init_kwargs: dict = {}

    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        type(self).init_kwargs = {"base_url": base_url, "api_key": api_key, "model": model}

    async def translate(self, *args, **kwargs) -> str:
        if type(self).error:
            raise type(self).error
        return type(self).sample

    async def aclose(self) -> None:
        return None


class TranslationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        FakeEndpointTranslationProvider.sample = "translated hello"
        FakeEndpointTranslationProvider.error = None
        FakeEndpointTranslationProvider.init_kwargs = {}

    def test_translation_test_endpoint_uses_request_config(self) -> None:
        with patch("app.main.RealTranslationProvider", FakeEndpointTranslationProvider):
            response = TestClient(app).post(
                "/api/test-translation",
                json={
                    "baseUrl": " https://api.example.test/v1/ ",
                    "apiKey": "test-key",
                    "translationModel": "test-model",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "ok": True,
                "sample": "translated hello",
                "model": "test-model",
                "base_url": "https://api.example.test/v1",
            },
        )
        self.assertEqual(
            FakeEndpointTranslationProvider.init_kwargs,
            {"base_url": "https://api.example.test/v1", "api_key": "test-key", "model": "test-model"},
        )

    def test_translation_test_endpoint_returns_502_for_empty_response_error(self) -> None:
        FakeEndpointTranslationProvider.error = RuntimeError("Translation API returned empty response")

        with patch("app.main.RealTranslationProvider", FakeEndpointTranslationProvider):
            response = TestClient(app).post(
                "/api/test-translation",
                json={
                    "baseUrl": "https://api.example.test/v1",
                    "apiKey": "test-key",
                    "translationModel": "test-model",
                },
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["ok"], False)
        self.assertEqual(response.json()["error"], "Translation API returned empty response")

    def test_translation_test_endpoint_validates_required_fields(self) -> None:
        response = TestClient(app).post(
            "/api/test-translation",
            json={"baseUrl": "https://api.example.test/v1", "apiKey": "", "translationModel": "test-model"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["ok"], False)
        self.assertEqual(response.json()["error"], "Translation API Key is required.")


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
    def __init__(self, delays: dict[str, float] | None = None, failures: set[str] | None = None) -> None:
        self.delays = delays or {}
        self.failures = failures or set()
        self.context_lengths: list[int] = []
        self.glossary_lengths: list[int] = []
        self.sources: list[str] = []

    async def translate(
        self, source_text: str, source_lang: str, target_lang: str, glossary_terms: list, context=None
    ) -> str:
        self.sources.append(source_text)
        self.context_lengths.append(len(context or []))
        self.glossary_lengths.append(len(glossary_terms))
        await asyncio.sleep(self.delays.get(source_text, 0.0))
        if source_text in self.failures:
            raise RuntimeError("fake translation failure")
        return f"translation:{source_text}"

    async def translate_streaming(
        self, source_text: str, source_lang: str, target_lang: str, glossary_terms: list, context=None, on_token=None
    ) -> str:
        """Fake streaming translation for tests."""
        self.sources.append(source_text)
        self.context_lengths.append(len(context or []))
        self.glossary_lengths.append(len(glossary_terms))
        await asyncio.sleep(self.delays.get(source_text, 0.0))
        if source_text in self.failures:
            raise RuntimeError("fake translation failure")
        result = f"translation:{source_text}"
        # Simulate streaming by calling on_token for each character
        if on_token:
            for char in result:
                await on_token(char)
        return result


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
        self.assertTrue(
            any(
                payload.get("dropReason") == "numeric_or_symbol_noise"
                for event, payload in events
                if event == "pipeline.metrics"
            )
        )
        self.assertTrue(
            any(
                payload.get("stage") == "asr" and payload.get("status") == "finished"
                for event, payload in events
                if event == "pipeline.metrics"
            )
        )

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

        async def _store_async(segment):
            stored.append(segment)

        with patch("app.real_pipeline.upsert_segment_async", _store_async):
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
        self.assertEqual(updated_ids, ["seg_001", "seg_002", "seg_003"])
        self.assertEqual({segment.id for segment in stored}, {"seg_001", "seg_002", "seg_003"})
        self.assertTrue(any(length > 0 for length in translation.context_lengths))
        self.assertTrue(
            any(
                payload.get("stage") == "translation" and payload.get("status") == "finished"
                for event, payload in events
                if event == "pipeline.metrics"
            )
        )

    async def test_translation_concurrency_reduces_complete_segment_latency(self) -> None:
        translation_queue: asyncio.Queue[RecognizedSegment] = asyncio.Queue()
        translation_queue.put_nowait(make_recognized("seg_001", "First line.", 0.0))
        translation_queue.put_nowait(make_recognized("seg_002", "Second line.", 1.0))
        translation_queue.put_nowait(make_recognized("seg_003", "Third line.", 2.0))

        events: list[tuple[str, dict]] = []

        async def broadcast(event_type: str, payload: dict) -> None:
            events.append((event_type, payload))

        translation = FakeTranslation(delays={"First line.": 0.01, "Second line.": 0.08, "Third line.": 0.08})
        started_at = asyncio.get_running_loop().time()

        async def _noop_async(segment):
            return None

        with patch("app.real_pipeline.upsert_segment_async", _noop_async):
            await _run_translation_processors(
                session_id="session_test",
                translation_queue=translation_queue,
                translation=translation,
                glossary_terms=[],
                broadcast=broadcast,
                should_stop=lambda: True,
                concurrency=3,
                diagnostics_enabled=True,
            )
        elapsed = asyncio.get_running_loop().time() - started_at

        updated_ids = [payload["id"] for event, payload in events if event == "segment.updated"]
        self.assertEqual(updated_ids, ["seg_001", "seg_002", "seg_003"])
        self.assertLess(elapsed, 0.15)

    async def test_translation_corrects_open_tail_with_next_segment(self) -> None:
        translation_queue: asyncio.Queue[RecognizedSegment] = asyncio.Queue()
        translation_queue.put_nowait(make_recognized("seg_001", "became so easy, the countries usually", 0.0))
        translation_queue.put_nowait(make_recognized("seg_002", "overrelied on one sector.", 1.0))

        events: list[tuple[str, dict]] = []
        stored: list[SubtitleSegment] = []

        async def broadcast(event_type: str, payload: dict) -> None:
            events.append((event_type, payload))

        translation = FakeTranslation()

        async def _store_async(segment):
            stored.append(segment)

        with patch("app.real_pipeline.upsert_segment_async", _store_async):
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

        corrected = [payload for event, payload in events if event == "segment.corrected"]
        superseded = [payload for event, payload in events if event == "segment.updated" and payload["id"] == "seg_002"]

        self.assertEqual(len(corrected), 1)
        self.assertEqual(corrected[0]["id"], "seg_001")
        self.assertEqual(corrected[0]["sourceText"], "became so easy, the countries usually overrelied on one sector.")
        self.assertEqual(superseded[-1]["supersededBy"], "seg_001")
        self.assertNotIn("became so easy, the countries usually", translation.sources)
        self.assertIn("became so easy, the countries usually overrelied on one sector.", translation.sources)
        self.assertTrue(any(segment.status == SubtitleStatus.corrected for segment in stored))

    async def test_complete_segment_translates_without_continuation_correction(self) -> None:
        translation_queue: asyncio.Queue[RecognizedSegment] = asyncio.Queue()
        translation_queue.put_nowait(make_recognized("seg_001", "First line.", 0.0))

        events: list[tuple[str, dict]] = []

        async def broadcast(event_type: str, payload: dict) -> None:
            events.append((event_type, payload))

        translation = FakeTranslation()

        async def _noop_async(segment):
            return None

        with patch("app.real_pipeline.upsert_segment_async", _noop_async):
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

        self.assertEqual(translation.sources, ["First line."])
        self.assertTrue(any(event == "segment.updated" and payload["id"] == "seg_001" for event, payload in events))
        self.assertFalse(any(event == "segment.corrected" for event, _ in events))

    async def test_translation_failure_emits_recoverable_error_and_placeholder(self) -> None:
        translation_queue: asyncio.Queue[RecognizedSegment] = asyncio.Queue()
        translation_queue.put_nowait(make_recognized("seg_001", "Broken line.", 0.0))

        events: list[tuple[str, dict]] = []

        async def broadcast(event_type: str, payload: dict) -> None:
            events.append((event_type, payload))

        translation = FakeTranslation(failures={"Broken line."})

        async def _noop_async(segment):
            return None

        with patch("app.real_pipeline.upsert_segment_async", _noop_async):
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

        updates = [payload for event, payload in events if event == "segment.updated"]
        errors = [payload for event, payload in events if event == "runtime.error"]
        self.assertEqual(updates[-1]["translatedText"], "[translation failed]")
        self.assertEqual(errors[-1]["code"], "TRANSLATION_FAILED")
        self.assertTrue(errors[-1]["recoverable"])

    async def test_continuation_remainder_stays_visible_as_current_tail(self) -> None:
        translation_queue: asyncio.Queue[RecognizedSegment] = asyncio.Queue()
        translation_queue.put_nowait(make_recognized("seg_001", "became so easy, the countries usually", 0.0))
        translation_queue.put_nowait(make_recognized("seg_002", "overrelied on one sector. Then exports fell", 1.0))

        events: list[tuple[str, dict]] = []

        async def broadcast(event_type: str, payload: dict) -> None:
            events.append((event_type, payload))

        translation = FakeTranslation()

        async def _noop_async(segment):
            return None

        with patch("app.real_pipeline.upsert_segment_async", _noop_async):
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

        seg2_updates = [
            payload for event, payload in events if event == "segment.updated" and payload["id"] == "seg_002"
        ]
        self.assertEqual(seg2_updates[-1]["sourceText"], "Then exports fell")
        self.assertIsNone(seg2_updates[-1].get("supersededBy"))
        self.assertIn("became so easy, the countries usually overrelied on one sector.", translation.sources)
        self.assertIn("Then exports fell", translation.sources)

    async def test_translation_reorders_asr_results_before_continuation_logic(self) -> None:
        translation_queue: asyncio.Queue[RecognizedSegment] = asyncio.Queue()
        translation_queue.put_nowait(make_recognized("seg_002", "Second line.", 1.0))
        translation_queue.put_nowait(make_recognized("seg_001", "First line.", 0.0))

        events: list[tuple[str, dict]] = []

        async def broadcast(event_type: str, payload: dict) -> None:
            events.append((event_type, payload))

        translation = FakeTranslation()

        async def _noop_async(segment):
            return None

        with patch("app.real_pipeline.upsert_segment_async", _noop_async):
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

        self.assertEqual(translation.sources[:2], ["First line.", "Second line."])


if __name__ == "__main__":
    unittest.main()
