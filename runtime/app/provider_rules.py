"""Provider-specific URL validation rules.

Defines configurable rules for validating ASR/translation provider URLs.
New providers can be supported by adding entries to PROVIDER_URL_RULES.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderUrlRule:
    """A single URL validation rule for a provider."""

    url_pattern: str
    """Domain fragment to match, e.g. 'api.xiaomimimo.com'."""

    required_suffix: str
    """Required URL suffix, e.g. '/v1'."""

    error_message: str
    """Error message shown when validation fails."""

    format_required: str
    """ASR format this rule applies to, e.g. 'chat-completions'."""


# Provider URL validation rules table.
# To support a new provider, add a single entry here.
PROVIDER_URL_RULES: list[ProviderUrlRule] = [
    ProviderUrlRule(
        url_pattern="api.xiaomimimo.com",
        required_suffix="/v1",
        error_message="MiMo ASR Base URL 需要以 /v1 结尾，例如 https://api.xiaomimimo.com/v1。",
        format_required="chat-completions",
    ),
]


def validate_asr_url(asr_url: str, asr_format: str) -> list[str]:
    """Validate ASR URL against all provider rules.

    Returns a list of error messages. Empty list means validation passed.
    """
    errors: list[str] = []
    normalized = asr_url.rstrip("/").lower()

    for rule in PROVIDER_URL_RULES:
        if asr_format != rule.format_required:
            continue
        if rule.url_pattern in normalized and not normalized.endswith(
            rule.required_suffix.lower()
        ):
            errors.append(rule.error_message)

    return errors
