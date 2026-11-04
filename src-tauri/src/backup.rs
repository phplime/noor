//! Backup and restore: one JSON file holding a consistent copy of the SQLite
//! database (prayer engine + widgets), the config-dir files (settings, notes) and
//! the web view's local preferences.

use crate::island_state::IslandState;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use nexa_prayer::{PrayerService, Store};
use nexa_widgets::WidgetDb;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager, State};

pub const FORMAT: &str = "noor-backup";
pub const VERSION: u32 = 1;
const MAX_FILE: u64 = 20 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub format: String,
    pub version: u32,
    pub created_at: String,
    pub app_version: String,
    /// The SQLite database, base64.
    pub db: String,
    /// Config-dir files by relative path ("/"-separated), base64.
    #[serde(default)]
    pub files: BTreeMap<String, String>,
    /// Web view localStorage.
    #[serde(default)]
    pub local: Map<String, Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub file_name: String,
    pub bytes: u64,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("noor.sqlite"))
}

/// A relative path that stays inside its root (no `..`, no absolute parts).
pub fn safe_rel(rel: &str) -> Option<PathBuf> {
    let p = Path::new(rel);
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => out.push(s),
            _ => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

fn collect_files(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            collect_files(root, &p, out);
        } else if meta.is_file() && meta.len() <= MAX_FILE {
            if let (Ok(rel), Ok(bytes)) = (p.strip_prefix(root), fs::read(&p)) {
                let key = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
                out.insert(key, B64.encode(bytes));
            }
        }
    }
}

pub fn parse(json: &str) -> Result<Bundle, String> {
    let b: Bundle = serde_json::from_str(json).map_err(|_| "This isn't a Noor backup file.".to_string())?;
    if b.format != FORMAT {
        return Err("This isn't a Noor backup file.".into());
    }
    if b.version > VERSION {
        return Err("This backup was made by a newer Noor. Update the app first.".into());
    }
    Ok(b)
}

/// Make a backup file. On iPhone it goes to a temporary folder (the share sheet
/// saves it); elsewhere into Downloads.
#[tauri::command]
pub fn backup_export(app: AppHandle, island: State<'_, IslandState>, local: Map<String, Value>) -> Result<BackupInfo, String> {
    let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let snap = tmp.path().join("db.sqlite");
    island.wdb.lock().map_err(|_| "busy")?.snapshot_to(&snap).map_err(|e| e.to_string())?;
    let db = fs::read(&snap).map_err(|e| e.to_string())?;

    let mut files = BTreeMap::new();
    if let Ok(cfg) = app.path().app_config_dir() {
        collect_files(&cfg, &cfg, &mut files);
    }

    let now = chrono::Local::now();
    let bundle = Bundle {
        format: FORMAT.into(),
        version: VERSION,
        created_at: now.to_rfc3339(),
        app_version: app.package_info().version.to_string(),
        db: B64.encode(db),
        files,
        local,
    };
    let file_name = format!("Noor-backup-{}.json", now.format("%Y-%m-%d-%H%M"));
    #[cfg(any(target_os = "ios", target_os = "android"))]
    let dir = app.path().temp_dir().map_err(|e| e.to_string())?.join("noor-backup");
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&file_name);
    let text = serde_json::to_vec(&bundle).map_err(|e| e.to_string())?;
    fs::write(&path, &text).map_err(|e| e.to_string())?;
    Ok(BackupInfo { path: path.to_string_lossy().into_owned(), file_name, bytes: text.len() as u64 })
}

