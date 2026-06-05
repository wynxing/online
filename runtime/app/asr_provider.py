"""ASR Providers。

支持两种格式：
- OpenAICompatibleASRProvider: Whisper 格式，/v1/audio/transcriptions
- ChatCompletionASRProvider: Chat Completions 格式，/v1/chat/completions + base64 音频
"""

from __future__ import annotations

import base64
import io
import logging
import wave

import httpx

logger = logging.getLogger("pipeline.asr")


class OpenAICompatibleASRProvider:
    def __init__(self, base_url: str, api_key: str, model: str, language: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._language = language

    async def transcribe(self, wav_bytes: bytes, prompt: str = "") -> str:
        """上传 WAV 音频，返回识别文本。空字符串表示无内容。"""
        url = f"{self._base_url}/audio/transcriptions"
        files = {"file": ("audio.wav", io.BytesIO(wav_bytes), "audio/wav")}
        data = {"model": self._model, "language": self._language}
        if prompt:
            data["prompt"] = prompt

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    url,
                    files=files,
                    data=data,
                    headers={"Authorization": f"Bearer {self._api_key}"},
                )
                response.raise_for_status()
                result = response.json()
                text = result.get("text", "").strip()
                if text:
                    logger.info("ASR 返回: text=%s", text[:80])
                else:
                    logger.debug("ASR 返回空文本")
                return text

        except httpx.HTTPStatusError as e:
            logger.warning("ASR HTTP 错误: %d %s", e.response.status_code, e.response.text[:200])
            raise
        except httpx.TimeoutException:
            logger.warning("ASR 请求超时")
            raise
        except Exception as e:
            logger.warning("ASR 请求异常: %s", e)
            raise


class ChatCompletionASRProvider:
    """Chat Completions 格式的 ASR Provider。

    用于小米 MiMo、智谱等使用 /v1/chat/completions + base64 音频的服务。
    """

    def __init__(self, base_url: str, api_key: str, model: str, language: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._language = language

    async def transcribe(self, wav_bytes: bytes, prompt: str = "") -> str:
        """上传 base64 编码的 WAV 音频，返回识别文本。"""
        url = f"{self._base_url}/chat/completions"
        audio_b64 = base64.b64encode(wav_bytes).decode("ascii")
        data_url = f"data:audio/wav;base64,{audio_b64}"

        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {"data": data_url},
                    }
                ],
            }
        ]

        payload: dict = {
            "model": self._model,
            "messages": messages,
            "asr_options": {"language": self._language},
        }
        if prompt:
            payload["messages"].insert(
                0,
                {"role": "system", "content": f"Previous context: {prompt}"},
            )

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
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
                    logger.info("ASR 返回: text=%s", text[:80])
                else:
                    logger.debug("ASR 返回空文本")
                return text

        except httpx.HTTPStatusError as e:
            logger.warning("ASR HTTP 错误: %d %s", e.response.status_code, e.response.text[:200])
            raise
        except httpx.TimeoutException:
            logger.warning("ASR 请求超时")
            raise
        except Exception as e:
            logger.warning("ASR 请求异常: %s", e)
            raise


def pcm_to_wav(pcm_data: bytes, channels: int = 2, sample_rate: int = 48000, sample_width: int = 2) -> bytes:
    """将 PCM 数据转换为 WAV 格式（内存中）。"""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)
    return buf.getvalue()
