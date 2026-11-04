//! Previews and thumbnails. Full-resolution sources are decoded once and kept as
//! a bounded, downscaled copy, so changing settings never re-decodes the file.
//! Previews run the *same* pipeline as the export (see `ops::apply`).

use crate::codec::{decode_file, to_data_url, ImageFormat};
use crate::error::{EngineError, Result};
use crate::geometry::{Filter, Limits};
use crate::ops::{
    apply, plan_pipeline, watermark_layouts, Operation, PipelinePlan, Raster, Resources,
};
use crate::pixels::resample;
use crate::watermark::MarkLayout;
use crate::watermark::WatermarkKind;
use image::RgbaImage;
use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

pub struct CachedSource {
    pub image: RgbaImage,
    pub full_w: u32,
    pub full_h: u32,
    pub format: ImageFormat,
    pub has_alpha: bool,
}

type Key = (PathBuf, Option<SystemTime>, u64);

pub struct PreviewCache {
    max_side: u32,
    capacity: usize,
    entries: Mutex<VecDeque<(Key, Arc<CachedSource>)>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub data_url: String,
    /// Pixel size of the preview bitmap (may be smaller than the real output).
    pub preview_w: u32,
    pub preview_h: u32,
    pub plan: PipelinePlan,
    pub has_alpha: bool,
    /// Watermark positions (for drag-to-position), in logical output pixels.
    pub marks: Vec<MarkLayout>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub has_alpha: bool,
}

fn key_for(path: &Path) -> Key {
    let meta = std::fs::metadata(path).ok();
    (
        path.to_path_buf(),
        meta.as_ref().and_then(|m| m.modified().ok()),
        meta.map(|m| m.len()).unwrap_or(0),
    )
}

fn shrink(img: RgbaImage, max_side: u32) -> RgbaImage {
    let (w, h) = img.dimensions();
    let long = w.max(h);
    if long <= max_side {
        return img;
    }
    let s = max_side as f64 / long as f64;
    resample(
        &img,
        ((w as f64 * s).round() as u32).max(1),
        ((h as f64 * s).round() as u32).max(1),
        Filter::Lanczos3,
    )
}

impl PreviewCache {
    pub fn new(max_side: u32, capacity: usize) -> Self {
        PreviewCache {
            max_side,
            capacity: capacity.max(1),
            entries: Mutex::new(VecDeque::new()),
        }
    }

    pub fn source(&self, path: &Path, limits: &Limits) -> Result<Arc<CachedSource>> {
        let key = key_for(path);
        {
            let mut entries = self.entries.lock().unwrap();
            if let Some(pos) = entries.iter().position(|(k, _)| *k == key) {
                let entry = entries.remove(pos).unwrap();
                let src = entry.1.clone();
                entries.push_back(entry);
                return Ok(src);
            }
        }
        let decoded = decode_file(path, limits)?;
        let (full_w, full_h) = decoded.image.dimensions();
        let src = Arc::new(CachedSource {
            image: shrink(decoded.image, self.max_side),
            full_w,
            full_h,
            format: decoded.format,
            has_alpha: decoded.has_alpha,
        });
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|(k, _)| k.0 != key.0);
        entries.push_back((key, src.clone()));
        while entries.len() > self.capacity {
            entries.pop_front();
        }
        Ok(src)
    }

    pub fn clear(&self) {
        self.entries.lock().unwrap().clear();
    }

    fn resources(&self, ops: &[Operation], limits: &Limits) -> Result<Resources> {
        let mut res = Resources::default();
        for op in ops {
            if let Operation::Watermark(w) = op {
                if w.kind == WatermarkKind::Logo {
                    if let Some(p) = &w.logo_path {
                        let logo = self.source(Path::new(p), limits).map_err(|e| {
                            EngineError::InvalidInput(format!("could not load the logo: {e}"))
                        })?;
                        res.insert_logo(p.clone(), Arc::new(logo.image.clone()));
                    }
                }
            }
        }
        Ok(res)
    }

    /// Render a preview of `ops` applied to `path`, at most `max_side` px on the long side.
    pub fn render(
        &self,
        path: &Path,
        ops: &[Operation],
        limits: &Limits,
        max_side: u32,
    ) -> Result<PreviewResult> {
        let src = self.source(path, limits)?;
        let plan = plan_pipeline(src.full_w, src.full_h, ops, limits)?;
        let res = self.resources(ops, limits)?;
        let marks = watermark_layouts(src.full_w, src.full_h, ops, &res, limits);
        let raster = Raster {
            img: src.image.clone(),
            logical_w: src.full_w as f64,
            logical_h: src.full_h as f64,
        };
        let out = apply(raster, ops, &res, limits, Some(max_side))?;
        let img = shrink(out.img, max_side);
        let has_alpha = !crate::pixels::is_opaque(&img);
        Ok(PreviewResult {
            preview_w: img.width(),
            preview_h: img.height(),
            data_url: to_data_url(&img)?,
            plan,
            has_alpha,
            marks,
        })
    }

    /// Small thumbnail. Uses the preview cache when the image is already there,
    /// otherwise decodes without caching (so scanning big folders does not evict previews).
    pub fn thumbnail(&self, path: &Path, size: u32, limits: &Limits) -> Result<Thumbnail> {
        let key = key_for(path);
        let cached = self
            .entries
            .lock()
            .unwrap()
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, s)| s.clone());
        let (img, w, h, alpha) = match cached {
            Some(s) => (
                shrink(s.image.clone(), size),
                s.full_w,
                s.full_h,
                s.has_alpha,
            ),
            None => {
                let d = decode_file(path, limits)?;
                let (w, h) = d.image.dimensions();
                (shrink(d.image, size), w, h, d.has_alpha)
            }
        };
        Ok(Thumbnail {
            data_url: to_data_url(&img)?,
            width: w,
            height: h,
            has_alpha: alpha,
        })
    }
}
