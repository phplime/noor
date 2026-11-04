//! The operation pipeline shared by every image tool.
//!
//! A tool describes what it wants as a list of [`Operation`]s. The same list is
//! used for (a) planning output dimensions without decoding, (b) rendering a
//! scaled preview and (c) the full-resolution export.

use crate::adjust::{AdjustSpec, TransformSpec};
use crate::background::BackgroundSpec;
use crate::codec::decode_file;
use crate::error::{EngineError, Result};
use crate::geometry::{plan_resize, CanvasPlan, CropSpec, Limits, ResizeSpec};
use crate::pixels::{blend_over, copy_into, resample};
use crate::watermark::{apply_logo, apply_text, MarkLayout, WatermarkKind, WatermarkSpec};
use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Operation {
    /// Explicitly remove everything outside a rectangle. The only operation that discards content.
    Crop(CropSpec),
    /// Fit / Canvas / Stretch / Percent. Never removes content.
    Resize(ResizeSpec),
    /// Composite a logo or text. Never changes dimensions.
    Watermark(WatermarkSpec),
    /// Rotate by 90° steps and/or mirror. Never removes content.
    Transform(TransformSpec),
    /// Light, color, tone-curve and detail adjustments. Never changes dimensions.
    Adjust(AdjustSpec),
    /// Remove, replace or blur the background around the detected subject.
    Background(BackgroundSpec),
}

/// External resources (logo images) needed by a pipeline, loaded once per job.
#[derive(Default, Clone)]
pub struct Resources {
    logos: HashMap<String, Arc<RgbaImage>>,
}

impl Resources {
    pub fn load(ops: &[Operation], limits: &Limits) -> Result<Self> {
        let mut res = Resources::default();
        for op in ops {
            if let Operation::Watermark(w) = op {
                if w.kind == WatermarkKind::Logo {
                    if let Some(p) = &w.logo_path {
                        if !res.logos.contains_key(p) {
                            let decoded = decode_file(Path::new(p), limits).map_err(|e| {
                                EngineError::InvalidInput(format!("could not load the logo: {e}"))
                            })?;
                            res.logos.insert(p.clone(), Arc::new(decoded.image));
                        }
                    }
                }
            }
        }
        Ok(res)
    }

    pub fn insert_logo(&mut self, path: impl Into<String>, img: Arc<RgbaImage>) {
        self.logos.insert(path.into(), img);
    }

