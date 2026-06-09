"""Tests for translation provider: LRU cache, glossary matching, text cleaning."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import GlossaryTerm
from app.translation_provider import (
    TranslationContext,
    _TranslationCache,
    _clean_translation_text,
    _enforce_glossary,
    _matched_glossary_terms,
    _normalize_cache_key,
)


class LRUCacheTests(unittest.TestCase):
    def test_get_returns_value_and_updates_order(self) -> None:
        cache = _TranslationCache(max_size=3)
        cache.put("a", "1")
        cache.put("b", "2")
        cache.put("c", "3")

        self.assertEqual(cache.get("a"), "1")
        # Now "a" is most recently used, so inserting "d" should evict "b"
        cache.put("d", "4")
        self.assertIsNone(cache.get("b"))
        self.assertEqual(cache.get("a"), "1")
        self.assertEqual(cache.get("c"), "3")
        self.assertEqual(cache.get("d"), "4")

    def test_put_evicts_lru_when_full(self) -> None:
        cache = _TranslationCache(max_size=2)
        cache.put("a", "1")
        cache.put("b", "2")
        cache.put("c", "3")  # Should evict "a"
        self.assertIsNone(cache.get("a"))
        self.assertEqual(cache.get("b"), "2")
        self.assertEqual(cache.get("c"), "3")

    def test_put_updates_existing_key(self) -> None:
        cache = _TranslationCache(max_size=2)
        cache.put("a", "1")
        cache.put("a", "2")
        self.assertEqual(cache.get("a"), "2")
        # Only one entry
        cache.put("b", "3")
        self.assertEqual(cache.get("a"), "2")
        self.assertEqual(cache.get("b"), "3")

    def test_get_miss_returns_none(self) -> None:
        cache = _TranslationCache(max_size=5)
        self.assertIsNone(cache.get("missing"))

    def test_hits_counter_increments(self) -> None:
        cache = _TranslationCache(max_size=5)
        cache.put("a", "1")
        cache.get("a")
        cache.get("a")
        cache.get("missing")
        self.assertEqual(cache.hits, 2)


class CacheKeyNormalizationTests(unittest.TestCase):
    def test_lowercase(self) -> None:
        self.assertEqual(_normalize_cache_key("Hello World"), "hello world")

    def test_strip_whitespace(self) -> None:
        self.assertEqual(_normalize_cache_key("  hello  "), "hello")

    def test_collapse_spaces(self) -> None:
        self.assertEqual(_normalize_cache_key("hello   world"), "hello world")


class GlossaryMatchingTests(unittest.TestCase):
    def test_matches_source_in_text(self) -> None:
        terms = [
            GlossaryTerm(id="1", source="vector database", target="向量数据库"),
            GlossaryTerm(id="2", source="latency", target="延迟"),
        ]
        matched = _matched_glossary_terms("The vector database is fast.", [], terms)
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["source"], "vector database")

    def test_matches_in_context(self) -> None:
        terms = [GlossaryTerm(id="1", source="edge computing", target="边缘计算")]
        ctx = [TranslationContext(source_text="Edge computing is growing.", translated_text="边缘计算在增长。")]
        matched = _matched_glossary_terms("Something about servers.", ctx, terms)
        self.assertEqual(len(matched), 1)

    def test_disabled_terms_excluded(self) -> None:
        terms = [GlossaryTerm(id="1", source="test", target="测试", enabled=False)]
        matched = _matched_glossary_terms("This is a test.", [], terms)
        self.assertEqual(len(matched), 0)

    def test_empty_source_term_excluded(self) -> None:
        terms = [GlossaryTerm(id="1", source="", target="测试")]
        matched = _matched_glossary_terms("Hello world.", [], terms)
        self.assertEqual(len(matched), 0)


class GlossaryEnforcementTests(unittest.TestCase):
    def test_replaces_untranslated_english_terms(self) -> None:
        glossary = [{"source": "vector database", "target": "向量数据库", "domain": None}]
        result = _enforce_glossary("使用 vector database 技术。", glossary)
        self.assertEqual(result, "使用 向量数据库 技术。")

    def test_no_replacement_when_already_translated(self) -> None:
        glossary = [{"source": "vector database", "target": "向量数据库", "domain": None}]
        result = _enforce_glossary("使用向量数据库技术。", glossary)
        self.assertEqual(result, "使用向量数据库技术。")

    def test_case_insensitive_replacement(self) -> None:
        glossary = [{"source": "Vector Database", "target": "向量数据库", "domain": None}]
        result = _enforce_glossary("Using vector database.", glossary)
        self.assertEqual(result, "Using 向量数据库.")


class TextCleaningTests(unittest.TestCase):
    def test_removes_think_blocks(self) -> None:
        result = _clean_translation_text("<think>reasoning</think>翻译结果")
        self.assertEqual(result, "翻译结果")

    def test_removes_code_fences(self) -> None:
        result = _clean_translation_text("```text\n翻译结果\n```")
        self.assertEqual(result, "翻译结果")

    def test_removes_role_prefix(self) -> None:
        result = _clean_translation_text("assistant: 这是翻译。")
        self.assertEqual(result, "这是翻译。")

    def test_strips_quotes(self) -> None:
        result = _clean_translation_text('"翻译结果"')
        self.assertEqual(result, "翻译结果")

    def test_normalizes_whitespace(self) -> None:
        result = _clean_translation_text("翻译   结果")
        self.assertEqual(result, "翻译 结果")


if __name__ == "__main__":
    unittest.main()
