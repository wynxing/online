"""OpenAI-compatible translation provider."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

import httpx

from .models import GlossaryTerm

logger = logging.getLogger("pipeline.translation")
TRANSLATION_MAX_TOKENS = 256

SYSTEM_PROMPT = (
    "Translate the current speech subtitle or continued sentence into concise natural Chinese. "
    "Preserve technical meaning and apply the glossary exactly. "
    "Use prior context only to resolve continuity, pronouns, and terminology. "
    "If the input combines an unfinished previous subtitle with the current subtitle, translate only that combined sentence. "
    "Only output the translation for the provided subtitle text, nothing else."
)

_ROLE_PREFIX_RE = re.compile(r"^\s*(?:assistant|user|system|translation|answer)\s*[:：]\s*", re.IGNORECASE)
_THINK_BLOCK_RE = re.compile(r"(?is)<think>.*?</think>")
_FENCE_RE = re.compile(r"^\s*```(?:\w+)?\s*|\s*```\s*$")


@dataclass(frozen=True)
class TranslationContext:
    source_text: str
    translated_text: str


class RealTranslationProvider:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._client = httpx.AsyncClient(timeout=15.0)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def translate(
        self,
        source_text: str,
        source_lang: str,
        target_lang: str,
        glossary_terms: list[GlossaryTerm],
        context: list[TranslationContext] | None = None,
    ) -> str:
        """Translate one subtitle segment or continued sentence and return only that translation."""
        context_items = context[-2:] if context else []
        glossary = _matched_glossary_terms(source_text, context_items, glossary_terms)

        system_content = SYSTEM_PROMPT
        if glossary:
            glossary_str = json.dumps(glossary, ensure_ascii=False)
            system_content += f"\n\nGlossary (apply these translations exactly):\n{glossary_str}"

        user_parts: list[str] = []
        if context:
            context_payload = [
                {"source": item.source_text, "translation": item.translated_text}
                for item in context_items
            ]
            user_parts.append(
                "Recent confirmed context. Do not retranslate these lines:\n"
                f"{json.dumps(context_payload, ensure_ascii=False)}"
            )
        user_parts.append(f"Translate from {source_lang} to {target_lang}:\n\n{source_text}")

        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_content},
                {"role": "user", "content": "\n\n".join(user_parts)},
            ],
            "temperature": 0,
            "max_tokens": TRANSLATION_MAX_TOKENS,
        }

        url = f"{self._base_url}/chat/completions"

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
            message = result["choices"][0]["message"]
            content = message.get("content")
            if not content:
                logger.warning("Translation API returned empty content: %s", json.dumps(result, ensure_ascii=False)[:500])
                raise RuntimeError("Translation API returned empty response")
            translated = _clean_translation_text(content)
            logger.info("Translation raw response: text=%s", translated[:160])
            return translated

        except httpx.HTTPStatusError as e:
            logger.warning("Translation HTTP error: %d %s", e.response.status_code, e.response.text[:200])
            raise
        except httpx.TimeoutException:
            logger.warning("Translation request timed out")
            raise
        except Exception as e:
            logger.warning("Translation request failed: %s", e)
            raise


def _matched_glossary_terms(
    source_text: str,
    context: list[TranslationContext],
    glossary_terms: list[GlossaryTerm],
) -> list[dict[str, str | None]]:
    haystack = " ".join([source_text, *(item.source_text for item in context)]).lower()
    return [
        {"source": term.source, "target": term.target, "domain": term.domain}
        for term in glossary_terms
        if term.enabled and term.source.strip() and term.source.lower() in haystack
    ]


def _clean_translation_text(text: str) -> str:
    cleaned = _THINK_BLOCK_RE.sub(" ", text)
    cleaned = _FENCE_RE.sub("", cleaned)
    for _ in range(3):
        stripped = _ROLE_PREFIX_RE.sub("", cleaned)
        if stripped == cleaned:
            break
        cleaned = stripped
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(" \t\r\n\"'“”‘’")
