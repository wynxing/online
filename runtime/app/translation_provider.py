"""OpenAI-compatible translation provider."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator, Callable, Awaitable
from dataclasses import dataclass

import httpx

from .models import GlossaryTerm

logger = logging.getLogger("pipeline.translation")
TRANSLATION_MAX_TOKENS = 256

SYSTEM_PROMPT = (
    "You are a professional simultaneous interpreter. Translate the following English speech "
    "subtitle into concise, natural spoken Chinese (简体中文).\n\n"
    "Rules:\n"
    "- Use natural spoken Chinese (口语化), not written/formal style\n"
    "- Keep translation concise — prefer shorter expressions, omit redundant subjects\n"
    "- Preserve technical terminology exactly as specified in the glossary\n"
    "- For partial or fragmented input, translate the fragment as-is without adding missing words\n"
    "- Never translate literally word-by-word; produce natural Chinese phrasing\n"
    "- Only output the translation, no explanations or notes"
)

_ROLE_PREFIX_RE = re.compile(r"^\s*(?:assistant|user|system|translation|answer)\s*[:：]\s*", re.IGNORECASE)
_THINK_BLOCK_RE = re.compile(r"(?is)<think>.*?</think>")
_FENCE_RE = re.compile(r"^\s*```(?:\w+)?\s*|\s*```\s*$")


@dataclass(frozen=True)
class TranslationContext:
    source_text: str
    translated_text: str


_CACHE_MAX_SIZE = 128


def _normalize_cache_key(text: str) -> str:
    """Normalize source text for cache key: lowercase, strip, collapse spaces."""
    import re as _re
    normalized = text.strip().lower()
    normalized = _re.sub(r"\s+", " ", normalized)
    return normalized


class RealTranslationProvider:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=12.0, write=5.0, pool=3.0),
            limits=httpx.Limits(
                max_connections=10,
                max_keepalive_connections=5,
                keepalive_expiry=30.0,
            ),
        )
        self._cache: dict[str, str] = {}
        self._cache_hits = 0

    async def aclose(self) -> None:
        await self._client.aclose()

    def _put_cache(self, key: str, value: str) -> None:
        """Store translation in cache, evicting oldest entry if at capacity."""
        if len(self._cache) >= _CACHE_MAX_SIZE:
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]
        self._cache[key] = value

    def _build_payload(
        self,
        source_text: str,
        source_lang: str,
        target_lang: str,
        glossary_terms: list[GlossaryTerm],
        context: list[TranslationContext] | None = None,
        stream: bool = False,
    ) -> dict:
        """Build the translation request payload."""
        context_items = context[-4:] if context else []

        # Token budget: estimate ~3 chars per token, cap at ~800 tokens total
        _TOKEN_BUDGET = 800 * 3  # chars
        total_chars = len(source_text)
        budget_items: list[TranslationContext] = []
        for item in reversed(context_items):
            item_chars = len(item.source_text) + len(item.translated_text)
            if total_chars + item_chars > _TOKEN_BUDGET:
                break
            budget_items.append(item)
            total_chars += item_chars
        context_items = list(reversed(budget_items))
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

        if stream:
            payload["stream"] = True

        return payload

    async def translate(
        self,
        source_text: str,
        source_lang: str,
        target_lang: str,
        glossary_terms: list[GlossaryTerm],
        context: list[TranslationContext] | None = None,
    ) -> str:
        """Translate one subtitle segment or continued sentence and return only that translation."""
        cache_key = _normalize_cache_key(source_text)
        if cache_key in self._cache:
            self._cache_hits += 1
            logger.info("Translation cache hit (%d total): %s", self._cache_hits, source_text[:60])
            return self._cache[cache_key]

        payload = self._build_payload(source_text, source_lang, target_lang, glossary_terms, context)
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
            matched = _matched_glossary_terms(source_text, context or [], glossary_terms)
            translated = _enforce_glossary(translated, matched)
            logger.info("Translation raw response: text=%s", translated[:160])
            self._put_cache(cache_key, translated)
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

    async def translate_streaming(
        self,
        source_text: str,
        source_lang: str,
        target_lang: str,
        glossary_terms: list[GlossaryTerm],
        context: list[TranslationContext] | None = None,
        on_token: Callable[[str], Awaitable[None]] | None = None,
    ) -> str:
        """Translate with streaming support, yielding tokens as they arrive.

        Args:
            source_text: Text to translate.
            source_lang: Source language code.
            target_lang: Target language code.
            glossary_terms: Glossary terms to apply.
            context: Previous translation context for continuity.
            on_token: Async callback called with each token as it arrives.

        Returns:
            The complete translated text.
        """
        cache_key = _normalize_cache_key(source_text)
        if cache_key in self._cache:
            self._cache_hits += 1
            logger.info("Translation cache hit (%d total): %s", self._cache_hits, source_text[:60])
            cached = self._cache[cache_key]
            if on_token:
                await on_token(cached)
            return cached

        payload = self._build_payload(source_text, source_lang, target_lang, glossary_terms, context, stream=True)
        url = f"{self._base_url}/chat/completions"

        accumulated = ""
        try:
            async with self._client.stream(
                "POST",
                url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        delta = data.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            accumulated += content
                            if on_token:
                                await on_token(content)
                    except json.JSONDecodeError:
                        continue

            translated = _clean_translation_text(accumulated)
            matched = _matched_glossary_terms(source_text, context or [], glossary_terms)
            translated = _enforce_glossary(translated, matched)
            logger.info("Translation streaming completed: text=%s", translated[:160])
            self._put_cache(cache_key, translated)
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
    return cleaned.strip(" \t\r\n\"'""''")


def _enforce_glossary(translated: str, glossary_terms: list[dict[str, str | None]]) -> str:
    """Post-process: force-replace glossary terms that appear untranslated in output."""
    result = translated
    for term in glossary_terms:
        source = term.get("source", "")
        target = term.get("target", "")
        if not source or not target:
            continue
        # If the English source term appears verbatim in the Chinese output, replace it
        if source.lower() in result.lower():
            pattern = re.compile(re.escape(source), re.IGNORECASE)
            result = pattern.sub(target, result, count=1)
    return result
