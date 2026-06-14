use std::{
    env,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use rusqlite::{params, Connection, OptionalExtension};

use crate::{
    error::{AppError, AppResult},
    models::{
        GlossaryTerm, GlossaryTermInput, RuntimeConfig, SessionRecord, SubtitleSegment,
        SubtitleStatus,
    },
};

const MIGRATIONS: &str = r#"
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

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
    superseded_by TEXT,
    PRIMARY KEY (id, session_id)
);

CREATE TABLE IF NOT EXISTS glossary_terms (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    domain TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_segments_session ON subtitle_segments(session_id);
"#;

#[derive(Clone)]
pub struct Storage {
    conn: Arc<Mutex<Connection>>,
}

impl Storage {
    pub fn new() -> AppResult<Self> {
        let dir = data_dir();
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::Storage(rusqlite::Error::ToSqlConversionFailure(Box::new(e))))?;
        let conn = Connection::open(dir.join("runtime.sqlite3"))?;
        conn.execute_batch(MIGRATIONS)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub async fn load_config(&self) -> AppResult<RuntimeConfig> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().unwrap();
            let value: Option<String> = conn
                .query_row(
                    "SELECT value FROM config WHERE key = 'runtime'",
                    [],
                    |row| row.get(0),
                )
                .optional()?;
            match value {
                Some(value) => serde_json::from_str::<RuntimeConfig>(&value)
                    .map(|config| config.normalized())
                    .map_err(|e| AppError::Config(e.to_string())),
                None => Ok(RuntimeConfig::default()),
            }
        })
        .await?
    }

    pub async fn save_config(&self, config: RuntimeConfig) -> AppResult<RuntimeConfig> {
        let config = config.normalized();
        let value = serde_json::to_string(&config).map_err(|e| AppError::Config(e.to_string()))?;
        let conn = self.conn.clone();
        let saved = config.clone();
        tokio::task::spawn_blocking(move || {
            conn.lock().unwrap().execute(
                "INSERT INTO config (key, value) VALUES ('runtime', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![value],
            )?;
            Ok(saved)
        })
        .await?
    }

    pub async fn create_session(&self, record: SessionRecord) -> AppResult<SessionRecord> {
        let conn = self.conn.clone();
        let saved = record.clone();
        tokio::task::spawn_blocking(move || {
            conn.lock().unwrap().execute(
                "INSERT OR REPLACE INTO sessions
                 (id, title, source_lang, target_lang, started_at, ended_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    record.id,
                    record.title,
                    record.source_lang,
                    record.target_lang,
                    record.started_at,
                    record.ended_at
                ],
            )?;
            Ok(saved)
        })
        .await?
    }

    pub async fn finish_session(&self, session_id: String, ended_at: String) -> AppResult<()> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            conn.lock().unwrap().execute(
                "UPDATE sessions SET ended_at = ?1 WHERE id = ?2",
                params![ended_at, session_id],
            )?;
            Ok(())
        })
        .await?
    }

    pub async fn list_sessions(&self) -> AppResult<Vec<SessionRecord>> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT id, title, source_lang, target_lang, started_at, ended_at
                 FROM sessions ORDER BY started_at DESC LIMIT 50",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(SessionRecord {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    source_lang: row.get(2)?,
                    target_lang: row.get(3)?,
                    started_at: row.get(4)?,
                    ended_at: row.get(5)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
        .await?
    }

    pub async fn upsert_segment(&self, segment: SubtitleSegment) -> AppResult<()> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            conn.lock().unwrap().execute(
                "INSERT INTO subtitle_segments
                 (id, session_id, source_text, translated_text, status, version, start_time, end_time, updated_at, superseded_by)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(id, session_id) DO UPDATE SET
                    source_text = excluded.source_text,
                    translated_text = excluded.translated_text,
                    status = excluded.status,
                    version = excluded.version,
                    start_time = excluded.start_time,
                    end_time = excluded.end_time,
                    updated_at = excluded.updated_at,
                    superseded_by = excluded.superseded_by
                 WHERE excluded.version >= subtitle_segments.version",
                params![
                    segment.id,
                    segment.session_id,
                    segment.source_text,
                    segment.translated_text,
                    status_to_str(&segment.status),
                    segment.version,
                    segment.start_time,
                    segment.end_time,
                    segment.updated_at,
                    segment.superseded_by
                ],
            )?;
            Ok(())
        })
        .await?
    }

    pub async fn list_segments(&self, session_id: String) -> AppResult<Vec<SubtitleSegment>> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT id, session_id, source_text, translated_text, status, version,
                        start_time, end_time, updated_at, superseded_by
                 FROM subtitle_segments WHERE session_id = ?1 ORDER BY start_time ASC",
            )?;
            let rows = stmt.query_map(params![session_id], |row| {
                let status: String = row.get(4)?;
                Ok(SubtitleSegment {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    source_text: row.get(2)?,
                    translated_text: row.get(3)?,
                    status: str_to_status(&status),
                    version: row.get::<_, i64>(5)? as u32,
                    start_time: row.get(6)?,
                    end_time: row.get(7)?,
                    updated_at: row.get(8)?,
                    superseded_by: row.get(9)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
        .await?
    }

    pub async fn list_glossary(&self) -> AppResult<Vec<GlossaryTerm>> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT id, source, target, domain, enabled FROM glossary_terms ORDER BY source ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(GlossaryTerm {
                    id: row.get(0)?,
                    source: row.get(1)?,
                    target: row.get(2)?,
                    domain: row.get(3)?,
                    enabled: row.get::<_, i64>(4)? != 0,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
        .await?
    }

    pub async fn save_glossary(&self, term: GlossaryTerm) -> AppResult<GlossaryTerm> {
        let conn = self.conn.clone();
        let saved = term.clone();
        tokio::task::spawn_blocking(move || {
            conn.lock().unwrap().execute(
                "INSERT INTO glossary_terms (id, source, target, domain, enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    source = excluded.source,
                    target = excluded.target,
                    domain = excluded.domain,
                    enabled = excluded.enabled",
                params![
                    term.id,
                    term.source,
                    term.target,
                    term.domain,
                    term.enabled as i64
                ],
            )?;
            Ok(saved)
        })
        .await?
    }

    pub async fn create_glossary(&self, input: GlossaryTermInput) -> AppResult<GlossaryTerm> {
        let term = GlossaryTerm {
            id: format!("term_{}", uuid::Uuid::new_v4().simple()),
            source: input.source,
            target: input.target,
            domain: input.domain,
            enabled: input.enabled,
        };
        self.save_glossary(term).await
    }

    pub async fn delete_glossary(&self, id: String) -> AppResult<()> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            conn.lock()
                .unwrap()
                .execute("DELETE FROM glossary_terms WHERE id = ?1", params![id])?;
            Ok(())
        })
        .await?
    }
}

