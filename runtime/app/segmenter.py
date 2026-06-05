"""音频分段模块。

从 PCM 帧流中切分出适合 ASR 的音频片段。
策略：固定窗口 5 秒 + RMS 静音检测。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger("pipeline.segmenter")


@dataclass
class AudioSegment:
    pcm_data: bytes
    sample_rate: int
    channels: int
    start_time: float
    end_time: float


class AudioSegmenter:
    def __init__(
        self,
        sample_rate: int = 48000,
        channels: int = 2,
        max_duration: float = 5.0,
        min_duration: float = 1.5,
        silence_threshold: float = 1000.0,
        silence_duration: float = 0.5,
        min_energy_threshold: float = 800.0,
    ) -> None:
        self._sample_rate = sample_rate
        self._channels = channels
        self._max_duration = max_duration
        self._min_duration = min_duration
        self._silence_threshold = silence_threshold
        self._silence_duration = silence_duration
        self._min_energy_threshold = min_energy_threshold

        self._buffer = bytearray()
        self._start_time = 0.0
        self._current_time = 0.0
        self._last_silence_start: float | None = None

        # 每帧字节数（int16 * channels）
        self._bytes_per_sample = 2 * channels
        # 1024 帧对应的字节数
        self._frame_bytes = 1024 * self._bytes_per_sample

    def feed(self, frame: bytes) -> AudioSegment | None:
        """喂入一帧 PCM，返回 None 表示还在积累，返回 AudioSegment 表示切好一段。"""
        self._buffer.extend(frame)
        frame_duration = len(frame) / (self._sample_rate * self._bytes_per_sample)
        self._current_time += frame_duration

        buffer_duration = len(self._buffer) / (self._sample_rate * self._bytes_per_sample)

        # 检查当前帧是否静音
        is_silent = _is_silence(frame, self._silence_threshold)

        if is_silent:
            if self._last_silence_start is None:
                self._last_silence_start = self._current_time
        else:
            self._last_silence_start = None

        # 判断是否应该切段
        should_cut = False

        # 最大窗口到了
        if buffer_duration >= self._max_duration:
            should_cut = True

        # 连续静音足够长，且超过最小片段
        if (
            self._last_silence_start is not None
            and (self._current_time - self._last_silence_start) >= self._silence_duration
            and buffer_duration >= self._min_duration
        ):
            should_cut = True

        if should_cut and buffer_duration >= self._min_duration:
            pcm_data = bytes(self._buffer)
            rms = _segment_rms(pcm_data)

            # 丢弃低能量段（纯噪音/静音）
            if rms < self._min_energy_threshold:
                logger.debug(
                    "丢弃低能量段: %.2f-%.2f (%.1fs, RMS=%.0f)",
                    self._start_time,
                    self._current_time,
                    buffer_duration,
                    rms,
                )
                self._buffer = bytearray()
                self._start_time = self._current_time
                self._last_silence_start = None
                return None

            segment = AudioSegment(
                pcm_data=pcm_data,
                sample_rate=self._sample_rate,
                channels=self._channels,
                start_time=self._start_time,
                end_time=self._current_time,
            )
            logger.info(
                "切段: %.2f-%.2f (%.1fs, %d bytes, RMS=%.0f)",
                segment.start_time,
                segment.end_time,
                buffer_duration,
                len(segment.pcm_data),
                rms,
            )
            self._buffer = bytearray()
            self._start_time = self._current_time
            self._last_silence_start = None
            return segment

        return None

    def flush(self) -> AudioSegment | None:
        """会话结束时冲出剩余音频。"""
        buffer_duration = len(self._buffer) / (self._sample_rate * self._bytes_per_sample)
        if buffer_duration < self._min_duration:
            return None

        segment = AudioSegment(
            pcm_data=bytes(self._buffer),
            sample_rate=self._sample_rate,
            channels=self._channels,
            start_time=self._start_time,
            end_time=self._current_time,
        )
        self._buffer = bytearray()
        return segment


def _is_silence(pcm_bytes: bytes, threshold: float) -> bool:
    """判断 PCM 帧是否为静音（int16 格式）。"""
    if len(pcm_bytes) < 2:
        return True
    samples = np.frombuffer(pcm_bytes, dtype=np.int16)
    if len(samples) == 0:
        return True
    rms = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2)))
    return rms < threshold


def _segment_rms(pcm_bytes: bytes) -> float:
    """计算整段 PCM 的 RMS 能量。"""
    if len(pcm_bytes) < 2:
        return 0.0
    samples = np.frombuffer(pcm_bytes, dtype=np.int16)
    if len(samples) == 0:
        return 0.0
    return float(np.sqrt(np.mean(samples.astype(np.float32) ** 2)))
