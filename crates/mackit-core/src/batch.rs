//! Batch processing used by every tool (a single export is a batch of one).
//!
//! Files are processed incrementally by a small worker pool: each worker holds at
//! most one decoded image at a time, so memory stays bounded regardless of how
//! many files are queued. A failure in one file never stops the batch.

use crate::codec::{decode_file, encode, probe_file, ImageFormat};
use crate::error::{EngineError, ErrorPayload, Result};
use crate::export::{same_file, write_output, ExportOptions, WriteStatus};
use crate::geometry::Limits;
use crate::naming::next_available;
use crate::ops::{apply, plan_pipeline, Operation, Raster, Resources};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItem {
    pub path: String,
    #[serde(default)]
    pub rel_dir: Option<String>,
    /// Per-image operations replacing the job's (e.g. subjects picked and brush
    /// strokes painted on this particular photo). `None` = use the job's.
    #[serde(default)]
    pub operations: Option<Vec<Operation>>,
}

impl BatchJob {
    /// The operations used for one item.
    pub fn operations_for<'a>(&'a self, item: &'a BatchItem) -> &'a [Operation] {
        item.operations.as_deref().unwrap_or(&self.operations)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchJob {
    pub items: Vec<BatchItem>,
    pub operations: Vec<Operation>,
    pub export: ExportOptions,
    #[serde(default)]
    pub limits: Limits,
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
}

fn default_concurrency() -> usize {
    2
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ItemStatus {
    Processing,
    Done,
    Skipped,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemUpdate {
    pub index: usize,
    pub path: String,
    pub status: ItemStatus,
    pub output_path: Option<String>,
    /// Actual dimensions read back from the written file.
    pub output_w: Option<u32>,
    pub output_h: Option<u32>,
    pub output_format: Option<ImageFormat>,
    pub input_bytes: u64,
    /// Actual size of the written file.
    pub output_bytes: Option<u64>,
    pub renamed: bool,
    pub replaced: bool,
    pub message: Option<String>,
    pub error: Option<ErrorPayload>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatchSummary {
    pub total: usize,
    pub succeeded: usize,
    pub skipped: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub was_cancelled: bool,
    pub input_bytes: u64,
    pub output_bytes: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BatchEvent {
    Item(ItemUpdate),
    Finished(BatchSummary),
}

/// What will happen to each item, computed before anything is written.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightItem {
    pub index: usize,
    pub path: String,
    pub output_path: Option<String>,
    pub output_w: u32,
    pub output_h: u32,
    pub output_format: Option<ImageFormat>,
    /// A file already exists at the output path.
    pub exists: bool,
    /// The output path is the source file itself.
    pub is_source: bool,
    /// Another item in this batch maps to the same name; it was given a unique one.
    pub deduplicated: bool,
    pub error: Option<ErrorPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preflight {
    pub items: Vec<PreflightItem>,
    pub conflicts: usize,
    pub source_overwrites: usize,
    pub errors: usize,
}

struct Planned {
    target: Option<PathBuf>,
    format: Option<ImageFormat>,
    out_w: u32,
    out_h: u32,
    error: Option<EngineError>,
    deduplicated: bool,
}

fn plan_items(job: &BatchJob) -> Vec<Planned> {
    let mut claimed: HashSet<PathBuf> = HashSet::new();
    job.items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let path = Path::new(&item.path);
            let planned = (|| -> Result<(PathBuf, ImageFormat, u32, u32)> {
                let header = probe_file(path)?;
                let plan = plan_pipeline(
                    header.width,
                    header.height,
                    job.operations_for(item),
                    &job.limits,
                )?;
                let format = job.export.format.resolve(header.format);
                let rel = item.rel_dir.as_deref().map(Path::new);
                let target = job.export.target_path(
                    path,
                    rel,
                    format,
                    plan.output_w,
                    plan.output_h,
                    i + 1,
                )?;
                Ok((target, format, plan.output_w, plan.output_h))
            })();
            match planned {
                Ok((target, format, w, h)) => {
                    let mut deduplicated = false;
                    let target = if claimed.contains(&target) {
                        deduplicated = true;
                        next_available(&target, |p| claimed.contains(p))
                    } else {
                        target
                    };
                    claimed.insert(target.clone());
                    Planned {
                        target: Some(target),
                        format: Some(format),
                        out_w: w,
                        out_h: h,
                        error: None,
                        deduplicated,
                    }
                }
                Err(e) => Planned {
                    target: None,
                    format: None,
                    out_w: 0,
                    out_h: 0,
                    error: Some(e),
                    deduplicated: false,
                },
            }
        })
        .collect()
}

pub fn preflight(job: &BatchJob) -> Result<Preflight> {
    job.export.validate()?;
    let planned = plan_items(job);
    let items: Vec<PreflightItem> = planned
        .into_iter()
        .enumerate()
        .map(|(i, p)| {
            let src = Path::new(&job.items[i].path);
            let exists = p.target.as_ref().is_some_and(|t| t.exists());
            let is_source = p.target.as_ref().is_some_and(|t| same_file(t, src));
            PreflightItem {
                index: i,
                path: job.items[i].path.clone(),
                output_path: p.target.map(|t| t.display().to_string()),
                output_w: p.out_w,
                output_h: p.out_h,
                output_format: p.format,
                exists,
                is_source,
                deduplicated: p.deduplicated,
                error: p.error.map(|e| e.to_payload()),
            }
        })
        .collect();
    Ok(Preflight {
        conflicts: items.iter().filter(|i| i.exists && !i.is_source).count(),
        source_overwrites: items.iter().filter(|i| i.is_source).count(),
        errors: items.iter().filter(|i| i.error.is_some()).count(),
        items,
    })
}

fn base_update(index: usize, item: &BatchItem, status: ItemStatus) -> ItemUpdate {
    ItemUpdate {
        index,
        path: item.path.clone(),
        status,
        output_path: None,
        output_w: None,
        output_h: None,
        output_format: None,
        input_bytes: std::fs::metadata(&item.path).map(|m| m.len()).unwrap_or(0),
        output_bytes: None,
        renamed: false,
        replaced: false,
        message: None,
        error: None,
    }
}

/// Run a batch. `on_event` is called from worker threads.
pub fn run(
    job: &BatchJob,
    cancel: &AtomicBool,
    on_event: &(dyn Fn(BatchEvent) + Sync),
) -> BatchSummary {
    let started = Instant::now();
    let total = job.items.len();
    let fail_all = |e: EngineError| {
        let mut s = BatchSummary {
            total,
            failed: total,
            ..Default::default()
        };
        for (i, item) in job.items.iter().enumerate() {
            let mut u = base_update(i, item, ItemStatus::Failed);
            u.message = Some(e.to_string());
            u.error = Some(e.to_payload());
            s.input_bytes += u.input_bytes;
            on_event(BatchEvent::Item(u));
        }
        s.elapsed_ms = started.elapsed().as_millis() as u64;
        on_event(BatchEvent::Finished(s.clone()));
        s
    };
    if let Err(e) = job
        .export
        .validate()
        .and_then(|_| crate::ops::validate(&job.operations))
        .and_then(|_| {
            job.items
                .iter()
                .filter_map(|i| i.operations.as_deref())
                .try_for_each(crate::ops::validate)
        })
    {
        return fail_all(e);
    }
    let all_ops: Vec<Operation> = job
        .operations
        .iter()
        .chain(
            job.items
                .iter()
                .filter_map(|i| i.operations.as_ref())
                .flatten(),
        )
        .cloned()
        .collect();
    let resources = match Resources::load(&all_ops, &job.limits) {
        Ok(r) => r,
        Err(e) => return fail_all(e),
    };
    let planned = plan_items(job);

    let next = AtomicUsize::new(0);
    let results: std::sync::Mutex<Vec<Option<ItemUpdate>>> =
        std::sync::Mutex::new(vec![None; total]);
    let workers = job.concurrency.clamp(1, 8).min(total.max(1));

    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= total {
                    break;
                }
                let item = &job.items[i];
                let update = if cancel.load(Ordering::SeqCst) {
                    base_update(i, item, ItemStatus::Cancelled)
                } else {
                    on_event(BatchEvent::Item(base_update(
                        i,
                        item,
                        ItemStatus::Processing,
                    )));
                    process_item(i, item, &planned[i], job, &resources, cancel)
                };
                on_event(BatchEvent::Item(update.clone()));
                results.lock().unwrap()[i] = Some(update);
            });
        }
    });

    let mut summary = BatchSummary {
        total,
        was_cancelled: cancel.load(Ordering::SeqCst),
        ..Default::default()
    };
    for u in results.into_inner().unwrap().into_iter().flatten() {
        summary.input_bytes += u.input_bytes;
        match u.status {
            ItemStatus::Done => {
                summary.succeeded += 1;
                summary.output_bytes += u.output_bytes.unwrap_or(0);
            }
            ItemStatus::Skipped => summary.skipped += 1,
            ItemStatus::Failed => summary.failed += 1,
            ItemStatus::Cancelled => summary.cancelled += 1,
            ItemStatus::Processing => {}
        }
    }
    summary.elapsed_ms = started.elapsed().as_millis() as u64;
    on_event(BatchEvent::Finished(summary.clone()));
    summary
}