    fn logo(&self, path: &Option<String>) -> Result<&Arc<RgbaImage>> {
        path.as_ref()
            .and_then(|p| self.logos.get(p))
            .ok_or_else(|| EngineError::InvalidInput("the logo image is not loaded".into()))
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelinePlan {
    pub source_w: u32,
    pub source_h: u32,
    pub output_w: u32,
    pub output_h: u32,
    /// Plan of the last resize step, if any (for drawing image/padding overlays).
    pub resize: Option<CanvasPlan>,
    pub cropped: bool,
    pub warnings: Vec<String>,
}

pub fn validate(ops: &[Operation]) -> Result<()> {
    for op in ops {
        match op {
            Operation::Watermark(w) => w.validate()?,
            Operation::Transform(t) => t.validate()?,
            Operation::Adjust(a) => a.validate()?,
            Operation::Background(b) => b.validate()?,
            _ => {}
        }
    }
    Ok(())
}

/// Compute output dimensions without touching pixels.
pub fn plan_pipeline(
    src_w: u32,
    src_h: u32,
    ops: &[Operation],
    limits: &Limits,
) -> Result<PipelinePlan> {
    validate(ops)?;
    let (mut w, mut h) = (src_w, src_h);
    let mut resize = None;
    let mut cropped = false;
    let mut warnings = Vec::new();
    for op in ops {
        match op {
            Operation::Crop(c) => {
                c.validate(w, h)?;
                w = c.width;
                h = c.height;
                cropped = true;
            }
            Operation::Resize(spec) => {
                let p = plan_resize(w, h, spec, limits)?;
                if p.distorted {
                    warnings.push(
                        "Stretch changes the aspect ratio: the image will look distorted."
                            .to_string(),
                    );
                }
                w = p.canvas_w;
                h = p.canvas_h;
                resize = Some(p);
            }
            Operation::Watermark(_) | Operation::Adjust(_) | Operation::Background(_) => {}
            Operation::Transform(t) => {
                (w, h) = t.output_size(w, h);
            }
        }
    }
    Ok(PipelinePlan {
        source_w: src_w,
        source_h: src_h,
        output_w: w,
        output_h: h,
        resize,
        cropped,
        warnings,
    })
}

/// A pixel buffer plus the full-resolution ("logical") size it represents.
/// For exports the buffer *is* full resolution (scale 1). Previews render from a
/// downscaled source, with every geometric parameter mapped through the scale.
pub struct Raster {
    pub img: RgbaImage,
    pub logical_w: f64,
    pub logical_h: f64,
}

impl Raster {
    pub fn full(img: RgbaImage) -> Self {
        let (w, h) = img.dimensions();
        Raster {
            img,
            logical_w: w as f64,
            logical_h: h as f64,
        }
    }

    pub fn scale(&self) -> f64 {
        self.img.width() as f64 / self.logical_w
    }

    pub fn logical_size(&self) -> (u32, u32) {
        (self.logical_w.round() as u32, self.logical_h.round() as u32)
    }
}

/// Run the pipeline. With `preview_max = None` the result is exact full resolution.
/// With `Some(m)`, resize steps render at most `m` pixels on the long side.
pub fn apply(
    mut r: Raster,
    ops: &[Operation],
    res: &Resources,
    limits: &Limits,
    preview_max: Option<u32>,
) -> Result<Raster> {
    validate(ops)?;
    for op in ops {
        r = match op {
            Operation::Crop(c) => {
                let (lw, lh) = r.logical_size();
                c.validate(lw, lh)?;
                let k = r.scale();
                let (bw, bh) = r.img.dimensions();
                let x0 = ((c.x as f64 * k).round() as u32).min(bw.saturating_sub(1));
                let y0 = ((c.y as f64 * k).round() as u32).min(bh.saturating_sub(1));
                let x1 = (((c.x + c.width) as f64 * k).round() as u32).clamp(x0 + 1, bw);
                let y1 = (((c.y + c.height) as f64 * k).round() as u32).clamp(y0 + 1, bh);
                let img = image::imageops::crop_imm(&r.img, x0, y0, x1 - x0, y1 - y0).to_image();
                Raster {
                    img,
                    logical_w: c.width as f64,
                    logical_h: c.height as f64,
                }
            }
            Operation::Resize(spec) => {
                let (lw, lh) = r.logical_size();
                let plan = plan_resize(lw, lh, spec, limits)?;
                render_resize(&r.img, &plan, spec, preview_max)
            }
            Operation::Watermark(w) => {
                let (lw, lh) = (r.logical_w, r.logical_h);
                match w.kind {
                    WatermarkKind::Logo => {
                        let logo = res.logo(&w.logo_path)?;
                        apply_logo(&mut r.img, lw, lh, w, logo);
                    }
                    WatermarkKind::Text => apply_text(&mut r.img, lw, lh, w),
                }
                r
            }
            Operation::Transform(t) => {
                let img = t.apply(&r.img);
                let (lw, lh) =
                    t.output_size(r.logical_w.round() as u32, r.logical_h.round() as u32);
                Raster {
                    img,
                    logical_w: lw as f64,
                    logical_h: lh as f64,
                }
            }
            Operation::Adjust(a) => {
                let k = r.scale();
                a.apply(&mut r.img, k);
                r
            }
            Operation::Background(b) => {
                crate::background::apply(&mut r.img, b)?;
                r
            }
        };
    }
    Ok(r)
}

/// Where each watermark lands (in logical pixels of the image at that step) and
/// the area it can be dragged within. Used for drag-to-position in the UI.
pub fn watermark_layouts(
    src_w: u32,
    src_h: u32,
    ops: &[Operation],
    res: &Resources,
    limits: &Limits,
) -> Vec<MarkLayout> {
    let mut out = Vec::new();
    let mut prefix = Vec::new();
    for op in ops {
        if let Operation::Watermark(w) = op {
            if let Ok(plan) = plan_pipeline(src_w, src_h, &prefix, limits) {
                let (iw, ih) = (plan.output_w as f64, plan.output_h as f64);
                let rect = match w.kind {
                    WatermarkKind::Logo => match res.logo(&w.logo_path) {
                        Ok(l) => Some(w.plan_logo(iw, ih, l.width(), l.height())),
                        Err(_) => None,
                    },
                    WatermarkKind::Text if !w.text.trim().is_empty() => Some(w.plan_text(iw, ih)),
                    WatermarkKind::Text => None,
                };
                if let Some(rect) = rect {
                    out.push(MarkLayout {
                        rect,
                        area: w.movable_area(iw, ih),
                    });
                }
            }
        }
        prefix.push(op.clone());
    }
    out
}

fn render_resize(
    src: &RgbaImage,
    plan: &CanvasPlan,
    spec: &ResizeSpec,
    preview_max: Option<u32>,
) -> Raster {
    let k = match preview_max {
        Some(m) => (m as f64 / plan.canvas_w.max(plan.canvas_h) as f64).min(1.0),
        None => 1.0,
    };
    let px = |v: u32| ((v as f64 * k).round() as u32).max(1);
    let (cw, ch) = (px(plan.canvas_w), px(plan.canvas_h));
    let iw = px(plan.image_w).min(cw);
    let ih = px(plan.image_h).min(ch);
    let ix = ((plan.image_x as f64 * k).round() as u32).min(cw - iw);
    let iy = ((plan.image_y as f64 * k).round() as u32).min(ch - ih);

    let scaled = resample(src, iw, ih, spec.filter);
    let img = if !plan.has_padding {
        scaled
    } else {
        let fill = spec.background.fill();
        let mut canvas = RgbaImage::from_pixel(cw, ch, Rgba(fill));
        if spec.background.transparent {
            copy_into(&mut canvas, &scaled, ix, iy);
        } else {
            blend_over(&mut canvas, &scaled, ix as i64, iy as i64, 1.0);
        }
        canvas
    };
    Raster {
        img,
        logical_w: plan.canvas_w as f64,
        logical_h: plan.canvas_h as f64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Color;
    use crate::geometry::{Anchor, Background, Placement, ResizeMode};

    /// 1200×800 image with distinctly colored 20 px corner blocks.
    fn marked_source() -> RgbaImage {
        RgbaImage::from_fn(1200, 800, |x, y| {
            let left = x < 20;
            let right = x >= 1180;
            let top = y < 20;
            let bottom = y >= 780;
            Rgba(match (left, right, top, bottom) {
                (true, _, true, _) => [255, 0, 0, 255],
                (_, true, true, _) => [0, 255, 0, 255],
                (true, _, _, true) => [0, 0, 255, 255],
                (_, true, _, true) => [255, 255, 0, 255],
                _ => [128, 128, 128, 255],
            })
        })
    }

    fn resize(mode: ResizeMode, w: u32, h: u32) -> ResizeSpec {
        ResizeSpec {
            mode,
            width: w,
            height: h,
            background: Background {
                color: Color::rgb(255, 0, 255),
                transparent: false,
            },
            ..Default::default()
        }
    }

    fn close(a: [u8; 4], b: [u8; 4], tol: i32) -> bool {
        a.iter()
            .zip(b)
            .all(|(x, y)| (*x as i32 - y as i32).abs() <= tol)
    }

    #[test]
    fn fit_keeps_all_four_corners_and_pads() {
        let ops = [Operation::Resize(resize(ResizeMode::Fit, 590, 300))];
        let out = apply(
            Raster::full(marked_source()),
            &ops,
            &Resources::default(),
            &Limits::default(),
            None,
        )
        .unwrap();
        assert_eq!(out.img.dimensions(), (590, 300));
        // image placed at x=70..520, y=0..300
        assert!(close(out.img.get_pixel(71, 1).0, [255, 0, 0, 255], 40));
        assert!(close(out.img.get_pixel(518, 1).0, [0, 255, 0, 255], 40));
        assert!(close(out.img.get_pixel(71, 298).0, [0, 0, 255, 255], 40));
        assert!(close(out.img.get_pixel(518, 298).0, [255, 255, 0, 255], 40));
        // padding is background
        assert_eq!(out.img.get_pixel(10, 150).0, [255, 0, 255, 255]);
        assert_eq!(out.img.get_pixel(580, 150).0, [255, 0, 255, 255]);
    }

    #[test]
    fn stretch_keeps_all_four_corners() {
        let ops = [Operation::Resize(resize(ResizeMode::Stretch, 590, 300))];
        let out = apply(
            Raster::full(marked_source()),
            &ops,
            &Resources::default(),
            &Limits::default(),
            None,
        )
        .unwrap();
        assert_eq!(out.img.dimensions(), (590, 300));
        assert!(close(out.img.get_pixel(1, 1).0, [255, 0, 0, 255], 40));
        assert!(close(out.img.get_pixel(588, 298).0, [255, 255, 0, 255], 40));
    }

    #[test]
    fn canvas_keeps_original_pixels_verbatim() {
        let src = marked_source();
        let mut spec = resize(ResizeMode::Canvas, 1400, 1000);
        spec.placement = Placement::at(Anchor::TopLeft);
        let ops = [Operation::Resize(spec)];
        let out = apply(
            Raster::full(src.clone()),
            &ops,
            &Resources::default(),
            &Limits::default(),
            None,
        )
        .unwrap();
        assert_eq!(out.img.dimensions(), (1400, 1000));
        for (x, y, p) in src.enumerate_pixels() {
            assert_eq!(out.img.get_pixel(x, y), p);
        }
        assert_eq!(out.img.get_pixel(1300, 900).0, [255, 0, 255, 255]);
    }

    #[test]
    fn transparent_padding_and_source_alpha_preserved() {
        let mut src = RgbaImage::from_pixel(100, 100, Rgba([10, 200, 30, 255]));
        for y in 0..50 {
            for x in 0..50 {
                src.put_pixel(x, y, Rgba([0, 0, 0, 0]));
            }
        }
        let mut spec = resize(ResizeMode::Canvas, 200, 120);
        spec.background.transparent = true;
        let out = apply(
            Raster::full(src),
            &[Operation::Resize(spec)],
            &Resources::default(),
            &Limits::default(),
            None,
        )
        .unwrap();
        // image at x=50, y=10
        assert_eq!(out.img.get_pixel(0, 0).0[3], 0, "padding transparent");
        assert_eq!(
            out.img.get_pixel(60, 20).0[3],
            0,
            "source transparent region kept"
        );
        assert_eq!(out.img.get_pixel(120, 80).0, [10, 200, 30, 255]);
    }

    #[test]
    fn crop_is_the_only_op_that_removes_content() {
        let ops = [Operation::Crop(CropSpec {
            x: 0,
            y: 0,
            width: 600,
            height: 400,
        })];
        let out = apply(
            Raster::full(marked_source()),
            &ops,
            &Resources::default(),
            &Limits::default(),
            None,
        )
        .unwrap();
        assert_eq!(out.img.dimensions(), (600, 400));
        assert_eq!(out.img.get_pixel(5, 5).0, [255, 0, 0, 255]);
        // the other corners are gone
        assert!(!out.img.pixels().any(|p| p.0 == [0, 255, 0, 255]));
        let plan = plan_pipeline(1200, 800, &ops, &Limits::default()).unwrap();
        assert!(plan.cropped);
        let plan = plan_pipeline(
            1200,
            800,
            &[Operation::Resize(resize(ResizeMode::Fit, 10, 10))],
            &Limits::default(),
        )
        .unwrap();
        assert!(!plan.cropped);
    }

    #[test]
    fn crop_then_exact_output_size() {
        let ops = [
            Operation::Crop(CropSpec {
                x: 100,
                y: 100,
                width: 590,
                height: 300,
            }),
            Operation::Resize(resize(ResizeMode::Stretch, 1180, 600)),
        ];
        let plan = plan_pipeline(1200, 800, &ops, &Limits::default()).unwrap();
        assert_eq!((plan.output_w, plan.output_h), (1180, 600));
        assert!(
            plan.warnings.is_empty(),
            "same ratio, no distortion warning"
        );
        let out = apply(
            Raster::full(marked_source()),
            &ops,
            &Resources::default(),
            &Limits::default(),
            None,
        )
        .unwrap();
        assert_eq!(out.img.dimensions(), (1180, 600));
    }

    #[test]
    fn preview_matches_export_geometry() {
        let spec = resize(ResizeMode::Fit, 590, 300);
        let ops = [Operation::Resize(spec)];
        // simulate a half-resolution preview source
        let small = resample(
            &marked_source(),
            600,
            400,
            crate::geometry::Filter::Lanczos3,
        );
        let r = Raster {
            img: small,
            logical_w: 1200.0,
            logical_h: 800.0,
        };
        let preview = apply(
            r,
            &ops,
            &Resources::default(),
            &Limits::default(),
            Some(295),
        )
        .unwrap();
        assert_eq!(preview.logical_size(), (590, 300));
        assert_eq!(preview.img.dimensions(), (295, 150));
        // padding columns at the same relative place: image spans x 35..260
        assert_eq!(preview.img.get_pixel(20, 75).0, [255, 0, 255, 255]);
        assert!(close(
            preview.img.get_pixel(37, 75).0,
            [128, 128, 128, 255],
            50
        ));
    }

    #[test]
    fn stretch_warning_in_plan() {
        let plan = plan_pipeline(
            1200,
            800,
            &[Operation::Resize(resize(ResizeMode::Stretch, 590, 300))],
            &Limits::default(),
        )
        .unwrap();
        assert_eq!(plan.warnings.len(), 1);
    }

    #[test]
    fn operation_json_shape() {
        let json = r##"[{"type":"crop","x":1,"y":2,"width":3,"height":4},
            {"type":"resize","mode":"fit","width":590,"height":300,"background":{"color":"#ffffff","transparent":true},"placement":{"anchor":"custom","x":0.2,"y":0.8}},
            {"type":"watermark","kind":"text","text":"hi","opacity":0.5}]"##;
        let ops: Vec<Operation> = serde_json::from_str(json).unwrap();
        assert_eq!(ops.len(), 3);
        match &ops[1] {
            Operation::Resize(r) => {
                assert_eq!(r.mode, ResizeMode::Fit);
                assert!(r.background.transparent);
                assert_eq!(r.placement.anchor, Anchor::Custom);
                assert!(r.allow_upscale, "defaults filled in");
            }
            _ => panic!(),
        }
    }
}
