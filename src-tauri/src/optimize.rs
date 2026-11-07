//! Settings › Optimize: device health, Photos cleanup (iPhone) and Noor's own junk files.
//! Junk cleanup only ever touches Noor's own sandbox folders, and only the files the user picked.

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JunkFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Unix seconds
    pub modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JunkGroup {
    pub id: String,
    pub label: String,
    pub detail: String,
    /// Safe to remove without asking twice (temporary copies).
    pub safe: bool,
    pub files: Vec<JunkFile>,
}

fn roots(app: &AppHandle) -> Vec<(&'static str, &'static str, &'static str, bool, PathBuf)> {
    let mut out = Vec::new();
    out.push(("temp", "Temporary files", "Left over from imports, previews and exports", true, std::env::temp_dir()));
    if let Ok(cache) = app.path().app_cache_dir() {
        out.push(("imports", "Imported photo copies", "Copies Noor made when you picked photos in Studio", true, cache.join("imports")));
    }
    if let Ok(dir) = crate::commands::app::output_dir(app.clone()) {
        out.push(("exports", "Studio exports", "Images you saved from Studio (Files › On My iPhone › Noor)", false, PathBuf::from(dir)));
    }
    out
}

/// Files under `dir` (recursively), skipping anything touched in the last 10 minutes (may be in use)
/// and system/WebKit folders.
fn walk(dir: &Path, out: &mut Vec<JunkFile>, depth: u32) {
    if depth > 6 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let recent = SystemTime::now() - Duration::from_secs(600);
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.contains("WebKit") || name.contains("com.apple") {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            walk(&p, out, depth + 1);
        } else if meta.is_file() {
            let modified = meta.modified().unwrap_or(UNIX_EPOCH);
            if modified > recent {
                continue;
            }
            out.push(JunkFile {
                path: p.display().to_string(),
                name,
                size: meta.len(),
                modified: modified.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
            });
        }
    }
}

#[tauri::command]
pub async fn optimize_device() -> Value {
    tauri::async_runtime::spawn_blocking(crate::ios_optimize::device).await.unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn optimize_junk_scan(app: AppHandle) -> Vec<JunkGroup> {
    tauri::async_runtime::spawn_blocking(move || {
        roots(&app)
            .into_iter()
            .map(|(id, label, detail, safe, dir)| {
                let mut files = Vec::new();
                walk(&dir, &mut files, 0);
                files.sort_by(|a, b| b.size.cmp(&a.size));
                JunkGroup { id: id.into(), label: label.into(), detail: detail.into(), safe, files }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Delete only the given files, and only if they are inside one of Noor's own folders.
/// Returns the number of bytes freed.
#[tauri::command]
pub async fn optimize_junk_clean(app: AppHandle, paths: Vec<String>) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let allowed: Vec<PathBuf> = roots(&app).into_iter().filter_map(|r| r.4.canonicalize().ok()).collect();
        let mut freed = 0u64;
        for p in paths {
            let Ok(real) = Path::new(&p).canonicalize() else { continue };
            if !real.is_file() || !allowed.iter().any(|root| real.starts_with(root)) {
                continue;
            }
            let size = real.metadata().map(|m| m.len()).unwrap_or(0);
            if std::fs::remove_file(&real).is_ok() {
                freed += size;
            }
        }
        Ok(freed)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn optimize_photos_scan(part: String) -> Value {
    tauri::async_runtime::spawn_blocking(move || crate::ios_optimize::photos_scan(&part)).await.unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn optimize_photos_delete(ids: Vec<String>) -> String {
    tauri::async_runtime::spawn_blocking(move || crate::ios_optimize::photos_delete(&ids))
        .await
        .unwrap_or_else(|e| e.to_string())
}
