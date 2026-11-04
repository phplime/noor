//! Clipboard history (plain text). The macOS watcher lives in the app; this
//! module stores, de-duplicates and trims entries.

use crate::db::{WidgetDb, WidgetResult};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    pub id: i64,
    pub text: String,
    pub created_at: i64,
    pub pinned: bool,
}

/// Longest text kept (larger copies are ignored: logs, whole files…).
pub const MAX_CLIP_BYTES: usize = 64 * 1024;

impl WidgetDb {
    /// Record a copy. Copying the same text again moves it to the top.
    /// Returns `false` when the text was ignored (empty / too large).
    pub fn clip_add(&self, text: &str, max_items: usize) -> WidgetResult<bool> {
        if text.trim().is_empty() || text.len() > MAX_CLIP_BYTES {
            return Ok(false);
        }
        self.conn.execute(
            "INSERT INTO clips (text, created_at, pinned) VALUES (?1, ?2, 0)
             ON CONFLICT(text) DO UPDATE SET created_at = excluded.created_at",
            params![text, crate::now_ms()],
        )?;
        self.clip_trim(max_items)?;
        Ok(true)
    }

    /// Keep the newest `max_items` unpinned entries (pinned ones are always kept).
    pub fn clip_trim(&self, max_items: usize) -> WidgetResult<usize> {
        Ok(self.conn.execute(
            "DELETE FROM clips WHERE pinned = 0 AND id NOT IN (
                 SELECT id FROM clips WHERE pinned = 0 ORDER BY created_at DESC LIMIT ?1)",
            [max_items as i64],
        )?)
    }

    /// Pinned first, then newest. Optional case-insensitive filter.
    pub fn clips(&self, query: &str, limit: usize) -> WidgetResult<Vec<ClipItem>> {
        let like = format!("%{}%", query.trim().replace('%', "\\%").replace('_', "\\_"));
        let mut stmt = self.conn.prepare(
            "SELECT id, text, created_at, pinned FROM clips
             WHERE text LIKE ?1 ESCAPE '\\'
             ORDER BY pinned DESC, created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![like, limit as i64], |r| {
            Ok(ClipItem {
                id: r.get(0)?,
                text: r.get(1)?,
                created_at: r.get(2)?,
                pinned: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn clip(&self, id: i64) -> WidgetResult<Option<ClipItem>> {
        Ok(self.clips("", 10_000)?.into_iter().find(|c| c.id == id))
    }

    pub fn clip_pin(&self, id: i64, pinned: bool) -> WidgetResult<()> {
        self.conn
            .execute("UPDATE clips SET pinned = ?2 WHERE id = ?1", params![id, pinned])?;
        Ok(())
    }

    pub fn clip_delete(&self, id: i64) -> WidgetResult<()> {
        self.conn.execute("DELETE FROM clips WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Remove everything except pinned entries.
    pub fn clip_clear(&self) -> WidgetResult<usize> {
        Ok(self.conn.execute("DELETE FROM clips WHERE pinned = 0", [])?)
    }
}
