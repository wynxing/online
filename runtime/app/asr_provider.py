"""ASR providers for Whisper-style and chat-completions-style APIs."""

from __future__ import annotations

import base64
import io
import logging
import wave

import httpx

logger = logging.getLogger("pipeline.asr")

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
        self._client = httpx.AsyncClient(timeout=15.0)

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
        self._client = httpx.AsyncClient(timeout=15.0)

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
    """Convert PCM bytes to an in-memory WAV file."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)
    return buf.getvalue()
