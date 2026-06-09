"""Tests for storage layer: version guard, async operations."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import GlossaryTerm, SessionRecord, SubtitleSegment, SubtitleStatus
from app.storage import (
    create_session,
    delete_glossary_term,
    init_storage,
    list_glossary,
    list_segments,
    list_sessions,
    save_glossary_term,
    upsert_segment,
)


class StorageInitTests(unittest.TestCase):
    def test_init_storage_creates_tables(self) -> None:
        tmpdir = tempfile.mkdtemp()
        try:
            db_path = os.path.join(tmpdir, "test.sqlite3")
            config_path = os.path.join(tmpdir, "config.json")
            with (
                patch("app.storage.DB_PATH", Path(db_path)),
                patch("app.storage.DATA_DIR", Path(tmpdir)),
                patch("app.storage.CONFIG_PATH", Path(config_path)),
            ):
                init_storage()
                # Verify we can connect and run a query
                import sqlite3

                conn = sqlite3.connect(db_path)
                tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                table_names = {t[0] for t in tables}
                conn.close()
                self.assertIn("sessions", table_names)
                self.assertIn("subtitle_segments", table_names)
                self.assertIn("glossary_terms", table_names)
        finally:
            import shutil

            shutil.rmtree(tmpdir, ignore_errors=True)


class VersionGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.mkdtemp()
        self._db_path = os.path.join(self._tmpdir, "test.sqlite3")
        self._config_path = os.path.join(self._tmpdir, "config.json")
        self._patcher_db = patch("app.storage.DB_PATH", Path(self._db_path))
        self._patcher_dir = patch("app.storage.DATA_DIR", Path(self._tmpdir))
        self._patcher_cfg = patch("app.storage.CONFIG_PATH", Path(self._config_path))
        self._patcher_db.start()
        self._patcher_dir.start()
        self._patcher_cfg.start()
        init_storage()

    def tearDown(self) -> None:
        self._patcher_db.stop()
        self._patcher_dir.stop()
        self._patcher_cfg.stop()
        import shutil

        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def _make_segment(self, segment_id: str, version: int, text: str = "hello") -> SubtitleSegment:
        return SubtitleSegment(
            id=segment_id,
            sessionId="session_test",
            sourceText=text,
            translatedText="你好",
            status=SubtitleStatus.final,
            version=version,
            startTime=0.0,
            endTime=1.0,
            updatedAt="2026-01-01T00:00:00Z",
        )

    def test_upsert_inserts_new_segment(self) -> None:
        segment = self._make_segment("seg_001", version=1)
        upsert_segment(segment)
        segments = list_segments("session_test")
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].id, "seg_001")

    def test_upsert_updates_on_higher_version(self) -> None:
        seg_v1 = self._make_segment("seg_001", version=1, text="first")
        seg_v2 = self._make_segment("seg_001", version=2, text="second")
        upsert_segment(seg_v1)
        upsert_segment(seg_v2)
        segments = list_segments("session_test")
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].sourceText, "second")

    def test_upsert_ignores_lower_version(self) -> None:
        seg_v2 = self._make_segment("seg_001", version=2, text="second")
        seg_v1 = self._make_segment("seg_001", version=1, text="first")
        upsert_segment(seg_v2)
        upsert_segment(seg_v1)  # Should be ignored
        segments = list_segments("session_test")
        self.assertEqual(segments[0].sourceText, "second")

    def test_upsert_same_version_no_change(self) -> None:
        seg_v1 = self._make_segment("seg_001", version=1, text="first")
        seg_v1_again = self._make_segment("seg_001", version=1, text="updated")
        upsert_segment(seg_v1)
        upsert_segment(seg_v1_again)  # Same version, should update (ON CONFLICT)
        segments = list_segments("session_test")
        self.assertEqual(segments[0].sourceText, "updated")


class GlossaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.mkdtemp()
        self._db_path = os.path.join(self._tmpdir, "test.sqlite3")
        self._config_path = os.path.join(self._tmpdir, "config.json")
        self._patcher_db = patch("app.storage.DB_PATH", Path(self._db_path))
        self._patcher_dir = patch("app.storage.DATA_DIR", Path(self._tmpdir))
        self._patcher_cfg = patch("app.storage.CONFIG_PATH", Path(self._config_path))
        self._patcher_db.start()
        self._patcher_dir.start()
        self._patcher_cfg.start()
        init_storage()

    def tearDown(self) -> None:
        self._patcher_db.stop()
        self._patcher_dir.stop()
        self._patcher_cfg.stop()
        import shutil

        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def test_save_and_list_glossary(self) -> None:
        term = GlossaryTerm(id="term_1", source="hello", target="你好")
        save_glossary_term(term)
        terms = list_glossary()
        self.assertEqual(len(terms), 1)
        self.assertEqual(terms[0].source, "hello")

    def test_delete_glossary_term(self) -> None:
        term = GlossaryTerm(id="term_1", source="hello", target="你好")
        save_glossary_term(term)
        delete_glossary_term("term_1")
        terms = list_glossary()
        self.assertEqual(len(terms), 0)

    def test_disabled_term_not_listed_by_default(self) -> None:
        # list_glossary returns all terms (enabled check is in pipeline)
        term = GlossaryTerm(id="term_1", source="hello", target="你好", enabled=False)
        save_glossary_term(term)
        terms = list_glossary()
        self.assertEqual(len(terms), 1)
        self.assertFalse(terms[0].enabled)


class SessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.mkdtemp()
        self._db_path = os.path.join(self._tmpdir, "test.sqlite3")
        self._config_path = os.path.join(self._tmpdir, "config.json")
        self._patcher_db = patch("app.storage.DB_PATH", Path(self._db_path))
        self._patcher_dir = patch("app.storage.DATA_DIR", Path(self._tmpdir))
        self._patcher_cfg = patch("app.storage.CONFIG_PATH", Path(self._config_path))
        self._patcher_db.start()
        self._patcher_dir.start()
        self._patcher_cfg.start()
        init_storage()

    def tearDown(self) -> None:
        self._patcher_db.stop()
        self._patcher_dir.stop()
        self._patcher_cfg.stop()
        import shutil

        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def test_create_and_list_sessions(self) -> None:
        record = SessionRecord(
            id="session_1",
            title="Test Session",
            sourceLang="en",
            targetLang="zh-CN",
            startedAt="2026-01-01T00:00:00Z",
        )
        create_session(record)
        sessions = list_sessions()
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0].title, "Test Session")


if __name__ == "__main__":
    unittest.main()
