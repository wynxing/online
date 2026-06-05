"""WASAPI loopback 音频采集模块。

在独立线程中运行 PyAudio 阻塞读取，将 PCM 帧推入 asyncio.Queue。
"""

from __future__ import annotations

import asyncio
import logging
import threading

logger = logging.getLogger("pipeline.audio")


class AudioCapture:
    """WASAPI loopback 音频采集器，运行在独立线程中。"""

    def __init__(self, device_index: int, sample_rate: int = 48000, channels: int = 2) -> None:
        self._device_index = device_index
        self._sample_rate = sample_rate
        self._channels = channels
        self._stream = None
        self._pa = None
        self._running = False
        self._thread: threading.Thread | None = None
        self._queue: asyncio.Queue[bytes] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def start(self, frame_queue: asyncio.Queue[bytes]) -> None:
        """启动采集线程。"""
        self._queue = frame_queue
        self._loop = asyncio.get_running_loop()
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        logger.info(
            "音频采集启动: device=%d, rate=%d, channels=%d",
            self._device_index,
            self._sample_rate,
            self._channels,
        )

    def stop(self) -> None:
        """停止采集，释放音频资源。"""
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None
        logger.info("音频采集停止")

    @property
    def is_running(self) -> bool:
        return self._running

    def _run(self) -> None:
        """在独立线程中运行 PyAudio 阻塞读取。"""
        import pyaudiowpatch as pyaudio

        pa = None
        stream = None
        try:
            pa = pyaudio.PyAudio()
            stream = pa.open(
                format=pyaudio.paInt16,
                channels=self._channels,
                rate=self._sample_rate,
                input=True,
                input_device_index=self._device_index,
                frames_per_buffer=1024,
            )
            self._pa = pa
            self._stream = stream

            # 丢弃前 0.5 秒的帧（warmup，避免初始垃圾数据）
            warmup_frames = int(self._sample_rate / 1024 * 0.5)
            for _ in range(warmup_frames):
                stream.read(1024, exception_on_overflow=False)
            logger.info("音频 warmup 完成，丢弃 %d 帧", warmup_frames)

            while self._running:
                try:
                    data = stream.read(1024, exception_on_overflow=False)
                    if self._queue and self._loop and self._running:
                        try:
                            self._loop.call_soon_threadsafe(self._queue.put_nowait, data)
                        except (asyncio.QueueFull, RuntimeError):
                            pass
                except Exception as e:
                    if self._running:
                        logger.warning("音频读取异常: %s", e)
                    break

        except Exception as e:
            logger.error("音频采集线程异常: %s", e)
            self._running = False
        finally:
            if stream:
                try:
                    stream.stop_stream()
                    stream.close()
                except Exception:
                    pass
            if pa:
                try:
                    pa.terminate()
                except Exception:
                    pass
