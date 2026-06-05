from __future__ import annotations

import json
import os
import shutil
import sqlite3
from pathlib import Path
from typing import Iterable

from .models import GlossaryTerm, RuntimeConfig, SessionRecord, SubtitleSegment


LEGACY_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DATA_DIR = Path(os.environ.get("ONLINE_DATA_DIR", Path.home() / ".online")).expanduser()
LOG_DIR = DATA_DIR / "logs"
DB_PATH = DATA_DIR / "runtime.sqlite3"
CONFIG_PATH = DATA_DIR / "config.json"


def migrate_legacy_data() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    for filename in ("runtime.sqlite3", "config.json"):
        legacy_path = LEGACY_DATA_DIR / filename
        target_path = DATA_DIR / filename
        if legacy_path.exists() and not target_path.exists():
            shutil.copy2(legacy_path, target_path)


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_storage() -> None:
    migrate_legacy_data()
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                source_lang TEXT NOT NULL,
                target_lang TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT
            );

            CREATE TABLE IF NOT EXISTS subtitle_segments (
                id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                source_text TEXT NOT NULL,
                translated_text TEXT NOT NULL,
                status TEXT NOT NULL,
                version INTEGER NOT NULL,
                start_time REAL NOT NULL,
                end_time REAL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (id, session_id)
            );

            CREATE TABLE IF NOT EXISTS glossary_terms (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                target TEXT NOT NULL,
                domain TEXT,
                enabled INTEGER NOT NULL DEFAULT 1
            );
            """
        )


def load_config() -> RuntimeConfig:
    if not CONFIG_PATH.exists():
        return RuntimeConfig()
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return RuntimeConfig(**data)


def save_config(config: RuntimeConfig) -> RuntimeConfig:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(config.model_dump_json(indent=2), encoding="utf-8")
    return config


def create_session(record: SessionRecord) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO sessions
            (id, title, source_lang, target_lang, started_at, ended_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                record.id,
                record.title,
                record.sourceLang,
                record.targetLang,
                record.startedAt,
                record.endedAt,
            ),
        )


def finish_session(session_id: str, ended_at: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE sessions SET ended_at = ? WHERE id = ?",
            (ended_at, session_id),
        )


def list_sessions() -> list[SessionRecord]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, title, source_lang, target_lang, started_at, ended_at
            FROM sessions
            ORDER BY started_at DESC
            LIMIT 50
            """
        ).fetchall()
    return [
        SessionRecord(
            id=row["id"],
            title=row["title"],
            sourceLang=row["source_lang"],
            targetLang=row["target_lang"],
            startedAt=row["started_at"],
            endedAt=row["ended_at"],
        )
        for row in rows
    ]


def upsert_segment(segment: SubtitleSegment) -> None:
    with _connect() as conn:
        current = conn.execute(
            "SELECT version FROM subtitle_segments WHERE id = ? AND session_id = ?",
            (segment.id, segment.sessionId),
        ).fetchone()
        if current and current["version"] > segment.version:
            return
        conn.execute(
            """
            INSERT INTO subtitle_segments
            (id, session_id, source_text, translated_text, status, version, start_time, end_time, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id, session_id) DO UPDATE SET
                source_text = excluded.source_text,
                translated_text = excluded.translated_text,
                status = excluded.status,
                version = excluded.version,
                start_time = excluded.start_time,
                end_time = excluded.end_time,
                updated_at = excluded.updated_at
            """,
            (
                segment.id,
                segment.sessionId,
                segment.sourceText,
                segment.translatedText,
                segment.status.value,
                segment.version,
                segment.startTime,
                segment.endTime,
                segment.updatedAt,
            ),
        )


def list_segments(session_id: str) -> list[SubtitleSegment]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, session_id, source_text, translated_text, status, version, start_time, end_time, updated_at
            FROM subtitle_segments
            WHERE session_id = ?
            ORDER BY start_time ASC
            """,
            (session_id,),
        ).fetchall()
    return [
        SubtitleSegment(
            id=row["id"],
            sessionId=row["session_id"],
            sourceText=row["source_text"],
            translatedText=row["translated_text"],
            status=row["status"],
            version=row["version"],
            startTime=row["start_time"],
            endTime=row["end_time"],
            updatedAt=row["updated_at"],
        )
        for row in rows
    ]


def list_glossary() -> list[GlossaryTerm]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, source, target, domain, enabled FROM glossary_terms ORDER BY source ASC"
        ).fetchall()
    return [
        GlossaryTerm(
            id=row["id"],
            source=row["source"],
            target=row["target"],
            domain=row["domain"],
            enabled=bool(row["enabled"]),
        )
        for row in rows
    ]


def save_glossary_term(term: GlossaryTerm) -> GlossaryTerm:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO glossary_terms (id, source, target, domain, enabled)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source = excluded.source,
                target = excluded.target,
                domain = excluded.domain,
                enabled = excluded.enabled
            """,
            (term.id, term.source, term.target, term.domain, int(term.enabled)),
        )
    return term


def delete_glossary_term(term_id: str) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM glossary_terms WHERE id = ?", (term_id,))


def seed_glossary(terms: Iterable[GlossaryTerm]) -> None:
    if list_glossary():
        return
    for term in terms:
        save_glossary_term(term)
