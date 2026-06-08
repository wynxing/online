"""ASR providers for Whisper-style and chat-completions-style APIs."""

from __future__ import annotations

import base64
import io
import logging
import struct

import httpx
import numpy as np

logger = logging.getLogger("pipeline.asr")

# Cache for resampling kernels to avoid recomputing on every call
_RESAMPLE_KERNELS: dict[tuple[int, int], tuple[np.ndarray, int]] = {}


def _get_resample_kernel(sample_rate: int, target_rate: int) -> tuple[np.ndarray, int]:
    """Get or create a cached resampling kernel for the given sample rate pair."""
    key = (sample_rate, target_rate)
    if key not in _RESAMPLE_KERNELS:
        ratio = sample_rate // target_rate
        kernel_size = ratio
        kernel = np.ones(kernel_size, dtype=np.float64) / kernel_size
        _RESAMPLE_KERNELS[key] = (kernel, ratio)
    return _RESAMPLE_KERNELS[key]


def stereo_to_mono(pcm_bytes: bytes) -> bytes:
    """Convert stereo 16-bit PCM to mono by averaging L/R channels."""
    samples = np.frombuffer(pcm_bytes, dtype=np.int16)
    if len(samples) < 2:
        return pcm_bytes
    stereo = samples.reshape(-1, 2)
    mono = ((stereo[:, 0].astype(np.int32) + stereo[:, 1].astype(np.int32)) // 2).astype(np.int16)
    return mono.tobytes()


def prepare_for_asr(
    pcm_data: bytes,
    channels: int,
    sample_rate: int,
    target_rate: int = 16000,
) -> tuple[bytes, int, int]:
    """Convert PCM audio to mono and downsample for ASR.

    Performs stereo-to-mono conversion (average L/R) and sample rate
    reduction via decimation with a simple moving-average low-pass filter.

    Args:
        pcm_data: Raw 16-bit signed PCM bytes.
        channels: Number of channels in the input audio.
        sample_rate: Input sample rate in Hz.
        target_rate: Target sample rate in Hz. 0 = no resampling (default 16000).

    Returns:
        (pcm_bytes, channels, sample_rate) — converted audio and its metadata.
    """
    if target_rate <= 0:
        # Resampling disabled — still do stereo→mono
        if channels == 2 and len(pcm_data) >= 4:
            return stereo_to_mono(pcm_data), 1, sample_rate
        return pcm_data, channels, sample_rate

    if sample_rate == target_rate and channels == 1:
        return pcm_data, channels, sample_rate

    samples = np.frombuffer(pcm_data, dtype=np.int16)

    # Stereo → mono: average L/R pairs
    if channels == 2 and len(samples) >= 2:
        stereo = samples.reshape(-1, 2)
        samples = ((stereo[:, 0].astype(np.int32) + stereo[:, 1].astype(np.int32)) // 2).astype(np.int16)
        channels = 1

    # Downsample if needed
    if sample_rate != target_rate and len(samples) > 0:
        ratio = sample_rate // target_rate
        if ratio > 1 and len(samples) >= ratio:
            # Block-average decimation: reshape into blocks and average
            # Equivalent to moving-average low-pass + decimation, but faster
            trim_len = (len(samples) // ratio) * ratio
            blocks = samples[:trim_len].reshape(-1, ratio)
            samples = blocks.mean(axis=1).astype(np.int16)
            sample_rate = target_rate

    return samples.tobytes(), channels, sample_rate




CHAT_ASR_SYSTEM_PROMPT = (
    "You are a speech-to-text engine. Transcribe the input audio in the requested source language. "
    "Return only the transcript text. Do not translate. Do not explain. Do not include reasoning, "
    "XML/HTML tags, markdown, role labels, timestamps, or previous-context text. "
    "If the audio has no intelligible speech, return an empty string."
)


class OpenAICompatibleASRProvider:
    def __init__(self, base_url: str, api_key: str, model: str, language: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._language = language
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=3.0),
            limits=httpx.Limits(
                max_connections=8,
                max_keepalive_connections=4,
                keepalive_expiry=30.0,
            ),
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def transcribe(self, wav_bytes: bytes, prompt: str = "") -> str:
        """Upload WAV audio and return transcript text."""
        url = f"{self._base_url}/audio/transcriptions"
        files = {"file": ("audio.wav", io.BytesIO(wav_bytes), "audio/wav")}
        data = {"model": self._model, "language": self._language}
        if prompt:
            data["prompt"] = prompt

        try:
            response = await self._client.post(
                url,
                files=files,
                data=data,
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
            response.raise_for_status()
            result = response.json()
            text = result.get("text", "").strip()
            if text:
                logger.info("ASR raw response: text=%s", text[:160])
            else:
                logger.debug("ASR returned empty text")
            return text

        except httpx.HTTPStatusError as e:
            logger.warning("ASR HTTP error: %d %s", e.response.status_code, e.response.text[:200])
            raise
        except httpx.TimeoutException:
            logger.warning("ASR request timed out")
            raise
        except Exception as e:
            logger.warning("ASR request failed: %s", e)
            raise


class ChatCompletionASRProvider:
    """ASR provider for chat-completions APIs that accept base64 audio."""

    def __init__(self, base_url: str, api_key: str, model: str, language: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._language = language
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=3.0),
            limits=httpx.Limits(
                max_connections=8,
                max_keepalive_connections=4,
                keepalive_expiry=30.0,
            ),
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def transcribe(self, wav_bytes: bytes, prompt: str = "") -> str:
        """Upload base64-encoded WAV audio and return transcript text."""
        url = f"{self._base_url}/chat/completions"
        audio_b64 = base64.b64encode(wav_bytes).decode("ascii")
        data_url = f"data:audio/wav;base64,{audio_b64}"

        messages = [
            {"role": "system", "content": CHAT_ASR_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {"data": data_url},
                    }
                ],
            },
        ]

        payload: dict = {
            "model": self._model,
            "messages": messages,
            "asr_options": {"language": self._language},
        }

        try:
            response = await self._client.post(
                url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
            result = response.json()
            text = result["choices"][0]["message"]["content"].strip()
            if text:
                logger.info("ASR raw response: text=%s", text[:160])
            else:
                logger.debug("ASR returned empty text")
            return text

        except httpx.HTTPStatusError as e:
            logger.warning("ASR HTTP error: %d %s", e.response.status_code, e.response.text[:200])
            raise
        except httpx.TimeoutException:
            logger.warning("ASR request timed out")
            raise
        except Exception as e:
            logger.warning("ASR request failed: %s", e)
            raise


def pcm_to_wav(pcm_data: bytes, channels: int = 2, sample_rate: int = 48000, sample_width: int = 2) -> bytes:
    """Convert PCM bytes to an in-memory WAV file.

    Uses struct.pack for faster header construction compared to the wave module.
    """
    data_size = len(pcm_data)
    byte_rate = sample_rate * channels * sample_width
    block_align = channels * sample_width

    # RIFF header (12 bytes)
    header = struct.pack('<4sI4s', b'RIFF', 36 + data_size, b'WAVE')
    # fmt chunk (24 bytes)
    fmt = struct.pack('<4sIHHIIHH', b'fmt ', 16, 1, channels, sample_rate, byte_rate, block_align, sample_width * 8)
    # data chunk header (8 bytes)
    data_header = struct.pack('<4sI', b'data', data_size)

    return header + fmt + data_header + pcm_data
