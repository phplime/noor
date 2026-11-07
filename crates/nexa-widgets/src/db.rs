use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WidgetError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("data error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    NotFound(String),
}

pub type WidgetResult<T> = Result<T, WidgetError>;

/// Bump and add a migration block in `migrate` when the schema changes.
#[allow(dead_code)]
const SCHEMA_VERSION: i64 = 5;

pub struct WidgetDb {
    pub(crate) conn: Connection,
}

impl WidgetDb {
    pub fn open(path: &Path) -> WidgetResult<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> WidgetResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    /// Write a consistent copy of the whole database file (all tables, including
    /// the prayer engine's) to `path`. The target must not exist.
    pub fn snapshot_to(&self, path: &Path) -> WidgetResult<()> {
        self.conn.execute("VACUUM INTO ?1", [path.to_string_lossy()])?;
        Ok(())
    }

    fn init(conn: Connection) -> WidgetResult<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 3000;
             CREATE TABLE IF NOT EXISTS widget_schema (version INTEGER NOT NULL);",
        )?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> WidgetResult<()> {
        let version: i64 = self
            .conn
            .query_row("SELECT COALESCE(MAX(version), 0) FROM widget_schema", [], |r| r.get(0))?;
        if version < 1 {
            self.conn.execute_batch(
                "BEGIN;
                 CREATE TABLE IF NOT EXISTS w_kv (
                     key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
                 CREATE TABLE IF NOT EXISTS todos (
                     id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
                     created_at INTEGER NOT NULL, done_at INTEGER, position INTEGER NOT NULL);
                 CREATE TABLE IF NOT EXISTS clips (
                     id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL UNIQUE,
                     created_at INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0);
                 CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at);
                 CREATE TABLE IF NOT EXISTS water (
                     id INTEGER PRIMARY KEY AUTOINCREMENT, ml INTEGER NOT NULL, at INTEGER NOT NULL);
                 CREATE INDEX IF NOT EXISTS idx_water_at ON water(at);
                 CREATE TABLE IF NOT EXISTS shelf (
                     id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                     ext TEXT NOT NULL, size INTEGER NOT NULL, is_dir INTEGER NOT NULL DEFAULT 0,
                     added_at INTEGER NOT NULL);
                 CREATE TABLE IF NOT EXISTS apps (
                     path TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
                 CREATE TABLE IF NOT EXISTS clocks (
                     id TEXT PRIMARY KEY, label TEXT NOT NULL, timezone TEXT NOT NULL,
                     position INTEGER NOT NULL);
                 CREATE TABLE IF NOT EXISTS lyrics (
                     key TEXT PRIMARY KEY, synced TEXT, plain TEXT,
                     instrumental INTEGER NOT NULL DEFAULT 0, found INTEGER NOT NULL,
                     fetched_at INTEGER NOT NULL);
                 INSERT INTO widget_schema (version) VALUES (1);
                 COMMIT;",
            )?;
        }
        if version < 2 {
            self.conn.execute_batch(
                "BEGIN;
                 CREATE TABLE IF NOT EXISTS custom_reminders (
                     id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
                     at TEXT NOT NULL, repeat TEXT NOT NULL DEFAULT 'never',
                     enabled INTEGER NOT NULL DEFAULT 1, sound TEXT NOT NULL DEFAULT 'default',
                     color TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
                 INSERT INTO widget_schema (version) VALUES (2);
                 COMMIT;",
            )?;
        }
        if version < 3 {
            self.conn.execute_batch(
                "BEGIN;
                 CREATE TABLE IF NOT EXISTS quiet_places (
                     id TEXT PRIMARY KEY, name TEXT NOT NULL, latitude REAL NOT NULL,
                     longitude REAL NOT NULL, radius_m INTEGER NOT NULL DEFAULT 500,
                     automated INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
                 INSERT INTO widget_schema (version) VALUES (3);
                 COMMIT;",
            )?;
        }
        if version < 4 {
            self.conn.execute_batch(
                "BEGIN;
                 CREATE TABLE IF NOT EXISTS special_days (
                     id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
                     calendar TEXT NOT NULL DEFAULT 'gregorian', month INTEGER NOT NULL, day INTEGER NOT NULL,
                     year INTEGER, alert INTEGER NOT NULL DEFAULT 0, alert_time TEXT NOT NULL DEFAULT '09:00',
                     days_before INTEGER NOT NULL DEFAULT 0, sound TEXT NOT NULL DEFAULT 'default',
                     color TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
                 INSERT INTO widget_schema (version) VALUES (4);
                 COMMIT;",
            )?;
        }
        if version < 5 {
            self.conn.execute_batch(
                "BEGIN;
                 CREATE TABLE IF NOT EXISTS salah_log (
                     date TEXT NOT NULL, prayer TEXT NOT NULL, status TEXT NOT NULL,
                     updated_at INTEGER NOT NULL, PRIMARY KEY (date, prayer));
                 INSERT INTO widget_schema (version) VALUES (5);
                 COMMIT;",
            )?;
        }
        if version < 6 {
            // Reminders: extra alerts before the time ("30,10" minutes), whether the exact time alerts,
            // and whether it rings like an alarm until stopped.
            self.conn.execute_batch(
                "BEGIN;
                 ALTER TABLE custom_reminders ADD COLUMN before TEXT NOT NULL DEFAULT '';
                 ALTER TABLE custom_reminders ADD COLUMN exact INTEGER NOT NULL DEFAULT 1;
                 ALTER TABLE custom_reminders ADD COLUMN alarm INTEGER NOT NULL DEFAULT 0;
                 INSERT INTO widget_schema (version) VALUES (6);
                 COMMIT;",
            )?;
        }
        Ok(())
    }

    pub fn get_json<T: DeserializeOwned>(&self, key: &str) -> WidgetResult<Option<T>> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT value FROM w_kv WHERE key = ?1", [key], |r| r.get(0))
            .optional()?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn set_json<T: Serialize>(&self, key: &str, value: &T) -> WidgetResult<()> {
        self.conn.execute(
            "INSERT INTO w_kv (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, serde_json::to_string(value)?, crate::now_ms()],
        )?;
        Ok(())
    }
}
