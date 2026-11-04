//! Local notes storage: one JSON file, written atomically. Development builds keep it in
//! `<project>/data/notes.json`; packaged builds use the app's Application Support folder
//! (see [`notes_dir`]).
//! Note bodies are HTML produced by the editor; the frontend sanitizes on load and
//! save, and nothing here ever interprets it.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Generous cap so a pasted image or huge paste can't make the file unmanageable.
pub const MAX_TOTAL_BYTES: usize = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub html: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub color: Option<String>,
    pub created: i64,
    pub updated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NotesFile {
    version: u32,
    notes: Vec<Note>,
}

pub struct NotesStore {
    path: PathBuf,
}

impl NotesStore {
    pub fn new(config_dir: PathBuf) -> Self {
        NotesStore {
            path: config_dir.join("notes.json"),
        }
    }

    pub fn load(&self) -> Result<Vec<Note>, String> {
        let raw = match fs::read_to_string(&self.path) {
            Ok(r) => r,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.to_string()),
        };
        match serde_json::from_str::<NotesFile>(&raw) {
            Ok(f) => Ok(f.notes),
            Err(e) => {
                // Keep the unreadable file for recovery instead of overwriting it.
                let backup = self
                    .path
                    .with_extension(format!("json.corrupt-{}", chrono_like_now()));
                let _ = fs::copy(&self.path, &backup);
                Err(format!(
                    "The notes file could not be read ({e}). A backup was kept at {}",
                    backup.display()
                ))
            }
        }
    }

    pub fn save(&self, notes: &[Note]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&NotesFile {
            version: 1,
            notes: notes.to_vec(),
        })
        .map_err(|e| e.to_string())?;
        if json.len() > MAX_TOTAL_BYTES {
            return Err("Notes are too large to save (limit 20 MB). Remove some content.".into());
        }
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }
}

/// Folder that holds `notes.json`.
///
/// * Debug builds (`npm run app:dev`): `<project>/data/`, so notes live with the project.
///   On first use, notes already saved in `config_dir` are copied over once.
/// * Release builds (`npm run app:build`): `config_dir`, i.e.
///   `~/Library/Application Support/<identifier>/`. A packaged app is installed in
///   /Applications and must not write inside its own signed bundle.
pub fn notes_dir(config_dir: &Path) -> PathBuf {
    // Only on the Mac: an iPhone (or the Simulator's sandbox) can't reach the project folder.
    if cfg!(debug_assertions) && cfg!(target_os = "macos") {
        if let Some(project) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
            let dev = project.join("data");
            let (old, new) = (config_dir.join("notes.json"), dev.join("notes.json"));
            if !new.exists() && old.is_file() {
                if let Err(e) = fs::create_dir_all(&dev).and_then(|_| fs::copy(&old, &new)) {
                    eprintln!(
                        "MacKit: could not copy existing notes to {}: {e}",
                        new.display()
                    );
                }
            }
            return dev;
        }
    }
    config_dir.to_path_buf()
}

fn chrono_like_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str) -> Note {
        Note {
            id: id.into(),
            title: "Hi 👋".into(),
            html: "<p><b>bold</b> ✅</p>".into(),
            pinned: false,
            color: None,
            created: 1,
            updated: 2,
        }
    }

    #[test]
    fn round_trip_with_emoji() {
        let dir = tempfile::tempdir().unwrap();
        let s = NotesStore::new(dir.path().to_path_buf());
        assert!(s.load().unwrap().is_empty());
        s.save(&[note("a"), note("b")]).unwrap();
        let back = s.load().unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].title, "Hi 👋");
    }

    #[test]
    fn corrupt_file_is_kept_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let s = NotesStore::new(dir.path().to_path_buf());
        fs::write(dir.path().join("notes.json"), "{broken").unwrap();
        assert!(s.load().is_err());
        assert!(fs::read_dir(dir.path()).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("corrupt")));
    }
}