fn process_item(
    index: usize,
    item: &BatchItem,
    planned: &Planned,
    job: &BatchJob,
    resources: &Resources,
    cancel: &AtomicBool,
) -> ItemUpdate {
    let mut u = base_update(index, item, ItemStatus::Failed);
    let result = (|| -> Result<_> {
        if let Some(e) = &planned.error {
            return Err(clone_error(e));
        }
        let target = planned.target.clone().expect("planned target");
        let format = planned.format.expect("planned format");
        let src = Path::new(&item.path);

        let decoded = decode_file(src, &job.limits)?;
        if cancel.load(Ordering::SeqCst) {
            return Err(EngineError::Cancelled);
        }
        let out = apply(
            Raster::full(decoded.image),
            job.operations_for(item),
            resources,
            &job.limits,
            None,
        )?;
        let (w, h) = out.img.dimensions();
        if (w, h) != (planned.out_w, planned.out_h) {
            return Err(EngineError::Verification(format!(
                "rendered {w}×{h} px but {}×{} px was planned",
                planned.out_w, planned.out_h
            )));
        }
        if cancel.load(Ordering::SeqCst) {
            return Err(EngineError::Cancelled);
        }
        let icc = if format == ImageFormat::Png || format == ImageFormat::Jpeg {
            decoded.icc_profile
        } else {
            None
        };
        let bytes = encode(&out.img, &job.export.encode_options(format, icc))?;
        drop(out);
        if cancel.load(Ordering::SeqCst) {
            return Err(EngineError::Cancelled);
        }
        let written = write_output(
            &target,
            &bytes,
            (format, w, h),
            job.export.conflict,
            src,
            job.export.allow_source_overwrite,
        )?;
        Ok((written, format, w, h, decoded.has_alpha))
    })();

    match result {
        Ok((written, format, w, h, had_alpha)) => {
            u.output_path = Some(written.path.display().to_string());
            match written.status {
                WriteStatus::Skipped => {
                    u.status = ItemStatus::Skipped;
                    u.message =
                        Some("An output file with this name already exists (skipped)".into());
                }
                s => {
                    u.status = ItemStatus::Done;
                    u.output_w = Some(w);
                    u.output_h = Some(h);
                    u.output_format = Some(format);
                    u.output_bytes = Some(written.bytes);
                    u.renamed = s == WriteStatus::Renamed;
                    u.replaced = s == WriteStatus::Replaced;
                    if had_alpha && !format.supports_alpha() {
                        u.message = Some(format!(
                            "{} has no transparency; transparent areas were filled with the background color",
                            format.label()
                        ));
                    }
                }
            }
        }
        Err(EngineError::Cancelled) => {
            u.status = ItemStatus::Cancelled;
            u.message = Some("Cancelled before writing; nothing was saved".into());
        }
        Err(e) => {
            u.status = ItemStatus::Failed;
            u.message = Some(e.to_string());
            u.error = Some(e.to_payload());
        }
    }
    u
}