pub fn data_dir() -> PathBuf {
    if let Ok(dir) = env::var("ONLINE_DATA_DIR") {
        return PathBuf::from(dir);
    }
    if let Ok(home) = env::var("USERPROFILE").or_else(|_| env::var("HOME")) {
        return PathBuf::from(home).join(".online");
    }
    PathBuf::from(".online")
}

fn status_to_str(status: &SubtitleStatus) -> &'static str {
    match status {
        SubtitleStatus::Interim => "interim",
        SubtitleStatus::Final => "final",
        SubtitleStatus::Corrected => "corrected",
    }
}

fn str_to_status(status: &str) -> SubtitleStatus {
    match status {
        "corrected" => SubtitleStatus::Corrected,
        "interim" => SubtitleStatus::Interim,
        _ => SubtitleStatus::Final,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[tokio::test]
    async fn config_round_trips() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp = tempfile_dir();
        std::env::set_var("ONLINE_DATA_DIR", &temp);
        let storage = Storage::new().unwrap();
        let saved = storage
            .save_config(RuntimeConfig {
                api_key: "test".into(),
                ..RuntimeConfig::default()
            })
            .await
            .unwrap();
        assert_eq!(saved.api_key, "test");
        assert_eq!(storage.load_config().await.unwrap().api_key, "test");
        let _ = std::fs::remove_dir_all(temp);
    }

    #[tokio::test]
    async fn session_crud_round_trips() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp = tempfile_dir();
        std::env::set_var("ONLINE_DATA_DIR", &temp);
        let storage = Storage::new().unwrap();
        storage
            .create_session(make_session("session_1"))
            .await
            .unwrap();
        let sessions = storage.list_sessions().await.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "session_1");
        storage
            .finish_session("session_1".into(), "2026-01-01T00:00:01Z".into())
            .await
            .unwrap();
        let sessions = storage.list_sessions().await.unwrap();
        assert_eq!(
            sessions[0].ended_at.as_deref(),
            Some("2026-01-01T00:00:01Z")
        );
        let _ = std::fs::remove_dir_all(temp);
    }

    #[tokio::test]
    async fn segment_upsert_keeps_highest_version() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp = tempfile_dir();
        std::env::set_var("ONLINE_DATA_DIR", &temp);
        let storage = Storage::new().unwrap();
        storage
            .create_session(make_session("session_1"))
            .await
            .unwrap();
        storage
            .upsert_segment(make_segment("session_1", "seg_1", 2, "second"))
            .await
            .unwrap();
        storage
            .upsert_segment(make_segment("session_1", "seg_1", 1, "first"))
            .await
            .unwrap();
        let segments = storage.list_segments("session_1".into()).await.unwrap();
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].source_text, "second");
        let _ = std::fs::remove_dir_all(temp);
    }

    #[tokio::test]
    async fn glossary_crud_round_trips() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp = tempfile_dir();
        std::env::set_var("ONLINE_DATA_DIR", &temp);
        let storage = Storage::new().unwrap();
        let term = storage
            .create_glossary(GlossaryTermInput {
                source: "latency".into(),
                target: "delay".into(),
                domain: Some("tech".into()),
                enabled: true,
            })
            .await
            .unwrap();
        assert_eq!(storage.list_glossary().await.unwrap().len(), 1);
        storage.delete_glossary(term.id).await.unwrap();
        assert_eq!(storage.list_glossary().await.unwrap().len(), 0);
        let _ = std::fs::remove_dir_all(temp);
    }

    fn tempfile_dir() -> PathBuf {
        std::env::temp_dir().join(format!("online-test-{}", uuid::Uuid::new_v4()))
    }

    fn make_session(id: &str) -> SessionRecord {
        SessionRecord {
            id: id.into(),
            title: "Test Session".into(),
            source_lang: "en".into(),
            target_lang: "zh-CN".into(),
            started_at: "2026-01-01T00:00:00Z".into(),
            ended_at: None,
        }
    }

    fn make_segment(
        session_id: &str,
        id: &str,
        version: u32,
        source_text: &str,
    ) -> SubtitleSegment {
        SubtitleSegment {
            id: id.into(),
            session_id: session_id.into(),
            source_text: source_text.into(),
            translated_text: "translation".into(),
            status: SubtitleStatus::Final,
            version,
            start_time: 0.0,
            end_time: Some(1.0),
            updated_at: "2026-01-01T00:00:00Z".into(),
            superseded_by: None,
        }
    }
}