/// Replace all Noor data with a backup. Returns the saved local preferences for
/// the web view to put back. The previous database is kept as `noor.sqlite.bak`.
#[tauri::command]
pub fn backup_import(app: AppHandle, island: State<'_, IslandState>, json: String) -> Result<Map<String, Value>, String> {
    let bundle = parse(&json)?;
    let bytes = B64.decode(bundle.db.as_bytes()).map_err(|_| "The backup file is damaged.".to_string())?;

    // Check the database opens before touching anything.
    let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let incoming = tmp.path().join("incoming.sqlite");
    fs::write(&incoming, &bytes).map_err(|e| e.to_string())?;
    {
        WidgetDb::open(&incoming).map_err(|e| format!("The backup database can't be read: {e}"))?;
        Store::open(&incoming).map_err(|e| format!("The backup database can't be read: {e}"))?;
    }

    let db = db_path(&app)?;
    let tz = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into());
    {
        let mut svc = island.svc.lock().map_err(|_| "busy")?;
        let mut wdb = island.wdb.lock().map_err(|_| "busy")?;
        // Close the real connections (SQLite checkpoints the WAL on close).
        *svc = PrayerService::new(Store::open_in_memory().map_err(|e| e.to_string())?, &tz).map_err(|e| e.to_string())?;
        *wdb = WidgetDb::open_in_memory().map_err(|e| e.to_string())?;

        let bak = db.with_extension("sqlite.bak");
        let side = |ext: &str| PathBuf::from(format!("{}{ext}", db.display()));
        let _ = fs::remove_file(&bak);
        let had_old = db.exists();
        if had_old {
            fs::rename(&db, &bak).map_err(|e| e.to_string())?;
        }
        let _ = fs::remove_file(side("-wal"));
        let _ = fs::remove_file(side("-shm"));

        let reopen = |path: &Path| -> Result<(PrayerService, WidgetDb), String> {
            let s = PrayerService::new(Store::open(path).map_err(|e| e.to_string())?, &tz).map_err(|e| e.to_string())?;
            let w = WidgetDb::open(path).map_err(|e| e.to_string())?;
            Ok((s, w))
        };
        let swapped = fs::copy(&incoming, &db).map_err(|e| e.to_string()).and_then(|_| reopen(&db));
        match swapped {
            Ok((s, w)) => {
                *svc = s;
                *wdb = w;
            }
            Err(e) => {
                // Put the old database back.
                let _ = fs::remove_file(&db);
                if had_old {
                    let _ = fs::rename(&bak, &db);
                }
                if let Ok((s, w)) = reopen(&db) {
                    *svc = s;
                    *wdb = w;
                }
                return Err(format!("Restore failed, nothing was changed: {e}"));
            }
        }
    }

    // Settings and notes.
    if let Ok(cfg) = app.path().app_config_dir() {
        for (rel, data) in &bundle.files {
            let (Some(rel), Ok(bytes)) = (safe_rel(rel), B64.decode(data.as_bytes())) else { continue };
            let path = cfg.join(rel);
            if let Some(dir) = path.parent() {
                let _ = fs::create_dir_all(dir);
            }
            let _ = fs::write(path, bytes);
        }
    }

    island.refresh_scheduler();
    Ok(bundle.local)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_outside_the_root() {
        assert!(safe_rel("../etc/passwd").is_none());
        assert!(safe_rel("/abs").is_none());
        assert!(safe_rel("").is_none());
        assert_eq!(safe_rel("notes/a.md"), Some(PathBuf::from("notes/a.md")));
    }

    #[test]
    fn parses_only_noor_backups() {
        assert!(parse("{}").is_err());
        assert!(parse(r#"{"format":"x","version":1,"createdAt":"","appVersion":"","db":""}"#).is_err());
        assert!(parse(r#"{"format":"noor-backup","version":99,"createdAt":"","appVersion":"","db":""}"#).is_err());
        let b = parse(r#"{"format":"noor-backup","version":1,"createdAt":"","appVersion":"","db":"","local":{"noor.theme":"dark"}}"#).unwrap();
        assert_eq!(b.local.get("noor.theme").and_then(|v| v.as_str()), Some("dark"));
    }

    #[test]
    fn snapshot_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.sqlite");
        let w = WidgetDb::open(&src).unwrap();
        w.seed_clocks().unwrap();
        let out = dir.path().join("b.sqlite");
        w.snapshot_to(&out).unwrap();
        assert!(WidgetDb::open(&out).is_ok());
        assert!(Store::open(&out).is_ok());
    }
}
