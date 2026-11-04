//! The shelf: files dropped onto the island, kept as references (never copied).

use crate::db::{WidgetDb, WidgetResult};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub id: String,
    pub path: String,
    pub name: String,
    /// Lower-case extension without the dot ("" for none / folders).
    pub ext: String,
    pub size: i64,
    pub is_dir: bool,
    pub added_at: i64,
    /// False when the file was moved or deleted since it was shelved.
    pub exists: bool,
}

pub const MAX_SHELF_ITEMS: usize = 60;

impl WidgetDb {
    /// Add files/folders (absolute paths). Existing entries move to the end.
    /// Returns the number of new or refreshed items.
    pub fn shelf_add(&self, paths: &[String]) -> WidgetResult<usize> {
        let mut n = 0;
        for p in paths {
            let path = Path::new(p);
            if !path.is_absolute() {
                continue;
            }
            let Ok(meta) = std::fs::metadata(path) else { continue };
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.clone());
            let ext = if meta.is_dir() {
                String::new()
            } else {
                path.extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default()
            };
            let size = if meta.is_dir() { 0 } else { meta.len() as i64 };
            self.conn.execute(
                "INSERT INTO shelf (id, path, name, ext, size, is_dir, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(path) DO UPDATE SET name = excluded.name, ext = excluded.ext,
                     size = excluded.size, is_dir = excluded.is_dir, added_at = excluded.added_at",
                params![uuid::Uuid::new_v4().to_string(), p, name, ext, size, meta.is_dir(), crate::now_ms()],
            )?;
            n += 1;
        }
        // Keep the newest items only.
        self.conn.execute(
            "DELETE FROM shelf WHERE id NOT IN (SELECT id FROM shelf ORDER BY added_at DESC LIMIT ?1)",
            [MAX_SHELF_ITEMS as i64],
        )?;
        Ok(n)
    }

    pub fn shelf(&self) -> WidgetResult<Vec<ShelfItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, ext, size, is_dir, added_at FROM shelf ORDER BY added_at ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            let path: String = r.get(1)?;
            Ok(ShelfItem {
                id: r.get(0)?,
                exists: Path::new(&path).exists(),
                path,
                name: r.get(2)?,
                ext: r.get(3)?,
                size: r.get(4)?,
                is_dir: r.get(5)?,
                added_at: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn shelf_item(&self, id: &str) -> WidgetResult<Option<ShelfItem>> {
        Ok(self.shelf()?.into_iter().find(|s| s.id == id))
    }

    pub fn shelf_remove(&self, id: &str) -> WidgetResult<()> {
        self.conn.execute("DELETE FROM shelf WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn shelf_clear(&self) -> WidgetResult<usize> {
        Ok(self.conn.execute("DELETE FROM shelf", [])?)
    }
}
