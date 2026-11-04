//! Collage rendering. The layout (cell rectangles) is computed by the UI so the
//! interactive preview and the export share one geometry; the engine draws each
//! cell at full resolution with the same framing maths as the preview.

use crate::adjust::AdjustSpec;
use crate::codec::decode_file;
use crate::color::Color;
use crate::error::{EngineError, Result};
use crate::geometry::{Filter, Limits};
use crate::pixels::{blend_over, resample};
use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum CellFit {
    /// Fill the whole cell; edges of the photo outside the cell are not shown.
    #[default]
    Cover,
    /// Show the whole photo inside the cell; unused space shows the background.
    Contain,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollageCell {
    pub path: String,
    /// Cell rectangle in output pixels.
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    /// Framing: 0..=1 fraction of the overflow to the left/top (CSS object-position).
    #[serde(default = "half")]
    pub focus_x: f64,
    #[serde(default = "half")]
    pub focus_y: f64,
    /// 1.0 = fitted; larger zooms in.
    #[serde(default = "one")]
    pub zoom: f64,
    #[serde(default)]
    pub fit: CellFit,
    #[serde(default)]
    pub radius: u32,
}

fn half() -> f64 {
    0.5
}
fn one() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollageSpec {
    pub width: u32,
    pub height: u32,
    pub background: Color,
    #[serde(default)]
    pub transparent: bool,
    pub cells: Vec<CollageCell>,
    /// Colour/tone effect applied to every photo (same engine as Adjust & Enhance).
    #[serde(default)]
    pub effect: Option<AdjustSpec>,
    /// Border drawn inside each cell, following its rounded corners. 0 = none.
    #[serde(default)]
    pub border_width: u32,
    #[serde(default = "white")]
    pub border_color: Color,
    /// Drop shadow under each photo, 0 (none) ..= 100.
    #[serde(default)]
    pub shadow: u32,
}

fn white() -> Color {
    Color::WHITE
}

/// Where the photo lands relative to its cell (all in cell pixels). Shared with the UI.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Framing {
    pub scale: f64,
    pub offset_x: f64,
    pub offset_y: f64,
    pub draw_w: f64,
    pub draw_h: f64,
}

#[allow(clippy::too_many_arguments)]
pub fn framing(
    cell_w: f64,
    cell_h: f64,
    img_w: f64,
    img_h: f64,
    fit: CellFit,
    zoom: f64,
    fx: f64,
    fy: f64,
) -> Framing {
    let base = match fit {
        CellFit::Cover => (cell_w / img_w).max(cell_h / img_h),
        CellFit::Contain => (cell_w / img_w).min(cell_h / img_h),
    };
    let scale = base * zoom.clamp(1.0, 8.0);
    let draw_w = img_w * scale;
    let draw_h = img_h * scale;
    Framing {
        scale,
        offset_x: (cell_w - draw_w) * fx.clamp(0.0, 1.0),
        offset_y: (cell_h - draw_h) * fy.clamp(0.0, 1.0),
        draw_w,
        draw_h,
    }
}

impl CollageSpec {
    pub fn validate(&self, limits: &Limits) -> Result<()> {
        limits.check(self.width, self.height, "Collage")?;
        if self.cells.is_empty() || self.cells.len() > 16 {
            return Err(EngineError::InvalidInput(
                "a collage needs 1 to 16 photos".into(),
            ));
        }
        for c in &self.cells {
            if c.w == 0
                || c.h == 0
                || c.x.saturating_add(c.w) > self.width
                || c.y.saturating_add(c.h) > self.height
            {
                return Err(EngineError::InvalidInput(
                    "a collage cell lies outside the canvas".into(),
                ));
            }
            if !(c.zoom.is_finite() && c.focus_x.is_finite() && c.focus_y.is_finite()) {
                return Err(EngineError::InvalidInput("invalid framing values".into()));
            }
        }
        if self.border_width > 2000 || self.shadow > 100 {
            return Err(EngineError::InvalidInput(
                "border or shadow out of range".into(),
            ));
        }
        if let Some(e) = &self.effect {
            e.validate()?;
        }
        Ok(())
    }
}

