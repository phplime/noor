//! Quick-launch apps: scanning installed `.app` bundles and the pinned list.

use crate::db::{WidgetDb, WidgetError, WidgetResult};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    pub name: String,
    pub path: String,
}

pub const MAX_PINNED: usize = 24;

/// The usual application folders on macOS.
pub fn default_app_dirs(home: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(h) = home {
        dirs.push(h.join("Applications"));
    }
    dirs
}

/// List `.app` bundles directly inside the given folders (plus one level of
/// sub-folders such as "/Applications/Adobe Photoshop 2025"), sorted by name.
pub fn scan_apps(dirs: &[PathBuf]) -> Vec<AppEntry> {
    let mut out: Vec<AppEntry> = Vec::new();
    let mut push = |p: &Path| {
        if let Some(stem) = p.file_stem() {
            out.push(AppEntry {
                name: stem.to_string_lossy().into_owned(),
                path: p.to_string_lossy().into_owned(),
            });
        }
    };
    for dir in dirs {
        let Ok(rd) = std::fs::read_dir(dir) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if is_app(&p) {
                push(&p);
            } else if p.is_dir() && !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) {
                if let Ok(sub) = std::fs::read_dir(&p) {
                    for e in sub.flatten() {
                        if is_app(&e.path()) {
                            push(&e.path());
                        }
                    }
                }
            }
        }
    }
    out.sort_by_key(|a| (a.name.to_lowercase(), a.path.clone()));
    out.dedup_by(|a, b| a.path == b.path);
    out
}

fn is_app(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("app")) && p.is_dir()
}

impl WidgetDb {
    pub fn pinned_apps(&self) -> WidgetResult<Vec<AppEntry>> {
        let mut stmt = self.conn.prepare("SELECT name, path FROM apps ORDER BY position")?;
        let rows = stmt.query_map([], |r| Ok(AppEntry { name: r.get(0)?, path: r.get(1)? }))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn pin_app(&self, app: &AppEntry) -> WidgetResult<()> {
        if !app.path.ends_with(".app") || !Path::new(&app.path).is_absolute() {
            return Err(WidgetError::Invalid("Not an application".into()));
        }
        let count: i64 = self.conn.query_row("SELECT COUNT(*) FROM apps", [], |r| r.get(0))?;
        if count as usize >= MAX_PINNED {
            return Err(WidgetError::Invalid(format!("You can pin up to {MAX_PINNED} apps")));
        }
        self.conn.execute(
            "INSERT INTO apps (path, name, position) VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM apps))
             ON CONFLICT(path) DO NOTHING",
            params![app.path, app.name],
        )?;
        Ok(())
    }

    pub fn unpin_app(&self, path: &str) -> WidgetResult<()> {
        self.conn.execute("DELETE FROM apps WHERE path = ?1", [path])?;
        Ok(())
    }

    pub fn reorder_apps(&mut self, paths: &[String]) -> WidgetResult<()> {
        let tx = self.conn.transaction()?;
        for (i, p) in paths.iter().enumerate() {
            tx.execute("UPDATE apps SET position = ?2 WHERE path = ?1", params![p, i as i64 + 1])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// First run: pin a few common apps that exist on this Mac.
    pub fn seed_apps(&self, installed: &[AppEntry]) -> WidgetResult<()> {
        let seeded: Option<bool> = self.get_json("apps.seeded")?;
        if seeded.is_some() {
            return Ok(());
        }
        for wanted in ["Safari", "Finder", "Mail", "Notes", "Calendar", "Music", "Photos", "System Settings"] {
            if let Some(a) = installed.iter().find(|a| a.name == wanted) {
                let _ = self.pin_app(a);
            }
        }
        self.set_json("apps.seeded", &true)
    }
}
