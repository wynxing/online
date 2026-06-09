"""Tests for ASR text sanitization logic."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.pipeline.text_sanitize import sanitize_asr_text


class EmptyInputTests(unittest.TestCase):
    def test_empty_string(self) -> None:
        result = sanitize_asr_text("")
        self.assertEqual(result.text, "")
        self.assertEqual(result.reject_reason, "empty")

    def test_whitespace_only(self) -> None:
        result = sanitize_asr_text("   \n\t  ")
        self.assertEqual(result.text, "")
        self.assertEqual(result.reject_reason, "empty")


class ProtocolNoiseTests(unittest.TestCase):
    def test_think_block_removed(self) -> None:
        result = sanitize_asr_text("<think>reasoning</think> Final answer.")
        self.assertEqual(result.text, "Final answer.")
        self.assertIsNone(result.reject_reason)

    def test_html_tags_removed(self) -> None:
        result = sanitize_asr_text("<chinese> Hello world.")
        self.assertEqual(result.text, "Hello world.")

    def test_code_fence_removed(self) -> None:
        result = sanitize_asr_text("```text\nSome text\n```")
        # Code fences replaced with space, language tag may remain
        self.assertIn("Some text", result.text)

    def test_role_prefix_removed(self) -> None:
        result = sanitize_asr_text("assistant: The answer is yes.")
        self.assertEqual(result.text, "The answer is yes.")

    def test_leading_think_removed(self) -> None:
        result = sanitize_asr_text("think> This is the answer.")
        self.assertEqual(result.text, "This is the answer.")

    def test_leading_think_word_removed(self) -> None:
        result = sanitize_asr_text("think About this.")
        self.assertEqual(result.text, "About this.")


class PromptEchoTests(unittest.TestCase):
    def test_previous_context_echo(self) -> None:
        result = sanitize_asr_text("Previous context: some text.")
        self.assertEqual(result.text, "")
        self.assertEqual(result.reject_reason, "prompt_echo")

    def test_context_echo(self) -> None:
        result = sanitize_asr_text("context: more text")
        self.assertEqual(result.text, "")
        self.assertEqual(result.reject_reason, "prompt_echo")


class NoiseRejectionTests(unittest.TestCase):
    def test_numeric_noise(self) -> None:
        for raw in ["1.", "20.", "0.", "10p."]:
            with self.subTest(raw=raw):
                result = sanitize_asr_text(raw, source_lang="en")
                self.assertEqual(result.text, "")
                self.assertEqual(result.reject_reason, "numeric_or_symbol_noise")

    def test_short_marker(self) -> None:
        result = sanitize_asr_text("a", source_lang="en")
        self.assertEqual(result.text, "")
        self.assertEqual(result.reject_reason, "numeric_or_symbol_noise")

    def test_symbol_only(self) -> None:
        result = sanitize_asr_text(".", source_lang="en")
        self.assertEqual(result.text, "")

    def test_no_alpha_characters(self) -> None:
        result = sanitize_asr_text("123 456 789", source_lang="en")
        self.assertEqual(result.text, "")


class WhisperHallucinationTests(unittest.TestCase):
    def test_common_hallucinations_rejected(self) -> None:
        hallucinations = [
            "Thank you",
            "Thanks for watching",
            "Subscribe",
            "Goodbye",
            "See you next time",
            "[music]",
            "[applause]",
        ]
        for text in hallucinations:
            with self.subTest(text=text):
                result = sanitize_asr_text(text, source_lang="en")
                self.assertEqual(result.text, "")
                self.assertEqual(result.reject_reason, "whisper_hallucination")

    def test_hallucination_case_insensitive(self) -> None:
        result = sanitize_asr_text("THANK YOU", source_lang="en")
        self.assertEqual(result.text, "")

    def test_hallucination_with_punctuation(self) -> None:
        result = sanitize_asr_text("Thank you!", source_lang="en")
        self.assertEqual(result.text, "")


class TargetLanguageDetectionTests(unittest.TestCase):
    def test_chinese_output_rejected_for_english_source(self) -> None:
        result = sanitize_asr_text("为啥？", source_lang="en")
        self.assertEqual(result.text, "")
        self.assertEqual(result.reject_reason, "target_language_output")

    def test_mixed_latin_and_cjk_kept(self) -> None:
        result = sanitize_asr_text("Hello 你好", source_lang="en")
        self.assertEqual(result.text, "Hello 你好")
        self.assertIsNone(result.reject_reason)

    def test_cjk_not_rejected_for_chinese_source(self) -> None:
        result = sanitize_asr_text("你好世界", source_lang="zh")
        self.assertEqual(result.text, "你好世界")
        self.assertIsNone(result.reject_reason)


class NormalTranscriptTests(unittest.TestCase):
    def test_normal_english_kept(self) -> None:
        texts = [
            "Hello, how are you?",
            "The quick brown fox jumps over the lazy dog.",
            "Well, you did.",
            "You? How could you?",
            "Think about it.",  # Should NOT be rejected
            "I think we should go.",
        ]
        for text in texts:
            with self.subTest(text=text):
                result = sanitize_asr_text(text, source_lang="en")
                self.assertIsNone(result.reject_reason)
                self.assertEqual(result.text, text)

    def test_whitespace_normalized(self) -> None:
        result = sanitize_asr_text("  Hello   world  ", source_lang="en")
        self.assertEqual(result.text, "Hello world")

    def test_quotes_stripped(self) -> None:
        result = sanitize_asr_text('"Hello world."', source_lang="en")
        self.assertEqual(result.text, "Hello world.")


if __name__ == "__main__":
    unittest.main()