/// Anti-aliased coverage (0..=1) of a rounded rectangle `w`×`h` with corner radius
/// `r` at point (`px`, `py`) in the rectangle's own coordinates. 0 outside.
fn rrect_coverage(px: f32, py: f32, w: f32, h: f32, r: f32) -> f32 {
    if w <= 0.0 || h <= 0.0 {
        return 0.0;
    }
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    let qx = (px - w / 2.0).abs() - (w / 2.0 - r);
    let qy = (py - h / 2.0).abs() - (h / 2.0 - r);
    let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
    let inside = qx.max(qy).min(0.0);
    (0.5 - (outside + inside - r)).clamp(0.0, 1.0)
}

/// Shadow geometry for a canvas: (blur sigma, y offset, opacity). Shared with the UI.
pub fn shadow_params(canvas_w: u32, canvas_h: u32, strength: u32) -> (f32, f32, f32) {
    let m = canvas_w.min(canvas_h) as f32;
    let k = strength.min(100) as f32 / 100.0;
    (
        m * 0.012 * (0.5 + k),
        m * 0.006 * (0.5 + k),
        0.15 + 0.45 * k,
    )
}

/// Soft drop shadows for every cell, drawn before the photos so neighbours never
/// shade each other's pictures.
fn draw_shadows(canvas: &mut RgbaImage, spec: &CollageSpec) {
    let (sigma, dy, opacity) = shadow_params(spec.width, spec.height, spec.shadow);
    let pad = (sigma * 3.0).ceil() as u32 + 1;
    for c in &spec.cells {
        let (w, h) = (c.w + pad * 2, c.h + pad * 2);
        let r = c.radius as f32;
        let mut mask = RgbaImage::new(w, h);
        for (x, y, p) in mask.enumerate_pixels_mut() {
            let cov = rrect_coverage(
                x as f32 + 0.5 - pad as f32,
                y as f32 + 0.5 - pad as f32,
                c.w as f32,
                c.h as f32,
                r,
            );
            *p = Rgba([0, 0, 0, (cov * 255.0).round() as u8]);
        }
        let blurred = image::imageops::fast_blur(&mask, sigma.max(0.5));
        blend_over(
            canvas,
            &blurred,
            c.x as i64 - pad as i64,
            c.y as i64 - pad as i64 + dy.round() as i64,
            opacity,
        );
    }
}

fn draw_cell(
    canvas: &mut RgbaImage,
    cell: &CollageCell,
    photo: &RgbaImage,
    border: Option<(u32, Color)>,
) {
    let (iw, ih) = (photo.width() as f64, photo.height() as f64);
    let (cw, ch) = (cell.w as f64, cell.h as f64);
    let f = framing(
        cw,
        ch,
        iw,
        ih,
        cell.fit,
        cell.zoom,
        cell.focus_x,
        cell.focus_y,
    );
    // Visible part of the scaled photo inside the cell, in cell coordinates.
    let vx0 = f.offset_x.max(0.0);
    let vy0 = f.offset_y.max(0.0);
    let vx1 = (f.offset_x + f.draw_w).min(cw);
    let vy1 = (f.offset_y + f.draw_h).min(ch);
    let mut layer = RgbaImage::new(cell.w, cell.h);
    if vx1 > vx0 && vy1 > vy0 {
        // Map back to source pixels and resample only that region.
        let sx0 = ((vx0 - f.offset_x) / f.scale).clamp(0.0, iw);
        let sy0 = ((vy0 - f.offset_y) / f.scale).clamp(0.0, ih);
        let sx1 = ((vx1 - f.offset_x) / f.scale).clamp(0.0, iw);
        let sy1 = ((vy1 - f.offset_y) / f.scale).clamp(0.0, ih);
        let (cx, cy) = (sx0.floor() as u32, sy0.floor() as u32);
        let cw_src = ((sx1.ceil() as u32).min(photo.width()) - cx).max(1);
        let ch_src = ((sy1.ceil() as u32).min(photo.height()) - cy).max(1);
        let crop = image::imageops::crop_imm(photo, cx, cy, cw_src, ch_src).to_image();
        let dw = (vx1 - vx0).round().max(1.0) as u32;
        let dh = (vy1 - vy0).round().max(1.0) as u32;
        let scaled = resample(&crop, dw, dh, Filter::Lanczos3);
        image::imageops::replace(&mut layer, &scaled, vx0.round() as i64, vy0.round() as i64);
    }
    let (w, h) = (cell.w as f32, cell.h as f32);
    let r = cell.radius as f32;
    let bw = border.map(|(bw, _)| bw as f32).unwrap_or(0.0);
    if r > 0.0 || bw > 0.0 {
        let bc = border.map(|(_, c)| c).unwrap_or(Color::TRANSPARENT);
        for (x, y, p) in layer.enumerate_pixels_mut() {
            let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
            let outer = rrect_coverage(px, py, w, h, r);
            if bw > 0.0 {
                // Photo shows inside the inset rectangle; the band outside it is border.
                let inner = rrect_coverage(
                    px - bw,
                    py - bw,
                    w - 2.0 * bw,
                    h - 2.0 * bw,
                    (r - bw).max(0.0),
                );
                if inner < 1.0 {
                    let mut px_out = [bc.r, bc.g, bc.b, bc.a];
                    if inner > 0.0 {
                        let photo = p.0;
                        let pa = photo[3] as f32 / 255.0 * inner;
                        let ba = bc.a as f32 / 255.0 * (1.0 - inner);
                        let a = pa + ba;
                        if a > 0.0 {
                            for i in 0..3 {
                                px_out[i] = ((photo[i] as f32 * pa
                                    + [bc.r, bc.g, bc.b][i] as f32 * ba)
                                    / a)
                                    .round() as u8;
                            }
                        }
                        px_out[3] = (a * 255.0).round() as u8;
                    }
                    p.0 = px_out;
                }
            }
            if outer < 1.0 {
                p.0[3] = (p.0[3] as f32 * outer).round() as u8;
            }
        }
    }
    blend_over(canvas, &layer, cell.x as i64, cell.y as i64, 1.0);
}

