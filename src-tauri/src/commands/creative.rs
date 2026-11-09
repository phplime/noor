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

// ----- Studio › ID / Passport Copy: corners, straighten, clean up -----

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdDetect {
    /// TL, TR, BR, BL — 0..1 of the photo.
    pub corners: mackit_core::docscan::Quad,
    /// false = nothing found; `corners` is a default frame to drag from.
    pub found: bool,
    pub width: u32,
    pub height: u32,
}

/// Find the card's four corners in a photo (iPhone: Apple's Vision first, then our own finder).
#[tauri::command]
pub async fn idscan_detect(state: State<'_, AppState>, path: String) -> CmdResult<IdDetect> {
    let src = PathBuf::from(&path);
    if !src.is_absolute() || !src.is_file() {
        return Err(invalid("expected an image file"));
    }
    let limits = state.limits();
    tauri::async_runtime::spawn_blocking(move || {
        let img = mackit_core::codec::decode_file(&src, &limits).map_err(|e| e.to_payload())?.image;
        let (width, height) = img.dimensions();
        let found = crate::ios_scan::detect(&src).or_else(|| mackit_core::docscan::detect_quad(&img));
        Ok(IdDetect {
            corners: found.map(mackit_core::docscan::order_quad).unwrap_or_else(mackit_core::docscan::default_quad),
            found: found.is_some(),
            width,
            height,
        })
    })
    .await
    .map_err(|e| EngineError::Io(e.to_string()).to_payload())?
}

/// Cut out the card inside `corners`, straighten it to `aspect` (width / height; None = as
/// measured) and, if `enhance`, make it clearer. Writes a JPEG next to Noor's cache and returns its path.
#[tauri::command]
pub async fn idscan_straighten(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
    corners: mackit_core::docscan::Quad,
    aspect: Option<f64>,
    enhance: bool,
) -> CmdResult<String> {
    use tauri::Manager;
    let src = PathBuf::from(&path);
    if !src.is_absolute() || !src.is_file() {
        return Err(invalid("expected an image file"));
    }
    if corners.iter().any(|p| !(-0.05..=1.05).contains(&p.x) || !(-0.05..=1.05).contains(&p.y)) {
        return Err(invalid("corners must be inside the photo"));
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| EngineError::Io(e.to_string()).to_payload())?
        .join("idscan");
    let limits = state.limits();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir).map_err(|e| EngineError::Io(e.to_string()).to_payload())?;
        let img = mackit_core::codec::decode_file(&src, &limits).map_err(|e| e.to_payload())?.image;
        // A hair inside the corners: no sliver of the table along the edges.
        let q = mackit_core::docscan::inset_quad(&mackit_core::docscan::order_quad(corners), 0.012);
        let (w, h) = mackit_core::docscan::output_size(img.width(), img.height(), &q, aspect.filter(|a| *a > 0.1 && *a < 10.0));
        let mut out = mackit_core::docscan::warp(&img, &q, w, h);
        if enhance {
            mackit_core::docscan::enhance(&mut out);
        }
        let opts = mackit_core::codec::EncodeOptions {
            format: ImageFormat::Jpeg,
            quality: 93,
            webp_lossless: false,
            png_optimization: PngOptimization::Off,
            flatten_background: [255, 255, 255],
            icc_profile: None,
        };
        let bytes = encode(&out, &opts).map_err(|e| e.to_payload())?;
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let dest = dir.join(format!("card-{stamp}.jpg"));
        std::fs::write(&dest, bytes).map_err(|e| EngineError::Io(e.to_string()).to_payload())?;
        // Keep the cache small: drop straightened cards older than a day.
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() > 86_400);
                if old {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        Ok(dest.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| EngineError::Io(e.to_string()).to_payload())?
}
