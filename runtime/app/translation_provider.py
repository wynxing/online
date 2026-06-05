"""OpenAI-compatible Translation Provider。

调用 /v1/chat/completions 接口进行翻译。
"""

from __future__ import annotations

import logging

import httpx

from .models import GlossaryTerm

logger = logging.getLogger("pipeline.translation")

SYSTEM_PROMPT = (
    "Translate speech subtitles into concise natural Chinese. "
    "Preserve technical meaning and apply the glossary exactly. "
    "Only output the translated text, nothing else."
)


class RealTranslationProvider:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model

    async def translate(
        self,
        source_text: str,
        source_lang: str,
        target_lang: str,
        glossary_terms: list[GlossaryTerm],
    ) -> str:
        """翻译文本，返回译文。"""
        glossary = [
            {"source": term.source, "target": term.target, "domain": term.domain}
            for term in glossary_terms
            if term.enabled
        ]

        system_content = SYSTEM_PROMPT
        if glossary:
            import json
            glossary_str = json.dumps(glossary, ensure_ascii=False)
            system_content += f"\n\nGlossary (apply these translations exactly):\n{glossary_str}"

        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_content},
                {
                    "role": "user",
                    "content": f"Translate from {source_lang} to {target_lang}:\n\n{source_text}",
                },
            ],
            "temperature": 0.2,
        }

        url = f"{self._base_url}/chat/completions"

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
                translated = result["choices"][0]["message"]["content"].strip()
                logger.info("翻译返回: %s", translated[:80])
                return translated

        except httpx.HTTPStatusError as e:
            logger.warning("翻译 HTTP 错误: %d %s", e.response.status_code, e.response.text[:200])
            raise
        except httpx.TimeoutException:
            logger.warning("翻译请求超时")
            raise
        except Exception as e:
            logger.warning("翻译请求异常: %s", e)
            raise
