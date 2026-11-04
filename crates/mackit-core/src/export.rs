//! The shared export manager: output naming, conflict handling, safe (atomic)
//! writes and post-write verification.

use crate::codec::{probe_file, EncodeOptions, ImageFormat, PngOptimization};
use crate::color::Color;
use crate::error::{EngineError, Result};
use crate::naming::{next_available, output_file_name, safe_relative_dir, NameContext};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutputFormat {
    /// Keep the source format (GIF sources are written as PNG).
    Source,
    Png,
    Jpeg,
    Webp,
    Bmp,
    Tiff,
}

impl OutputFormat {
    pub fn resolve(self, source: ImageFormat) -> ImageFormat {
        match self {
            OutputFormat::Source if source.can_encode() => source,
            OutputFormat::Source => ImageFormat::Png,
            OutputFormat::Png => ImageFormat::Png,
            OutputFormat::Jpeg => ImageFormat::Jpeg,
            OutputFormat::Webp => ImageFormat::Webp,
            OutputFormat::Bmp => ImageFormat::Bmp,
            OutputFormat::Tiff => ImageFormat::Tiff,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    /// Leave the existing file alone and skip this output.
    Skip,
    /// Write to the next free name (`photo-1.png`).
    Rename,
    /// Explicitly replace the existing output file.
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportOptions {
    /// Absolute output folder. `None` writes next to each source file.
    pub output_dir: Option<String>,
    pub format: OutputFormat,
    pub quality: u8,
    pub webp_lossless: bool,
    pub png_optimization: PngOptimization,
    /// Used where transparency cannot be stored (JPEG, BMP).
    pub flatten_background: Color,
    pub filename_template: String,
    pub suffix: String,
    pub conflict: ConflictPolicy,
    /// Recreate the input sub-folder structure inside `output_dir`.
    pub preserve_structure: bool,
    /// The user explicitly allowed replacing source files. Off by default; the UI
    /// asks for confirmation before enabling it.
    pub allow_source_overwrite: bool,
}

impl Default for ExportOptions {
    fn default() -> Self {
        ExportOptions {
            output_dir: None,
            format: OutputFormat::Source,
            quality: 85,
            webp_lossless: false,
            png_optimization: PngOptimization::Fast,
            flatten_background: Color::WHITE,
            filename_template: "{name}{suffix}".into(),
            suffix: "-edited".into(),
            conflict: ConflictPolicy::Rename,
            preserve_structure: true,
            allow_source_overwrite: false,
        }
    }
}

impl ExportOptions {
    pub fn validate(&self) -> Result<()> {
        if !(1..=100).contains(&self.quality) {
            return Err(EngineError::InvalidInput(
                "quality must be between 1 and 100".into(),
            ));
        }
        if let Some(dir) = &self.output_dir {
            let p = Path::new(dir);
            if !p.is_absolute() {
                return Err(EngineError::InvalidInput(
                    "the output folder must be an absolute path".into(),
                ));
            }
            if !p.is_dir() {
                return Err(EngineError::InvalidInput(format!(
                    "the output folder does not exist: {dir}"
                )));
            }
        }
        Ok(())
    }

    pub fn encode_options(&self, format: ImageFormat, icc: Option<Vec<u8>>) -> EncodeOptions {
        let c = self.flatten_background;
        EncodeOptions {
            format,
            quality: self.quality,
            webp_lossless: self.webp_lossless,
            png_optimization: self.png_optimization,
            flatten_background: [c.r, c.g, c.b],
            icc_profile: icc,
        }
    }

    /// Where an output for `source` would be written (before conflict resolution).
    pub fn target_path(
        &self,
        source: &Path,
        rel_dir: Option<&Path>,
        format: ImageFormat,
        out_w: u32,
        out_h: u32,
        index: usize,
    ) -> Result<PathBuf> {
        let stem = source
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("image");
        let ctx = NameContext {
            stem,
            suffix: &self.suffix,
            width: out_w,
            height: out_h,
            index,
            ext: format.extension(),
        };
        let file_name = output_file_name(&self.filename_template, &ctx);
        let dir = match &self.output_dir {
            Some(d) => {
                let mut dir = PathBuf::from(d);
                if self.preserve_structure {
                    if let Some(rel) = rel_dir {
                        let safe = safe_relative_dir(rel).ok_or_else(|| {
                            EngineError::InvalidInput(format!(
                                "unsafe sub-folder path: {}",
                                rel.display()
                            ))
                        })?;
                        dir.push(safe);
                    }
                }
                dir
            }
            None => source.parent().map(Path::to_path_buf).ok_or_else(|| {
                EngineError::InvalidInput("source file has no parent folder".into())
            })?,
        };
        Ok(dir.join(file_name))
    }
}

pub fn same_file(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WriteStatus {
    Written,
    Renamed,
    Replaced,
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: PathBuf,
    pub status: WriteStatus,
    pub bytes: u64,
}

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_path_for(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("output");
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    target.with_file_name(format!(
        ".{name}.mackit-{}-{nanos}-{n}.tmp",
        std::process::id()
    ))
}

/// Removes the temporary file on drop unless disarmed.
struct TempGuard(Option<PathBuf>);
impl Drop for TempGuard {
    fn drop(&mut self) {
        if let Some(p) = self.0.take() {
            let _ = fs::remove_file(p);
        }
    }
}

/// Verify an encoded file on disk really has the expected format and dimensions.
pub fn verify_file(path: &Path, format: ImageFormat, w: u32, h: u32) -> Result<()> {
    let header = probe_file(path)
        .map_err(|e| EngineError::Verification(format!("cannot read back output: {e}")))?;
    if header.format != format {
        return Err(EngineError::Verification(format!(
            "expected a {} file but found {}",
            format.label(),
            header.format.label()
        )));
    }
    if (header.width, header.height) != (w, h) {
        return Err(EngineError::Verification(format!(
            "expected {w}×{h} px but the written file is {}×{} px",
            header.width, header.height
        )));
    }
    Ok(())
}

/// Write `bytes` to `target` safely:
/// 1. write + fsync a hidden temporary file in the same folder,
/// 2. verify its format and pixel dimensions,
/// 3. move it into place without clobbering (unless replacing was explicitly chosen).
///
/// On any failure the temporary file is removed and nothing partial is left behind.
pub fn write_output(
    target: &Path,
    bytes: &[u8],
    expect: (ImageFormat, u32, u32),
    policy: ConflictPolicy,
    source: &Path,
    allow_source_overwrite: bool,
) -> Result<WriteResult> {
    let dir = target
        .parent()
        .ok_or_else(|| EngineError::InvalidInput("output path has no folder".into()))?;
    fs::create_dir_all(dir)?;

    let is_source = same_file(target, source);
    if is_source && !allow_source_overwrite {
        return Err(EngineError::WouldOverwriteSource(target.to_path_buf()));
    }

    let mut final_path = target.to_path_buf();
    let mut status = WriteStatus::Written;
    let replace = is_source || policy == ConflictPolicy::Replace;
    if final_path.exists() && !replace {
        match policy {
            ConflictPolicy::Skip => {
                return Ok(WriteResult {
                    path: final_path,
                    status: WriteStatus::Skipped,
                    bytes: 0,
                });
            }
            ConflictPolicy::Rename => {
                final_path = next_available(&final_path, |p| p.exists());
                status = WriteStatus::Renamed;
            }
            ConflictPolicy::Replace => unreachable!(),
        }
    }

    let tmp = temp_path_for(&final_path);
    let mut guard = TempGuard(Some(tmp.clone()));
    {
        let mut f: File = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    verify_file(&tmp, expect.0, expect.1, expect.2)?;

    if replace {
        let existed = final_path.exists();
        fs::rename(&tmp, &final_path)?;
        guard.0 = None;
        if existed {
            status = WriteStatus::Replaced;
        }
    } else {
        // Atomic no-clobber publish: hard_link fails if the destination exists.
        let mut attempts = 0;
        loop {
            match fs::hard_link(&tmp, &final_path) {
                Ok(()) => break,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    // Raced with another writer.
                    match policy {
                        ConflictPolicy::Skip => {
                            return Ok(WriteResult {
                                path: final_path,
                                status: WriteStatus::Skipped,
                                bytes: 0,
                            })
                        }
                        _ => {
                            attempts += 1;
                            if attempts > 50 {
                                return Err(EngineError::Conflict(final_path));
                            }
                            final_path = next_available(&final_path, |p| p.exists());
                            status = WriteStatus::Renamed;
                        }
                    }
                }
                Err(_) => {
                    // File systems without hard links (e.g. exFAT/FAT drives): best-effort fallback.
                    if final_path.exists() {
                        return Err(EngineError::Conflict(final_path));
                    }
                    fs::rename(&tmp, &final_path)?;
                    guard.0 = None;
                    break;
                }
            }
        }
        // `guard` removes the temporary link name (if still present).
    }
    drop(guard);
    let size = fs::metadata(&final_path)
        .map(|m| m.len())
        .unwrap_or(bytes.len() as u64);
    Ok(WriteResult {
        path: final_path,
        status,
        bytes: size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::{encode, EncodeOptions};
    use image::{Rgba, RgbaImage};

    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let img = RgbaImage::from_pixel(w, h, Rgba([1, 2, 3, 255]));
        encode(
            &img,
            &EncodeOptions {
                format: ImageFormat::Png,
                quality: 90,
                webp_lossless: false,
                png_optimization: PngOptimization::Off,
                flatten_background: [0, 0, 0],
                icc_profile: None,
            },
        )
        .unwrap()
    }

    fn no_temp_files(dir: &Path) -> bool {
        fs::read_dir(dir)
            .unwrap()
            .all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp"))
    }

    #[test]
    fn writes_and_handles_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.png");
        fs::write(&src, png_bytes(4, 4)).unwrap();
        let target = dir.path().join("out.png");
        let bytes = png_bytes(10, 5);
        let exp = (ImageFormat::Png, 10, 5);

        let r = write_output(&target, &bytes, exp, ConflictPolicy::Rename, &src, false).unwrap();
        assert_eq!(r.status, WriteStatus::Written);
        assert_eq!(r.path, target);

        let r = write_output(&target, &bytes, exp, ConflictPolicy::Rename, &src, false).unwrap();
        assert_eq!(r.status, WriteStatus::Renamed);
        assert_eq!(r.path, dir.path().join("out-1.png"));

        let r = write_output(&target, &bytes, exp, ConflictPolicy::Skip, &src, false).unwrap();
        assert_eq!(r.status, WriteStatus::Skipped);

        fs::write(&target, b"old").unwrap();
        let r = write_output(&target, &bytes, exp, ConflictPolicy::Replace, &src, false).unwrap();
        assert_eq!(r.status, WriteStatus::Replaced);
        assert_eq!(fs::read(&target).unwrap(), bytes);
        assert!(no_temp_files(dir.path()));
    }

    #[test]
    fn never_overwrites_source_without_permission() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("photo.png");
        let original = png_bytes(4, 4);
        fs::write(&src, &original).unwrap();
        for policy in [
            ConflictPolicy::Skip,
            ConflictPolicy::Rename,
            ConflictPolicy::Replace,
        ] {
            let err = write_output(
                &src,
                &png_bytes(2, 2),
                (ImageFormat::Png, 2, 2),
                policy,
                &src,
                false,
            )
            .unwrap_err();
            assert!(matches!(err, EngineError::WouldOverwriteSource(_)));
        }
        assert_eq!(fs::read(&src).unwrap(), original);
        // explicit permission
        let r = write_output(
            &src,
            &png_bytes(2, 2),
            (ImageFormat::Png, 2, 2),
            ConflictPolicy::Skip,
            &src,
            true,
        )
        .unwrap();
        assert_eq!(r.status, WriteStatus::Replaced);
    }

    #[test]
    fn verification_failure_leaves_nothing_behind() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("s.png");
        let target = dir.path().join("t.png");
        let err = write_output(
            &target,
            &png_bytes(10, 5),
            (ImageFormat::Png, 11, 5),
            ConflictPolicy::Rename,
            &src,
            false,
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::Verification(_)));
        assert!(!target.exists());
        assert!(no_temp_files(dir.path()));
        let err = write_output(
            &target,
            b"garbage",
            (ImageFormat::Png, 1, 1),
            ConflictPolicy::Rename,
            &src,
            false,
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::Verification(_)));
        assert!(!target.exists());
        assert!(no_temp_files(dir.path()));
    }

