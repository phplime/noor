//! Turning user-selected files and folders into a list of importable images.
//! Only file headers are read here, so scanning large folders stays cheap.

use crate::codec::{probe_file, ImageFormat};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    pub path: String,
    pub name: String,
    /// Sub-folder relative to the selected folder (for preserving structure).
    pub rel_dir: Option<String>,
    pub size: u64,
    pub width: u32,
    pub height: u32,
    pub format: ImageFormat,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub files: Vec<ScannedFile>,
    pub skipped: Vec<SkippedFile>,
    /// True if `max_files` was reached and some files were not listed.
    pub truncated: bool,
}

fn is_hidden(p: &Path) -> bool {
    p.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with('.'))
}

pub fn scan_paths(inputs: &[PathBuf], recursive: bool, max_files: usize) -> ScanResult {
    let mut out = ScanResult::default();
    for input in inputs {
        if out.truncated {
            break;
        }
        let meta = match fs::metadata(input) {
            Ok(m) => m,
            Err(e) => {
                out.skipped.push(SkippedFile {
                    path: input.display().to_string(),
                    reason: e.to_string(),
                });
                continue;
            }
        };
        if meta.is_dir() {
            walk(input, input, recursive, max_files, &mut out);
        } else {
            add_file(input, None, meta.len(), max_files, &mut out, true);
        }
    }
    // stable, human-friendly order
    out.files.sort_by(|a, b| {
        (a.rel_dir.as_deref().unwrap_or(""), a.name.to_lowercase())
            .cmp(&(b.rel_dir.as_deref().unwrap_or(""), b.name.to_lowercase()))
    });
    out
}

fn walk(root: &Path, dir: &Path, recursive: bool, max_files: usize, out: &mut ScanResult) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            out.skipped.push(SkippedFile {
                path: dir.display().to_string(),
                reason: e.to_string(),
            });
            return;
        }
    };
    let mut paths: Vec<_> = entries.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    paths.sort();
    for path in paths {
        if out.truncated {
            return;
        }
        if is_hidden(&path) {
            continue;
        }
        // Do not follow symlinked folders (avoids loops and escaping the selection).
        let Ok(lmeta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if lmeta.file_type().is_symlink() {
            match fs::metadata(&path) {
                Ok(m) if m.is_file() => {
                    let rel = rel_dir(root, &path);
                    add_file(&path, rel, m.len(), max_files, out, false);
                }
                _ => {}
            }
            continue;
        }
        if lmeta.is_dir() {
            if recursive {
                walk(root, &path, recursive, max_files, out);
            }
        } else if lmeta.is_file() {
            let rel = rel_dir(root, &path);
            add_file(&path, rel, lmeta.len(), max_files, out, false);
        }
    }
}

fn rel_dir(root: &Path, file: &Path) -> Option<String> {
    let parent = file.parent()?;
    let rel = parent.strip_prefix(root).ok()?;
    let s = rel.to_string_lossy().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn add_file(
    path: &Path,
    rel: Option<String>,
    size: u64,
    max_files: usize,
    out: &mut ScanResult,
    explicit: bool,
) {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if ImageFormat::from_path(path).is_none() {
        // Inside folders, silently ignoring non-images is noisier than helpful except for
        // likely-image formats we cannot read; report those, and everything chosen explicitly.
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let looks_like_image = matches!(
            ext.as_str(),
            "heic"
                | "heif"
                | "avif"
                | "svg"
                | "raw"
                | "cr2"
                | "nef"
                | "arw"
                | "dng"
                | "psd"
                | "ico"
                | "jxl"
        );
        if explicit || looks_like_image {
            out.skipped.push(SkippedFile {
                path: path.display().to_string(),
                reason: if ext.is_empty() {
                    "Not a supported image file".into()
                } else {
                    format!("Unsupported format (.{ext})")
                },
            });
        }
        return;
    }
    if out.files.len() >= max_files {
        out.truncated = true;
        return;
    }
    match probe_file(path) {
        Ok(h) => out.files.push(ScannedFile {
            path: path.display().to_string(),
            name,
            rel_dir: rel,
            size,
            width: h.width,
            height: h.height,
            format: h.format,
        }),
        Err(e) => out.skipped.push(SkippedFile {
            path: path.display().to_string(),
            reason: format!("Unreadable or corrupted image: {e}"),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    #[test]
    fn scans_folders_with_and_without_subfolders() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("sub/deeper")).unwrap();
        RgbaImage::from_pixel(3, 2, Rgba([0, 0, 0, 255]))
            .save(root.join("a.png"))
            .unwrap();
        RgbaImage::from_pixel(5, 4, Rgba([0, 0, 0, 255]))
            .save(root.join("sub/b.png"))
            .unwrap();
        RgbaImage::from_pixel(5, 4, Rgba([0, 0, 0, 255]))
            .save(root.join("sub/deeper/c.png"))
            .unwrap();
        fs::write(root.join("notes.txt"), "hi").unwrap();
        fs::write(root.join("broken.jpg"), "not a jpeg").unwrap();
        fs::write(root.join("photo.heic"), "x").unwrap();
        fs::write(root.join(".hidden.png"), "x").unwrap();

        let r = scan_paths(&[root.to_path_buf()], false, 100);
        assert_eq!(r.files.len(), 1);
        assert_eq!((r.files[0].width, r.files[0].height), (3, 2));
        assert!(r.skipped.iter().any(|s| s.path.ends_with("broken.jpg")));
        assert!(r.skipped.iter().any(|s| s.path.ends_with("photo.heic")));
        assert!(!r.skipped.iter().any(|s| s.path.ends_with("notes.txt")));

        let r = scan_paths(&[root.to_path_buf()], true, 100);
        assert_eq!(r.files.len(), 3);
        let c = r.files.iter().find(|f| f.name == "c.png").unwrap();
        assert_eq!(c.rel_dir.as_deref(), Some("sub/deeper"));

        let r = scan_paths(&[root.to_path_buf()], true, 2);
        assert_eq!(r.files.len(), 2);
        assert!(r.truncated);

        let r = scan_paths(&[root.join("notes.txt")], false, 10);
        assert_eq!(r.files.len(), 0);
        assert_eq!(r.skipped.len(), 1);
    }
}
