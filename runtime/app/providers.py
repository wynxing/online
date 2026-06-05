from __future__ import annotations

from dataclasses import dataclass

from .models import GlossaryTerm, RuntimeConfig


@dataclass(slots=True)
class TranslationRequest:
    source_text: str
    source_lang: str
    target_lang: str
    glossary_terms: list[GlossaryTerm]


class OpenAICompatibleTranslationProvider:
    """Provider boundary for future real translation calls.

    The first demo uses deterministic mock translations, but this class keeps the
    request shape aligned with OpenAI-compatible Chat Completions services.
    """

    def __init__(self, config: RuntimeConfig) -> None:
        self.config = config

    def build_chat_completions_payload(self, request: TranslationRequest) -> dict:
        glossary = [
            {"source": term.source, "target": term.target, "domain": term.domain}
            for term in request.glossary_terms
            if term.enabled
        ]
        return {
            "model": self.config.translationModel,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Translate speech subtitles into concise natural Chinese. "
                        "Preserve technical meaning and apply the glossary exactly."
                    ),
                },
                {
                    "role": "user",
                    "content": {
                        "sourceLang": request.source_lang,
                        "targetLang": request.target_lang,
                        "glossary": glossary,
                        "text": request.source_text,
                    },
                },
            ],
            "temperature": 0.2,
        }
