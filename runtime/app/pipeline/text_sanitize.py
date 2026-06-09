"""ASR output text sanitization: remove noise, hallucinations, and protocol artifacts."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .constants import (
    _CJK_RE,
    _LATIN_RE,
    _LEADING_LOWER_THINK_WORD_RE,
    _LEADING_THINK_RE,
    _NUMERIC_NOISE_RE,
    _PROMPT_ECHO_RE,
    _ROLE_PREFIX_RE,
    _SHORT_MARKER_RE,
    _TAG_RE,
    _THINK_BLOCK_RE,
    WHISPER_HALLUCINATIONS,
)


@dataclass(frozen=True)
class SanitizedASRText:
    text: str
    reject_reason: str | None = None


def sanitize_asr_text(raw_text: str, source_lang: str = "en") -> "SanitizedASRText":
    """Clean ASR output: strip protocol noise, reject hallucinations and garbage."""
    text = raw_text.strip()
    if not text:
        return SanitizedASRText(text="", reject_reason="empty")

    if _PROMPT_ECHO_RE.match(text):
        return SanitizedASRText(text="", reject_reason="prompt_echo")

    text = _THINK_BLOCK_RE.sub(" ", text)
    text = text.replace("```", " ")
    text = _TAG_RE.sub(" ", text)
    text = _LEADING_THINK_RE.sub("", text)
    text = _LEADING_LOWER_THINK_WORD_RE.sub("", text)

    for _ in range(3):
        stripped = _ROLE_PREFIX_RE.sub("", text)
        if stripped == text:
            break
        text = stripped

    text = re.sub(r"\s+", " ", text).strip(" \t\r\n\"'")
    if not text:
        return SanitizedASRText(text="", reject_reason="empty_after_cleanup")

    if _PROMPT_ECHO_RE.match(text):
        return SanitizedASRText(text="", reject_reason="prompt_echo")

    if _NUMERIC_NOISE_RE.match(text) or _SHORT_MARKER_RE.match(text) or not any(ch.isalpha() for ch in text):
        return SanitizedASRText(text="", reject_reason="numeric_or_symbol_noise")

    # Whisper hallucination detection
    text_lower = text.lower().strip(".,!?;:")
    if text_lower in WHISPER_HALLUCINATIONS:
        return SanitizedASRText(text="", reject_reason="whisper_hallucination")

    latin_count = len(_LATIN_RE.findall(text))
    cjk_count = len(_CJK_RE.findall(text))
    if source_lang.lower().startswith("en") and cjk_count > 0 and latin_count == 0:
        return SanitizedASRText(text="", reject_reason="target_language_output")

    return SanitizedASRText(text=text)
