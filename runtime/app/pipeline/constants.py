"""Pipeline constants, thresholds, and compiled regex patterns."""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Timing thresholds
# ---------------------------------------------------------------------------
NO_SIGNAL_GRACE_SECONDS = 8.0
SIGNAL_CHECK_INTERVAL_SECONDS = 2.0
SEGMENT_QUEUE_MAXSIZE = 10
TRANSLATION_QUEUE_MAXSIZE = 8
ASR_STALE_SECONDS = 12.0
TRANSLATION_STALE_SECONDS = 10.0
TRANSLATION_REORDER_WAIT_SECONDS = 1.2
TRANSLATION_OPEN_TAIL_WAIT_SECONDS = 0.25
TRANSLATION_QUEUE_POLL_SECONDS = 0.05

# Translation dynamic concurrency
TRANSLATION_BACKLOG_THRESHOLD = 3
TRANSLATION_MAX_CONCURRENCY = 6

# Streaming translation token thresholds
STREAM_MIN_TOKENS = 3
STREAM_MAX_INTERVAL = 0.15
STREAM_MIN_INTERVAL = 0.03

# ---------------------------------------------------------------------------
# Compiled regex patterns — text sanitization
# ---------------------------------------------------------------------------
_CJK_RE = re.compile(r"[㐀-鿿]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_SEGMENT_SEQUENCE_RE = re.compile(r"^seg_(\d+)$")
_SENTENCE_BOUNDARY_RE = re.compile(r"[.!?…][\"')\]]*(?:\s+|$)")
_SENTENCE_END_RE = re.compile(r"[.!?…][\"')\]]*\s*$")
_LONG_SEGMENT_BOUNDARY_RE = re.compile(r"[,;][\"')\]]*\s+(?=[A-Z])")
_ROLE_PREFIX_RE = re.compile(
    r"^\s*(?:assistant|user|system|transcript|translation|answer)\s*[:：]\s*",
    re.IGNORECASE,
)
_PROMPT_ECHO_RE = re.compile(r"^\s*(?:previous\s+context|context)\s*[:：]", re.IGNORECASE)
_THINK_BLOCK_RE = re.compile(r"(?is)<think>.*?</think>")
_TAG_RE = re.compile(r"</?[^>\n]+>")
_LEADING_THINK_RE = re.compile(r"^\s*(?:think|reasoning|analysis)\s*(?:>|:|-)\s*", re.IGNORECASE)
_LEADING_LOWER_THINK_WORD_RE = re.compile(r"^\s*think\s+(?=[A-Z<])")
_NUMERIC_NOISE_RE = re.compile(r"^\s*\d+\s*[A-Za-z]?\s*[\W_]*\s*$")
_SHORT_MARKER_RE = re.compile(r"^\s*(?:[A-Za-z]|\d+[A-Za-z]?)\s*[\W_]*\s*$")

# Whisper hallucination phrases (lowercase, stripped of punctuation for matching)
WHISPER_HALLUCINATIONS = {
    "thank you", "thanks for watching", "subscribe",
    "please subscribe", "like and subscribe", "please like",
    "thank you for watching", "thank you for listening",
    "bye", "goodbye", "see you", "see you next time",
    "if you enjoyed", "don't forget to",
    "welcome back", "hello everyone",
    "[music]", "[applause]", "[laughter]",
    "you", "um", "uh", "ah", "hmm",
}
