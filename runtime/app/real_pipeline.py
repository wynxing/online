"""真实同传 Pipeline。

采集 → 分段 → ASR → 翻译 → WebSocket 推送。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Awaitable, Callable
from uuid import uuid4

from .asr_provider import ChatCompletionASRProvider, OpenAICompatibleASRProvider, pcm_to_wav
from .audio_capture import AudioCapture
from .models import GlossaryTerm, RuntimeErrorPayload, RuntimeConfig, SubtitleSegment, SubtitleStatus
from .segmenter import AudioSegment, AudioSegmenter
from .storage import upsert_segment
from .translation_provider import RealTranslationProvider

logger = logging.getLogger("pipeline.real")

Broadcast = Callable[[str, dict], Awaitable[None]]
ShouldStop = Callable[[], bool]


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
    """真实同传 pipeline：采集 → 分段 → ASR → 翻译 → 推送。"""

    await broadcast(
        "session.status",
        {"sessionId": session_id, "status": "running", "updatedAt": now_iso()},
    )

    # 解析设备 index
    device_index = _parse_device_index(device_id)
    if device_index is None:
        await broadcast("runtime.error", RuntimeErrorPayload(
            code="AUDIO_DEVICE_INVALID",
            message=f"无法解析音频设备 ID: {device_id}",
            recoverable=False,
        ).model_dump())
        await broadcast(
            "session.status",
            {"sessionId": session_id, "status": "stopped", "updatedAt": now_iso()},
        )
        return

    # 获取设备信息（采样率、声道数）
    sample_rate, channels = _get_device_params(device_index)
    logger.info("使用设备: index=%d, rate=%d, channels=%d", device_index, sample_rate, channels)

    # 创建模块实例
    capture = AudioCapture(device_index, sample_rate, channels)
    segmenter = AudioSegmenter(sample_rate=sample_rate, channels=channels)

    asr_url = get_asr_base_url(config)
    asr_key = get_asr_api_key(config)

    if config.asrFormat == "chat-completions":
        asr = ChatCompletionASRProvider(
            base_url=asr_url,
            api_key=asr_key,
            model=config.asrModel,
            language=config.asrLanguage,
        )
    else:
        asr = OpenAICompatibleASRProvider(
            base_url=asr_url,
            api_key=asr_key,
            model=config.asrModel,
            language=config.asrLanguage,
        )

    translation = RealTranslationProvider(
        base_url=config.baseUrl,
        api_key=config.apiKey,
        model=config.translationModel,
    )

    # 队列
    frame_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)
    segment_queue: asyncio.Queue[AudioSegment] = asyncio.Queue(maxsize=30)

    # 启动采集
    try:
        capture.start(frame_queue)
    except Exception as e:
        await broadcast("runtime.error", RuntimeErrorPayload(
            code="AUDIO_DEVICE_UNAVAILABLE",
            message=f"无法打开音频设备: {e}",
            recoverable=False,
        ).model_dump())
        await broadcast(
            "session.status",
            {"sessionId": session_id, "status": "stopped", "updatedAt": now_iso()},
        )
        return

    # 启动分段和翻译任务
    segmenter_task = asyncio.create_task(
        _run_segmenter(frame_queue, segment_queue, segmenter, should_stop)
    )
    processor_task = asyncio.create_task(
        _run_processor(session_id, segment_queue, asr, translation, glossary_terms, broadcast, should_stop)
    )

    # 等待停止信号
    try:
        while not should_stop():
            await asyncio.sleep(0.2)
    except asyncio.CancelledError:
        pass

    # 停止采集
    capture.stop()

    # 冲出剩余音频
    remaining = segmenter.flush()
    if remaining:
        try:
            segment_queue.put_nowait(remaining)
        except asyncio.QueueFull:
            pass

    # 等待处理完成
    try:
        await asyncio.wait_for(segmenter_task, timeout=5)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        segmenter_task.cancel()

    try:
        await asyncio.wait_for(processor_task, timeout=10)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        processor_task.cancel()

    await broadcast(
        "session.status",
        {"sessionId": session_id, "status": "stopped", "updatedAt": now_iso()},
    )


async def _run_segmenter(
    frame_queue: asyncio.Queue[bytes],
    segment_queue: asyncio.Queue[AudioSegment],
    segmenter: AudioSegmenter,
    should_stop: ShouldStop,
) -> None:
    """从帧队列取帧，切段后推入段队列。"""
    try:
        while not should_stop():
            try:
                frame = await asyncio.wait_for(frame_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            segment = segmenter.feed(frame)
            if segment:
                # 队列满时丢弃最旧的段，保持实时性
                if segment_queue.full():
                    try:
                        dropped = segment_queue.get_nowait()
                        logger.warning("队列满，丢弃旧段: %.2f-%.2f", dropped.start_time, dropped.end_time)
                    except asyncio.QueueEmpty:
                        pass
                try:
                    segment_queue.put_nowait(segment)
                except asyncio.QueueFull:
                    logger.warning("段队列已满，丢弃段: %.2f-%.2f", segment.start_time, segment.end_time)
    except asyncio.CancelledError:
        pass


async def _run_processor(
    session_id: str,
    segment_queue: asyncio.Queue[AudioSegment],
    asr: OpenAICompatibleASRProvider,
    translation: RealTranslationProvider,
    glossary_terms: list[GlossaryTerm],
    broadcast: Broadcast,
    should_stop: ShouldStop,
) -> None:
    """从段队列取段，调 ASR 和翻译，推送事件。"""
    segment_counter = 0
    last_source_text = ""  # 用于 ASR prompt 上下文

    try:
        while not should_stop():
            try:
                segment = await asyncio.wait_for(segment_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            segment_counter += 1
            segment_id = f"seg_{segment_counter:03d}"

            # PCM → WAV
            wav_bytes = pcm_to_wav(
                segment.pcm_data,
                channels=segment.channels,
                sample_rate=segment.sample_rate,
            )

            # ASR
            try:
                source_text = await asr.transcribe(wav_bytes, prompt=last_source_text)
            except Exception as e:
                logger.warning("ASR 失败: segment=%s, error=%s", segment_id, e)
                await broadcast("runtime.error", RuntimeErrorPayload(
                    code="ASR_FAILED",
                    message=f"ASR 请求失败: {e}",
                    recoverable=True,
                ).model_dump())
                continue

            if not source_text:
                logger.debug("ASR 返回空文本，跳过: segment=%s", segment_id)
                continue

            last_source_text = source_text

            # 推送 interim
            interim = SubtitleSegment(
                id=segment_id,
                sessionId=session_id,
                sourceText=source_text,
                translatedText="正在生成译文...",
                status=SubtitleStatus.interim,
                version=1,
                startTime=segment.start_time,
                endTime=segment.end_time,
                updatedAt=now_iso(),
            )
            await broadcast("segment.created", interim.model_dump(mode="json"))

            # 翻译
            try:
                translated_text = await translation.translate(
                    source_text=source_text,
                    source_lang="en",
                    target_lang="zh-CN",
                    glossary_terms=glossary_terms,
                )
            except Exception as e:
                logger.warning("翻译失败: segment=%s, error=%s", segment_id, e)
                await broadcast("runtime.error", RuntimeErrorPayload(
                    code="TRANSLATION_FAILED",
                    message=f"翻译请求失败: {e}",
                    recoverable=True,
                ).model_dump())
                # 翻译失败时保留原文，标记为 final
                translated_text = "[翻译失败]"

            # 推送 final
            final = SubtitleSegment(
                id=segment_id,
                sessionId=session_id,
                sourceText=source_text,
                translatedText=translated_text,
                status=SubtitleStatus.final,
                version=2,
                startTime=segment.start_time,
                endTime=segment.end_time,
                updatedAt=now_iso(),
            )
            upsert_segment(final)
            await broadcast("segment.updated", final.model_dump(mode="json"))

    except asyncio.CancelledError:
        pass


def _parse_device_index(device_id: str) -> int | None:
    """从设备 ID 中提取 PyAudio 设备 index。"""
    # 格式: "wasapi_loopback_17" 或 "mic_15"
    parts = device_id.split("_")
    try:
        return int(parts[-1])
    except (ValueError, IndexError):
        return None


def _get_device_params(device_index: int) -> tuple[int, int]:
    """获取设备的采样率和声道数。"""
    import pyaudiowpatch as pyaudio

    pa = pyaudio.PyAudio()
    try:
        info = pa.get_device_info_by_index(device_index)
        return int(info["defaultSampleRate"]), int(info["maxInputChannels"])
    finally:
        pa.terminate()
