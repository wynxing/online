"""Audio segmentation for PCM capture streams."""

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


@dataclass
class SegmenterStats:
    frames_seen: int = 0
    bytes_seen: int = 0
    segments_emitted: int = 0
    low_energy_drops: int = 0
    last_frame_rms: float = 0.0
    max_frame_rms: float = 0.0
    last_segment_rms: float = 0.0
    max_segment_rms: float = 0.0


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
        self._bytes_per_sample = 2 * channels
        self.stats = SegmenterStats()

    def feed(self, frame: bytes) -> AudioSegment | None:
        """Append one PCM frame and return a completed segment when ready."""
        self._buffer.extend(frame)
        frame_rms = _rms(frame)
        self.stats.frames_seen += 1
        self.stats.bytes_seen += len(frame)
        self.stats.last_frame_rms = frame_rms
        self.stats.max_frame_rms = max(self.stats.max_frame_rms, frame_rms)

        frame_duration = len(frame) / (self._sample_rate * self._bytes_per_sample)
        self._current_time += frame_duration
        buffer_duration = len(self._buffer) / (self._sample_rate * self._bytes_per_sample)

        if frame_rms < self._silence_threshold:
            if self._last_silence_start is None:
                self._last_silence_start = self._current_time
        else:
            self._last_silence_start = None

        should_cut = buffer_duration >= self._max_duration
        if (
            self._last_silence_start is not None
            and (self._current_time - self._last_silence_start) >= self._silence_duration
            and buffer_duration >= self._min_duration
        ):
            should_cut = True

        if not should_cut or buffer_duration < self._min_duration:
            return None

        return self._cut_buffer(buffer_duration)

    def flush(self) -> AudioSegment | None:
        """Return the remaining buffered audio at session end when it is usable."""
        buffer_duration = len(self._buffer) / (self._sample_rate * self._bytes_per_sample)
        if buffer_duration < self._min_duration:
            return None
        return self._cut_buffer(buffer_duration)

    def _cut_buffer(self, buffer_duration: float) -> AudioSegment | None:
        pcm_data = bytes(self._buffer)
        rms = _rms(pcm_data)
        self.stats.last_segment_rms = rms
        self.stats.max_segment_rms = max(self.stats.max_segment_rms, rms)

        if rms < self._min_energy_threshold:
            self.stats.low_energy_drops += 1
            logger.info(
                "Drop low-energy segment: %.2f-%.2f (%.1fs, RMS=%.0f, threshold=%.0f)",
                self._start_time,
                self._current_time,
                buffer_duration,
                rms,
                self._min_energy_threshold,
            )
            self._reset_buffer()
            return None

        segment = AudioSegment(
            pcm_data=pcm_data,
            sample_rate=self._sample_rate,
            channels=self._channels,
            start_time=self._start_time,
            end_time=self._current_time,
        )
        self.stats.segments_emitted += 1
        logger.info(
            "Cut audio segment: %.2f-%.2f (%.1fs, %d bytes, RMS=%.0f)",
            segment.start_time,
            segment.end_time,
            buffer_duration,
            len(segment.pcm_data),
            rms,
        )
        self._reset_buffer()
        return segment

    def _reset_buffer(self) -> None:
        self._buffer.clear()  # Reuse existing buffer allocation
        self._start_time = self._current_time
        self._last_silence_start = None


def _rms(pcm_bytes: bytes) -> float:
    """Compute Root Mean Square of 16-bit PCM audio.

    Uses integer arithmetic to avoid intermediate float32 allocations.
    """
    if len(pcm_bytes) < 2:
        return 0.0
    samples = np.frombuffer(pcm_bytes, dtype=np.int16)
    if len(samples) == 0:
        return 0.0
    # Use int64 accumulation to avoid overflow and reduce allocations
    sum_sq = np.sum(samples.astype(np.int64) ** 2)
    return float(np.sqrt(sum_sq / len(samples)))