    #[test]
    fn target_paths() {
        let dir = tempfile::tempdir().unwrap();
        let mut o = ExportOptions {
            suffix: "-{w}x{h}".into(),
            ..Default::default()
        };
        let src = Path::new("/photos/trip/photo.jpeg");
        let p = o
            .target_path(src, None, ImageFormat::Png, 590, 300, 1)
            .unwrap();
        assert_eq!(p, PathBuf::from("/photos/trip/photo-590x300.png"));
        o.output_dir = Some(dir.path().to_string_lossy().into());
        let p = o
            .target_path(src, Some(Path::new("trip")), ImageFormat::Jpeg, 1, 2, 1)
            .unwrap();
        assert_eq!(p, dir.path().join("trip").join("photo-1x2.jpg"));
        o.preserve_structure = false;
        let p = o
            .target_path(src, Some(Path::new("trip")), ImageFormat::Jpeg, 1, 2, 1)
            .unwrap();
        assert_eq!(p, dir.path().join("photo-1x2.jpg"));
        o.preserve_structure = true;
        assert!(o
            .target_path(src, Some(Path::new("../evil")), ImageFormat::Jpeg, 1, 2, 1)
            .is_err());
    }

    #[test]
    fn validates_options() {
        assert!(ExportOptions::default().validate().is_ok());
        assert!(ExportOptions {
            quality: 0,
            ..Default::default()
        }
        .validate()
        .is_err());
        assert!(ExportOptions {
            output_dir: Some("relative/dir".into()),
            ..Default::default()
        }
        .validate()
        .is_err());
        assert!(ExportOptions {
            output_dir: Some("/definitely/not/here".into()),
            ..Default::default()
        }
        .validate()
        .is_err());
    }

    #[test]
    fn format_resolution() {
        assert_eq!(
            OutputFormat::Source.resolve(ImageFormat::Webp),
            ImageFormat::Webp
        );
        assert_eq!(
            OutputFormat::Source.resolve(ImageFormat::Gif),
            ImageFormat::Png
        );
        assert_eq!(
            OutputFormat::Jpeg.resolve(ImageFormat::Png),
            ImageFormat::Jpeg
        );
    }
}
