//! Notes, collage export and saving canvas-rendered images (Facebook post cards).

use crate::notes::Note;
use crate::state::AppState;
use mackit_core::codec::{encode, probe_bytes, ImageFormat, PngOptimization};
use mackit_core::collage::{render_collage, CollageSpec};
use mackit_core::export::{write_output, ConflictPolicy, WriteResult};
use mackit_core::{EngineError, ErrorPayload};
use std::path::{Path, PathBuf};
use tauri::State;

type CmdResult<T> = Result<T, ErrorPayload>;

fn invalid(m: impl Into<String>) -> ErrorPayload {
    EngineError::InvalidInput(m.into()).to_payload()
}

#[tauri::command]
pub fn notes_load(state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    state.notes.load()
}

#[tauri::command]
pub fn notes_save(state: State<'_, AppState>, notes: Vec<Note>) -> Result<(), String> {
    state.notes.save(&notes)
}

/// Validate a destination chosen in the Save dialog and pick its format from the extension.
fn checked_destination(path: &str) -> CmdResult<(PathBuf, ImageFormat)> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(invalid("the destination must be an absolute path"));
    }
    if !p.parent().is_some_and(Path::is_dir) {
        return Err(invalid("the destination folder does not exist"));
    }
    let fmt = ImageFormat::from_path(&p)
        .filter(|f| matches!(f, ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::Webp));
    let fmt = fmt.ok_or_else(|| invalid("save as .png, .jpg or .webp"))?;
    Ok((p, fmt))
}

fn write_replacing(
    dest: &Path,
    bytes: &[u8],
    fmt: ImageFormat,
    w: u32,
    h: u32,
) -> CmdResult<WriteResult> {
    // The macOS Save dialog already asked before replacing an existing file. The
    // destination is never one of the source photos' paths because those are
    // passed separately and checked below by the callers.
    write_output(
        dest,
        bytes,
        (fmt, w, h),
        ConflictPolicy::Replace,
        Path::new("/nonexistent-source"),
        false,
    )
    .map_err(|e| e.to_payload())
}

#[tauri::command]
pub async fn export_collage(
    state: State<'_, AppState>,
    spec: CollageSpec,
    path: String,
    quality: u8,
) -> CmdResult<WriteResult> {
    let (dest, fmt) = checked_destination(&path)?;
    if spec.cells.iter().any(|c| Path::new(&c.path) == dest) {
        return Err(EngineError::WouldOverwriteSource(dest).to_payload());
    }
    let limits = state.limits();
    tauri::async_runtime::spawn_blocking(move || {
        let img = render_collage(&spec, &limits).map_err(|e| e.to_payload())?;
        let opts = mackit_core::codec::EncodeOptions {
            format: fmt,
            quality: quality.clamp(1, 100),
            webp_lossless: false,
            png_optimization: PngOptimization::Fast,
            flatten_background: [spec.background.r, spec.background.g, spec.background.b],
            icc_profile: None,
        };
        let bytes = encode(&img, &opts).map_err(|e| e.to_payload())?;
        write_replacing(&dest, &bytes, fmt, img.width(), img.height())
    })
    .await
    .map_err(|e| EngineError::Io(e.to_string()).to_payload())?
}

/// Save an image rendered by the UI (e.g. a Facebook post card drawn on a canvas,
/// which can use macOS fonts and color emoji). The bytes are verified to be a real
/// image of the claimed type before anything is written.
#[tauri::command]
pub fn save_image_bytes(path: String, data_base64: String) -> CmdResult<WriteResult> {
    use base64::Engine;
    let (dest, fmt) = checked_destination(&path)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|_| invalid("the rendered image data is not valid"))?;
    if bytes.len() > 200 * 1024 * 1024 {
        return Err(invalid("image is too large"));
    }
    let (actual, w, h) = probe_bytes(&bytes).map_err(|e| e.to_payload())?;
    if actual != fmt {
        return Err(invalid(format!(
            "the rendered image is {} but the file name ends in .{}",
            actual.label(),
            fmt.extension()
        )));
    }
    write_replacing(&dest, &bytes, fmt, w, h)
}
