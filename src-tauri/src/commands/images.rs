//! Image commands. Every heavy call runs on a blocking worker thread so the
//! webview and IPC stay responsive.

use crate::state::AppState;
use mackit_core::batch::{self, BatchEvent, BatchJob, Preflight};
use mackit_core::ops::{plan_pipeline, Operation, PipelinePlan};
use mackit_core::preview::{PreviewResult, Thumbnail};
use mackit_core::scan::{scan_paths, ScanResult};
use mackit_core::{EngineError, ErrorPayload};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

type CmdResult<T> = Result<T, ErrorPayload>;

const MAX_SCAN_FILES: usize = 5_000;
const BATCH_EVENT: &str = "batch-event";

fn invalid(msg: impl Into<String>) -> ErrorPayload {
    EngineError::InvalidInput(msg.into()).to_payload()
}

/// Only absolute paths to existing regular files are accepted.
fn checked_file(p: &str) -> CmdResult<PathBuf> {
    let path = PathBuf::from(p);
    if !path.is_absolute() {
        return Err(invalid("expected an absolute file path"));
    }
    if !path.is_file() {
        return Err(EngineError::Io(format!("file not found: {p}")).to_payload());
    }
    Ok(path)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> CmdResult<T> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| EngineError::Io(format!("background task failed: {e}")).to_payload())?
}

#[tauri::command]
pub async fn scan_inputs(paths: Vec<String>, recursive: bool) -> CmdResult<ScanResult> {
    let paths: Vec<PathBuf> = paths
        .into_iter()
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .collect();
    blocking(move || Ok(scan_paths(&paths, recursive, MAX_SCAN_FILES))).await
}

#[tauri::command]
pub async fn thumbnail(
    state: State<'_, AppState>,
    path: String,
    size: Option<u32>,
) -> CmdResult<Thumbnail> {
    let path = checked_file(&path)?;
    let cache = state.previews.clone();
    let limits = state.limits();
    let size = size.unwrap_or(160).clamp(32, 1024);
    blocking(move || {
        cache
            .thumbnail(&path, size, &limits)
            .map_err(|e| e.to_payload())
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRequest {
    pub path: String,
    pub operations: Vec<Operation>,
    #[serde(default)]
    pub max_side: Option<u32>,
}

#[tauri::command]
pub async fn render_preview(
    state: State<'_, AppState>,
    request: PreviewRequest,
) -> CmdResult<PreviewResult> {
    let path = checked_file(&request.path)?;
    let cache = state.previews.clone();
    let limits = state.limits();
    let max_side = request.max_side.unwrap_or(1400).clamp(64, 4096);
    blocking(move || {
        cache
            .render(&path, &request.operations, &limits, max_side)
            .map_err(|e| e.to_payload())
    })
    .await
}

/// Output dimensions for given source dimensions, without decoding anything.
#[tauri::command]
pub fn plan_operations(
    state: State<'_, AppState>,
    width: u32,
    height: u32,
    operations: Vec<Operation>,
) -> CmdResult<PipelinePlan> {
    plan_pipeline(width, height, &operations, &state.limits()).map_err(|e| e.to_payload())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasureRequest {
    pub path: String,
    pub operations: Vec<Operation>,
    pub export: mackit_core::export::ExportOptions,
}

/// Encode one image in memory with the real export settings and return the exact
/// output size. Nothing is written to disk.
#[tauri::command]
pub async fn measure_output(
    state: State<'_, AppState>,
    request: MeasureRequest,
) -> CmdResult<batch::Measured> {
    let path = checked_file(&request.path)?;
    let limits = state.limits();
    blocking(move || {
        batch::measure_output(&path, &request.operations, &request.export, &limits)
            .map_err(|e| e.to_payload())
    })
    .await
}

#[tauri::command]
pub async fn preflight_batch(state: State<'_, AppState>, job: BatchJob) -> CmdResult<Preflight> {
    let job = sanitize_job(job, &state)?;
    blocking(move || batch::preflight(&job).map_err(|e| e.to_payload())).await
}

fn sanitize_job(mut job: BatchJob, state: &AppState) -> CmdResult<BatchJob> {
    if job.items.is_empty() {
        return Err(invalid("there are no files to process"));
    }
    for item in &job.items {
        if !Path::new(&item.path).is_absolute() {
            return Err(invalid("input paths must be absolute"));
        }
    }
    job.limits = state.limits();
    job.concurrency = state.concurrency();
    Ok(job)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchEventPayload {
    job_id: String,
    event: BatchEvent,
}

/// Start a batch in the background. Progress arrives as `batch-event` events.
#[tauri::command]
pub fn start_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    job: BatchJob,
) -> CmdResult<()> {
    if job_id.is_empty() || job_id.len() > 64 {
        return Err(invalid("invalid job id"));
    }
    let job = sanitize_job(job, &state)?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = state.jobs.lock().unwrap();
        if jobs.contains_key(&job_id) {
            return Err(invalid("a job with this id is already running"));
        }
        jobs.insert(job_id.clone(), cancel.clone());
    }
    let jobs = state.jobs.clone();
    std::thread::Builder::new()
        .name(format!("mackit-batch-{job_id}"))
        .spawn(move || {
            let emit = |event: BatchEvent| {
                let _ = app.emit(
                    BATCH_EVENT,
                    BatchEventPayload {
                        job_id: job_id.clone(),
                        event,
                    },
                );
            };
            batch::run(&job, &cancel, &emit);
            jobs.lock().unwrap().remove(&job_id);
        })
        .map_err(|e| EngineError::Io(e.to_string()).to_payload())?;
    Ok(())
}

#[tauri::command]
pub fn cancel_batch(state: State<'_, AppState>, job_id: String) -> bool {
    match state.jobs.lock().unwrap().get(&job_id) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathCheck {
    pub exists: bool,
    pub is_dir: bool,
}

#[tauri::command]
pub fn check_path(path: String) -> PathCheck {
    let p = Path::new(&path);
    PathCheck {
        exists: p.is_absolute() && p.exists(),
        is_dir: p.is_absolute() && p.is_dir(),
    }
}

#[tauri::command]
pub fn clear_preview_cache(state: State<'_, AppState>) {
    state.previews.clear();
}

/// Android: the photo picker hands the web view file *contents* (no real path).
/// Store them in the app's cache so the engine can open them like any file.
/// Body: the raw bytes; header `x-name`: the original file name (URI-encoded).
#[tauri::command]
pub async fn import_image(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    use tauri::Manager;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected image bytes".into());
    };
    if bytes.is_empty() || bytes.len() > 80 * 1024 * 1024 {
        return Err("This image is empty or too large (80 MB max).".into());
    }
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(|s| percent_decode(s))
        .unwrap_or_else(|| "image.jpg".into());
    // Keep a safe file name; make it unique so two "IMG_0001.jpg" don't clash.
    let clean: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' })
        .collect();
    let clean = if clean.contains('.') { clean } else { format!("{clean}.jpg") };
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("imports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = dir.join(format!("{stamp}-{clean}"));
    let data = bytes.clone();
    let out = path.clone();
    tauri::async_runtime::spawn_blocking(move || std::fs::write(&out, &data))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Could not save the image: {e}"))?;
    Ok(path.display().to_string())
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