/// Encode one image fully in memory (nothing is written) and report the real
/// encoded size. Used to show an exact output size before exporting.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Measured {
    pub bytes: u64,
    pub input_bytes: u64,
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
}

pub fn measure_output(
    path: &Path,
    operations: &[Operation],
    export: &ExportOptions,
    limits: &Limits,
) -> Result<Measured> {
    crate::ops::validate(operations)?;
    let resources = Resources::load(operations, limits)?;
    let decoded = decode_file(path, limits)?;
    let format = export.format.resolve(decoded.format);
    let out = apply(
        Raster::full(decoded.image),
        operations,
        &resources,
        limits,
        None,
    )?;
    let (width, height) = out.img.dimensions();
    let icc = if format == ImageFormat::Png || format == ImageFormat::Jpeg {
        decoded.icc_profile
    } else {
        None
    };
    let bytes = encode(&out.img, &export.encode_options(format, icc))?;
    Ok(Measured {
        bytes: bytes.len() as u64,
        input_bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        format,
        width,
        height,
    })
}

fn clone_error(e: &EngineError) -> EngineError {
    match e {
        EngineError::DoesNotFit {
            src_w,
            src_h,
            canvas_w,
            canvas_h,
        } => EngineError::DoesNotFit {
            src_w: *src_w,
            src_h: *src_h,
            canvas_w: *canvas_w,
            canvas_h: *canvas_h,
        },
        EngineError::InvalidInput(s) => EngineError::InvalidInput(s.clone()),
        EngineError::TooLarge(s) => EngineError::TooLarge(s.clone()),
        EngineError::UnsupportedFormat(s) => EngineError::UnsupportedFormat(s.clone()),
        EngineError::Decode(s) => EngineError::Decode(s.clone()),
        EngineError::Encode(s) => EngineError::Encode(s.clone()),
        EngineError::Io(s) => EngineError::Io(s.clone()),
        EngineError::Conflict(p) => EngineError::Conflict(p.clone()),
        EngineError::WouldOverwriteSource(p) => EngineError::WouldOverwriteSource(p.clone()),
        EngineError::Verification(s) => EngineError::Verification(s.clone()),
        EngineError::Segmentation(s) => EngineError::Segmentation(s.clone()),
        EngineError::Cancelled => EngineError::Cancelled,
    }
}