/// Render the collage. Each photo is decoded once at full resolution, drawn, and
/// released before the next is loaded, so memory stays bounded.
pub fn render_collage(spec: &CollageSpec, limits: &Limits) -> Result<RgbaImage> {
    spec.validate(limits)?;
    let bg = if spec.transparent {
        Rgba([0, 0, 0, 0])
    } else {
        Rgba([spec.background.r, spec.background.g, spec.background.b, 255])
    };
    let mut canvas = RgbaImage::from_pixel(spec.width, spec.height, bg);
    if spec.shadow > 0 {
        draw_shadows(&mut canvas, spec);
    }
    let border = (spec.border_width > 0).then_some((spec.border_width, spec.border_color));
    for cell in &spec.cells {
        let mut decoded = decode_file(Path::new(&cell.path), limits)?;
        if let Some(effect) = &spec.effect {
            effect.apply(&mut decoded.image, 1.0);
        }
        draw_cell(&mut canvas, cell, &decoded.image, border);
    }
    Ok(canvas)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain() -> CollageSpec {
        CollageSpec {
            width: 100,
            height: 100,
            background: Color::WHITE,
            transparent: false,
            cells: vec![],
            effect: None,
            border_width: 0,
            border_color: Color::WHITE,
            shadow: 0,
        }
    }

    #[test]
    fn border_effect_and_shadow() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.png");
        RgbaImage::from_pixel(80, 80, Rgba([200, 40, 40, 255]))
            .save(&a)
            .unwrap();
        let cell = CollageCell {
            path: a.display().to_string(),
            x: 20,
            y: 20,
            w: 60,
            h: 60,
            focus_x: 0.5,
            focus_y: 0.5,
            zoom: 1.0,
            fit: CellFit::Cover,
            radius: 0,
        };
        let spec = CollageSpec {
            cells: vec![cell],
            border_width: 5,
            border_color: Color::rgb(0, 0, 255),
            shadow: 60,
            effect: Some(AdjustSpec {
                saturation: -100.0,
                ..Default::default()
            }),
            ..plain()
        };
        let out = render_collage(&spec, &Limits::default()).unwrap();
        assert_eq!(out.get_pixel(22, 50).0, [0, 0, 255, 255], "border");
        let mid = out.get_pixel(50, 50).0;
        assert!(mid[0] == mid[1] && mid[1] == mid[2], "B&W effect: {mid:?}");
        let below = out.get_pixel(50, 83).0;
        assert!(below[0] < 255, "shadow darkens the gap below: {below:?}");
        assert_eq!(
            out.get_pixel(2, 2).0,
            [255, 255, 255, 255],
            "far from shadow"
        );
        let json = r##"{"width":10,"height":10,"background":"#ffffff","cells":[]}"##;
        let parsed: CollageSpec = serde_json::from_str(json).unwrap();
        assert_eq!(
            (parsed.border_width, parsed.shadow, parsed.effect),
            (0, 0, None)
        );
    }

    #[test]
    fn framing_matches_css_object_position() {
        // 400×200 photo in a 100×100 cell, cover: scale 0.5 -> 200×100, centred -> offset -50
        let f = framing(100.0, 100.0, 400.0, 200.0, CellFit::Cover, 1.0, 0.5, 0.5);
        assert_eq!(
            (f.draw_w, f.draw_h, f.offset_x, f.offset_y),
            (200.0, 100.0, -50.0, 0.0)
        );
        let f = framing(100.0, 100.0, 400.0, 200.0, CellFit::Cover, 1.0, 0.0, 0.5);
        assert_eq!(f.offset_x, 0.0);
        let f = framing(100.0, 100.0, 400.0, 200.0, CellFit::Contain, 1.0, 0.5, 0.5);
        assert_eq!((f.draw_w, f.draw_h, f.offset_y), (100.0, 50.0, 25.0));
        let f = framing(100.0, 100.0, 100.0, 100.0, CellFit::Cover, 2.0, 0.5, 0.5);
        assert_eq!((f.draw_w, f.offset_x), (200.0, -50.0));
    }

    #[test]
    fn renders_cells_with_gap_and_background() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.png");
        let b = dir.path().join("b.png");
        RgbaImage::from_pixel(300, 200, Rgba([255, 0, 0, 255]))
            .save(&a)
            .unwrap();
        RgbaImage::from_pixel(200, 300, Rgba([0, 0, 255, 255]))
            .save(&b)
            .unwrap();
        let cell = |p: &std::path::Path, x| CollageCell {
            path: p.display().to_string(),
            x,
            y: 10,
            w: 85,
            h: 180,
            focus_x: 0.5,
            focus_y: 0.5,
            zoom: 1.0,
            fit: CellFit::Cover,
            radius: 0,
        };
        let spec = CollageSpec {
            width: 200,
            height: 200,
            background: Color::WHITE,
            transparent: false,
            cells: vec![cell(&a, 10), cell(&b, 105)],
            ..plain()
        };
        let out = render_collage(&spec, &Limits::default()).unwrap();
        assert_eq!(out.dimensions(), (200, 200));
        assert_eq!(out.get_pixel(50, 100).0, [255, 0, 0, 255]);
        assert_eq!(out.get_pixel(150, 100).0, [0, 0, 255, 255]);
        assert_eq!(
            out.get_pixel(100, 100).0,
            [255, 255, 255, 255],
            "gap shows background"
        );
        assert_eq!(out.get_pixel(5, 5).0, [255, 255, 255, 255]);
    }

    #[test]
    fn rounded_corners_and_contain() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.png");
        RgbaImage::from_pixel(100, 50, Rgba([0, 200, 0, 255]))
            .save(&a)
            .unwrap();
        let spec = CollageSpec {
            width: 100,
            height: 100,
            background: Color::rgb(0, 0, 0),
            transparent: false,
            effect: None,
            border_width: 0,
            border_color: Color::WHITE,
            shadow: 0,
            cells: vec![CollageCell {
                path: a.display().to_string(),
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                focus_x: 0.5,
                focus_y: 0.5,
                zoom: 1.0,
                fit: CellFit::Contain,
                radius: 20,
            }],
        };
        let out = render_collage(&spec, &Limits::default()).unwrap();
        assert_eq!(out.get_pixel(50, 50).0, [0, 200, 0, 255]);
        assert_eq!(
            out.get_pixel(50, 10).0,
            [0, 0, 0, 255],
            "contain leaves bands"
        );
        let spec2 = CollageSpec {
            cells: vec![CollageCell {
                fit: CellFit::Cover,
                ..spec.cells[0].clone()
            }],
            ..spec
        };
        let out = render_collage(&spec2, &Limits::default()).unwrap();
        assert_eq!(out.get_pixel(1, 1).0, [0, 0, 0, 255], "corner rounded off");
        assert_eq!(out.get_pixel(50, 1).0, [0, 200, 0, 255]);
    }

    #[test]
    fn rejects_bad_specs() {
        let spec = CollageSpec {
            width: 100,
            height: 100,
            background: Color::WHITE,
            transparent: false,
            cells: vec![],
            ..plain()
        };
        assert!(spec.validate(&Limits::default()).is_err());
    }
}
