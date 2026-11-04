//! SQLite persistence for every Prayer Times setting.
//!
//! * `kv`                    — JSON blobs for settings sections
//! * `locations`             — saved locations
//! * `prayer_notifications`  — per-prayer on/off
//! * `reminders`             — every reminder with its stable id
//! * `delivered`             — notifications already shown (prevents duplicates
//!   across refreshes, restarts and app updates)

use crate::error::Result;
use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;

const SCHEMA_VERSION: i32 = 1;

pub struct Store {
    conn: Connection,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn source_to_str(s: LocationSource) -> &'static str {
    match s {
        LocationSource::Search => "search",
        LocationSource::Manual => "manual",
        LocationSource::Device => "device",
    }
}

fn source_from_str(s: &str) -> LocationSource {
    match s {
        "search" => LocationSource::Search,
        "device" => LocationSource::Device,
        _ => LocationSource::Manual,
    }
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 3000;",
        )?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        let version: i32 = self.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < 1 {
            self.conn.execute_batch(
                "BEGIN;
                 CREATE TABLE IF NOT EXISTS kv (
                     key        TEXT PRIMARY KEY,
                     value      TEXT NOT NULL,
                     updated_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS locations (
                     id         TEXT PRIMARY KEY,
                     name       TEXT NOT NULL,
                     region     TEXT NOT NULL DEFAULT '',
                     country    TEXT NOT NULL DEFAULT '',
                     latitude   REAL NOT NULL,
                     longitude  REAL NOT NULL,
                     timezone   TEXT NOT NULL,
                     elevation  REAL NOT NULL DEFAULT 0,
                     source     TEXT NOT NULL DEFAULT 'manual',
                     created_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS prayer_notifications (
                     prayer  TEXT PRIMARY KEY,
                     enabled INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS reminders (
                     id             TEXT PRIMARY KEY,
                     prayer         TEXT NOT NULL,
                     offset_minutes INTEGER NOT NULL,
                     enabled        INTEGER NOT NULL,
                     title          TEXT,
                     message        TEXT,
                     sound          TEXT,
                     created_at     INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_reminders_prayer ON reminders(prayer);
                 CREATE TABLE IF NOT EXISTS delivered (
                     id          TEXT PRIMARY KEY,
                     prayer_date TEXT NOT NULL,
                     fired_at    INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_delivered_date ON delivered(prayer_date);
                 COMMIT;",
            )?;
        }
        self.conn
            .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
        Ok(())
    }

    // ----- key/value ------------------------------------------------------

    pub fn get_json<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .optional()?;
        // A value that no longer parses (e.g. after a downgrade) falls back to defaults.
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn set_json<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let json = serde_json::to_string(value)?;
        self.conn.execute(
            "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, json, now_ms()],
        )?;
        Ok(())
    }

    pub fn delete_key(&self, key: &str) -> Result<()> {
        self.conn.execute("DELETE FROM kv WHERE key = ?1", [key])?;
        Ok(())
    }

    // ----- locations ------------------------------------------------------

    pub fn locations(&self) -> Result<Vec<PrayerLocation>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, region, country, latitude, longitude, timezone, elevation, source
             FROM locations ORDER BY created_at, name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(PrayerLocation {
                id: r.get(0)?,
                name: r.get(1)?,
                region: r.get(2)?,
                country: r.get(3)?,
                latitude: r.get(4)?,
                longitude: r.get(5)?,
                timezone: r.get(6)?,
                elevation: r.get(7)?,
                source: source_from_str(&r.get::<_, String>(8)?),
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn location(&self, id: &str) -> Result<Option<PrayerLocation>> {
        Ok(self.locations()?.into_iter().find(|l| l.id == id))
    }

    pub fn upsert_location(&self, l: &PrayerLocation) -> Result<()> {
        self.conn.execute(
            "INSERT INTO locations (id, name, region, country, latitude, longitude, timezone, elevation, source, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, region = excluded.region,
                 country = excluded.country, latitude = excluded.latitude, longitude = excluded.longitude,
                 timezone = excluded.timezone, elevation = excluded.elevation, source = excluded.source",
            params![
                l.id,
                l.name,
                l.region,
                l.country,
                l.latitude,
                l.longitude,
                l.timezone,
                l.elevation,
                source_to_str(l.source),
                now_ms()
            ],
        )?;
        Ok(())
    }

    pub fn delete_location(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM locations WHERE id = ?1", [id])?;
        Ok(())
    }

    // ----- notifications --------------------------------------------------

    pub fn notification_settings(&self) -> Result<Option<PrayerNotificationSettings>> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Meta {
            master_enabled: bool,
            default_sound: String,
            grace_minutes: u32,
            #[serde(default = "yes")]
            jamaat_alerts: bool,
            #[serde(default = "ten")]
            jamaat_before_minutes: u32,
        }
        fn yes() -> bool {
            true
        }
        fn ten() -> u32 {
            10
        }
        let Some(meta) = self.get_json::<Meta>("notifications.meta")? else {
            return Ok(None);
        };

        let mut toggles = std::collections::HashMap::new();
        {
            let mut stmt = self.conn.prepare("SELECT prayer, enabled FROM prayer_notifications")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)))?;
            for row in rows {
                let (k, v) = row?;
                if let Some(p) = Prayer::from_key(&k) {
                    toggles.insert(p, v);
                }
            }
        }

        let mut stmt = self.conn.prepare(
            "SELECT id, prayer, offset_minutes, enabled, title, message, sound
             FROM reminders ORDER BY offset_minutes, created_at",
        )?;
        let reminders: Vec<PrayerReminder> = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i32>(2)?,
                    r.get::<_, bool>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })?
            .filter_map(|row| row.ok())
            .filter_map(|(id, prayer, offset, enabled, title, message, sound)| {
                Some(PrayerReminder {
                    id,
                    prayer: Prayer::from_key(&prayer)?,
                    offset_minutes: offset,
                    enabled,
                    title,
                    message,
                    sound,
                })
            })
            .collect();

        let prayers = Prayer::ALL
            .into_iter()
            .map(|p| PrayerNotificationConfig {
                prayer: p,
                enabled: toggles.get(&p).copied().unwrap_or(false),
                reminders: reminders.iter().filter(|r| r.prayer == p).cloned().collect(),
            })
            .collect();

        Ok(Some(PrayerNotificationSettings {
            master_enabled: meta.master_enabled,
            default_sound: meta.default_sound,
            grace_minutes: meta.grace_minutes,
            prayers,
            jamaat_alerts: meta.jamaat_alerts,
            jamaat_before_minutes: meta.jamaat_before_minutes,
        }))
    }

    pub fn save_notification_settings(&mut self, s: &PrayerNotificationSettings) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO kv (key, value, updated_at) VALUES ('notifications.meta', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![
                serde_json::json!({
                    "masterEnabled": s.master_enabled,
                    "defaultSound": s.default_sound,
                    "graceMinutes": s.grace_minutes,
                    "jamaatAlerts": s.jamaat_alerts,
                    "jamaatBeforeMinutes": s.jamaat_before_minutes,
                })
                .to_string(),
                now_ms()
            ],
        )?;
        tx.execute("DELETE FROM prayer_notifications", [])?;
        tx.execute("DELETE FROM reminders", [])?;
        let now = now_ms();
        for (i, cfg) in s.prayers.iter().enumerate() {
            tx.execute(
                "INSERT INTO prayer_notifications (prayer, enabled) VALUES (?1, ?2)",
                params![cfg.prayer.key(), cfg.enabled],
            )?;
            for (j, r) in cfg.reminders.iter().enumerate() {
                tx.execute(
                    "INSERT INTO reminders (id, prayer, offset_minutes, enabled, title, message, sound, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        r.id,
                        r.prayer.key(),
                        r.offset_minutes,
                        r.enabled,
                        r.title,
                        r.message,
                        r.sound,
                        now + (i * 100 + j) as i64
                    ],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    // ----- delivered log --------------------------------------------------

    pub fn delivered_ids(&self, since_date: chrono::NaiveDate) -> Result<std::collections::HashSet<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM delivered WHERE prayer_date >= ?1")?;
        let rows = stmt.query_map([since_date.to_string()], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Returns `true` when the id was newly recorded (i.e. not delivered before).
    pub fn mark_delivered(&self, id: &str, prayer_date: chrono::NaiveDate) -> Result<bool> {
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO delivered (id, prayer_date, fired_at) VALUES (?1, ?2, ?3)",
            params![id, prayer_date.to_string(), now_ms()],
        )?;
        Ok(n == 1)
    }

    pub fn prune_delivered(&self, before: chrono::NaiveDate) -> Result<usize> {
        Ok(self
            .conn
            .execute("DELETE FROM delivered WHERE prayer_date < ?1", [before.to_string()])?)
    }
}
