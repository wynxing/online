"""Cross-platform audio capture."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading

from .audio_backends import AudioDeviceInfo, open_audio_stream

logger = logging.getLogger("pipeline.audio")


class AudioCapture:
    """Read PCM frames on a worker thread and enqueue them on the event loop."""

    def __init__(self, device: AudioDeviceInfo, sample_rate: int = 48000, channels: int = 2) -> None:
        self._device = device
        self._sample_rate = sample_rate
        self._channels = channels
        self._stream = None
        self._running = False
        self._thread: threading.Thread | None = None
        self._queue: asyncio.Queue[bytes] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._dropped_frames = 0

    def start(self, frame_queue: asyncio.Queue[bytes]) -> None:
        self._queue = frame_queue
        self._loop = asyncio.get_running_loop()
        self._running = True
        self._dropped_frames = 0
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        logger.info(
            "Audio capture started: device=%s, rate=%d, channels=%d",
            self._device.id,
            self._sample_rate,
            self._channels,
        )

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None
        logger.info("Audio capture stopped, droppedFrames=%d", self._dropped_frames)

    @property
    def is_running(self) -> bool:
        return self._running

    def _run(self) -> None:
        stream = None
        try:
            stream = open_audio_stream(self._device, blocksize=1024)
            self._stream = stream

            warmup_frames = int(self._sample_rate / 1024 * 0.5)
            for _ in range(warmup_frames):
                stream.read(1024)
            logger.info("Audio warmup completed, discardedFrames=%d", warmup_frames)

            while self._running:
                try:
                    data = stream.read(1024)
                    if self._loop and self._running:
                        self._loop.call_soon_threadsafe(self._enqueue_frame, data)
                except Exception as e:
                    if self._running:
                        logger.warning("Audio read failed: %s", e)
                    break

        except Exception as e:
            logger.error("Audio capture thread failed: %s", e)
            self._running = False
        finally:
            if stream:
                with contextlib.suppress(Exception):
                    stream.close()

    def _enqueue_frame(self, data: bytes) -> None:
        if not self._queue or not self._running:
            return
        try:
            self._queue.put_nowait(data)
        except asyncio.QueueFull:
            self._dropped_frames += 1
