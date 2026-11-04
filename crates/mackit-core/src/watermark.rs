//! Logo and text watermark layout + rendering.

use crate::color::Color;
use crate::error::{EngineError, Result};
use crate::geometry::Filter;
use crate::geometry::{Anchor, Placement};
use crate::pixels::{blend_over, resample};
use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

static FONT_REGULAR: &[u8] = include_bytes!("../assets/fonts/DejaVuSans.ttf");
static FONT_BOLD: &[u8] = include_bytes!("../assets/fonts/DejaVuSans-Bold.ttf");

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WatermarkKind {
    Logo,
    Text,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SizeUnit {
    /// Absolute pixels of the image being watermarked.
    Pixels,
    /// Percentage of the watermarked image's width (scales with each image in a batch).
    PercentOfWidth,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WatermarkSpec {
    pub kind: WatermarkKind,

    // Logo
    pub logo_path: Option<String>,
    pub logo_size_unit: SizeUnit,
    /// Logo width as % of image width (when `logo_size_unit` = PercentOfWidth).
    pub logo_percent: f64,
    pub logo_width: u32,
    pub logo_height: u32,
    /// Keep the logo's aspect ratio (height derived from width).
    pub keep_aspect: bool,

    // Text
    pub text: String,
    pub font_size: f64,
    pub font_size_unit: SizeUnit,
    pub color: Color,
    pub bold: bool,

    // Shared
    /// 0.0 (invisible) ..= 1.0 (opaque)
    pub opacity: f64,
    pub placement: Placement,
    pub margin_x: f64,
    pub margin_y: f64,
    pub margin_unit: SizeUnit,
}

impl Default for WatermarkSpec {
    fn default() -> Self {
        WatermarkSpec {
            kind: WatermarkKind::Logo,
            logo_path: None,
            logo_size_unit: SizeUnit::PercentOfWidth,
            logo_percent: 20.0,
            logo_width: 200,
            logo_height: 200,
            keep_aspect: true,
            text: String::new(),
            font_size: 4.0,
            font_size_unit: SizeUnit::PercentOfWidth,
            color: Color::WHITE,
            bold: false,
            opacity: 0.8,
            placement: Placement::at(Anchor::BottomRight),
            margin_x: 2.0,
            margin_y: 2.0,
            margin_unit: SizeUnit::PercentOfWidth,
        }
    }
}

/// Planned watermark rectangle in logical (full-resolution) image pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

fn resolve(v: f64, unit: SizeUnit, img_w: f64) -> f64 {
    let v = if v.is_finite() { v.max(0.0) } else { 0.0 };
    match unit {
        SizeUnit::Pixels => v,
        SizeUnit::PercentOfWidth => img_w * v / 100.0,
    }
}

impl WatermarkSpec {
    pub fn validate(&self) -> Result<()> {
        if !(self.opacity.is_finite() && (0.0..=1.0).contains(&self.opacity)) {
            return Err(EngineError::InvalidInput(
                "opacity must be between 0% and 100%".into(),
            ));
        }
        match self.kind {
            WatermarkKind::Logo => {
                if self
                    .logo_path
                    .as_deref()
                    .is_none_or(|p| p.trim().is_empty())
                {
                    return Err(EngineError::InvalidInput("choose a logo image".into()));
                }
                match self.logo_size_unit {
                    SizeUnit::PercentOfWidth
                        if !(self.logo_percent > 0.0 && self.logo_percent <= 100.0) =>
                    {
                        return Err(EngineError::InvalidInput(
                            "logo size must be between 0% and 100% of the image width".into(),
                        ))
                    }
                    SizeUnit::Pixels
                        if self.logo_width == 0 || (!self.keep_aspect && self.logo_height == 0) =>
                    {
                        return Err(EngineError::InvalidInput(
                            "logo width and height must be positive".into(),
                        ))
                    }
                    _ => {}
                }
            }
            WatermarkKind::Text => {
                if self.text.trim().is_empty() {
                    return Err(EngineError::InvalidInput("enter the watermark text".into()));
                }
                if !(self.font_size.is_finite() && self.font_size > 0.0) {
                    return Err(EngineError::InvalidInput(
                        "font size must be positive".into(),
                    ));
                }
            }
        }
        Ok(())
    }

    fn margins(&self, img_w: f64) -> (f64, f64) {
        (
            resolve(self.margin_x, self.margin_unit, img_w),
            resolve(self.margin_y, self.margin_unit, img_w),
        )
    }

    fn place(&self, img_w: f64, img_h: f64, w: f64, h: f64) -> MarkRect {
        let (mx, my) = self.margins(img_w);
        let area_w = (img_w - 2.0 * mx).max(0.0);
        let area_h = (img_h - 2.0 * my).max(0.0);
        let (px, py) = self.placement.position(area_w, area_h, w, h);
        MarkRect {
            x: mx + px,
            y: my + py,
            w,
            h,
        }
    }

    /// Logical size of the logo on an image of `img_w`×`img_h`.
    pub fn logo_size(&self, img_w: f64, img_h: f64, logo_w: u32, logo_h: u32) -> (f64, f64) {
        let aspect = logo_h.max(1) as f64 / logo_w.max(1) as f64;
        let (mut w, mut h) = match self.logo_size_unit {
            SizeUnit::PercentOfWidth => {
                let w = img_w * self.logo_percent / 100.0;
                (w, w * aspect)
            }
            SizeUnit::Pixels => {
                let w = self.logo_width as f64;
                let h = if self.keep_aspect {
                    w * aspect
                } else {
                    self.logo_height as f64
                };
                (w, h)
            }
        };
        // Never let the logo exceed the image itself; shrink proportionally.
        let fit = (img_w / w).min(img_h / h).min(1.0);
        if fit < 1.0 {
            w *= fit;
            h *= fit;
        }
        (w.max(1.0), h.max(1.0))
    }

    /// Rectangle the mark may move within (image minus margins), in logical pixels.
    pub fn movable_area(&self, img_w: f64, img_h: f64) -> MarkRect {
        let (mx, my) = self.margins(img_w);
        MarkRect {
            x: mx,
            y: my,
            w: (img_w - 2.0 * mx).max(0.0),
            h: (img_h - 2.0 * my).max(0.0),
        }
    }

    pub fn plan_logo(&self, img_w: f64, img_h: f64, logo_w: u32, logo_h: u32) -> MarkRect {
        let (w, h) = self.logo_size(img_w, img_h, logo_w, logo_h);
        self.place(img_w, img_h, w, h)
    }

    pub fn font_px(&self, img_w: f64) -> f64 {
        resolve(self.font_size, self.font_size_unit, img_w).max(1.0)
    }

    pub fn plan_text(&self, img_w: f64, img_h: f64) -> MarkRect {
        let layout = TextLayout::new(&self.text, self.font_px(img_w) as f32, self.bold);
        self.place(img_w, img_h, layout.width as f64, layout.height as f64)
    }
}

/// Apply a logo watermark. `scale` maps logical image pixels to buffer pixels
/// (1.0 for export; < 1.0 for previews rendered from a downscaled source).
pub fn apply_logo(
    img: &mut RgbaImage,
    logical_w: f64,
    logical_h: f64,
    spec: &WatermarkSpec,
    logo: &RgbaImage,
) {
    let scale = img.width() as f64 / logical_w;
    let r = spec.plan_logo(logical_w, logical_h, logo.width(), logo.height());
    let w = (r.w * scale).round().max(1.0) as u32;
    let h = (r.h * scale).round().max(1.0) as u32;
    let sized = resample(logo, w, h, Filter::Lanczos3);
    blend_over(
        img,
        &sized,
        (r.x * scale).round() as i64,
        (r.y * scale).round() as i64,
        spec.opacity as f32,
    );
}

pub fn apply_text(img: &mut RgbaImage, logical_w: f64, logical_h: f64, spec: &WatermarkSpec) {
    let scale = img.width() as f64 / logical_w;
    let r = spec.plan_text(logical_w, logical_h);
    let px = (spec.font_px(logical_w) * scale) as f32;
    let layout = TextLayout::new(&spec.text, px, spec.bold);
    let (fx, _) = spec.placement.fractions();
    let layer = layout.render(spec.color, fx as f32);
    blend_over(
        img,
        &layer,
        (r.x * scale).round() as i64,
        (r.y * scale).round() as i64,
        spec.opacity as f32,
    );
}

struct TextLayout<'a> {
    font: FontRef<'static>,
    px: f32,
    lines: Vec<(&'a str, f32)>,
    width: f32,
    height: f32,
    ascent: f32,
    line_h: f32,
}

impl<'a> TextLayout<'a> {
    fn new(text: &'a str, px: f32, bold: bool) -> Self {
        let font = FontRef::try_from_slice(if bold { FONT_BOLD } else { FONT_REGULAR })
            .expect("bundled font is valid");
        let px = px.max(1.0);
        let sf = font.as_scaled(PxScale::from(px));
        let ascent = sf.ascent();
        let descent = sf.descent();
        let line_h = ascent - descent + sf.line_gap();
        let lines: Vec<(&str, f32)> = text
            .split('\n')
            .map(|l| l.trim_end_matches('\r'))
            .map(|l| {
                let mut w = 0.0f32;
                let mut prev = None;
                for c in l.chars() {
                    let id = font.glyph_id(c);
                    if let Some(p) = prev {
                        w += sf.kern(p, id);
                    }
                    w += sf.h_advance(id);
                    prev = Some(id);
                }
                (l, w)
            })
            .collect();
        let width = lines
            .iter()
            .map(|l| l.1)
            .fold(0.0, f32::max)
            .ceil()
            .max(1.0);
        let height = ((lines.len().max(1) - 1) as f32 * line_h + ascent - descent)
            .ceil()
            .max(1.0);
        TextLayout {
            font,
            px,
            lines,
            width,
            height,
            ascent,
            line_h,
        }
    }

    /// Render into a transparent layer. `align` is the horizontal alignment of each
    /// line inside the block (0 = left, 0.5 = centre, 1 = right).
    fn render(&self, color: Color, align: f32) -> RgbaImage {
        let (w, h) = (self.width as u32, self.height as u32);
        let mut coverage = vec![0f32; (w as usize) * (h as usize)];
        let scale = PxScale::from(self.px);
        let sf = self.font.as_scaled(scale);
        for (i, (line, lw)) in self.lines.iter().enumerate() {
            let baseline = self.ascent + i as f32 * self.line_h;
            let mut x = (self.width - lw) * align;
            let mut prev = None;
            for c in line.chars() {
                let id = self.font.glyph_id(c);
                if let Some(p) = prev {
                    x += sf.kern(p, id);
                }
                let glyph = id.with_scale_and_position(scale, ab_glyph::point(x, baseline));
                x += sf.h_advance(id);
                prev = Some(id);
                if let Some(outlined) = self.font.outline_glyph(glyph) {
                    let b = outlined.px_bounds();
                    outlined.draw(|gx, gy, cov| {
                        let px = b.min.x as i32 + gx as i32;
                        let py = b.min.y as i32 + gy as i32;
                        if px >= 0 && py >= 0 && (px as u32) < w && (py as u32) < h {
                            let idx = py as usize * w as usize + px as usize;
                            coverage[idx] = coverage[idx].max(cov.clamp(0.0, 1.0));
                        }
                    });
                }
            }
        }
        let mut layer = RgbaImage::new(w, h);
        for (p, cov) in layer.pixels_mut().zip(coverage) {
            let a = (cov * color.a as f32).round() as u8;
            *p = Rgba([color.r, color.g, color.b, a]);
        }
        layer
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn logo_spec(anchor: Anchor) -> WatermarkSpec {
        WatermarkSpec {
            logo_path: Some("x".into()),
            placement: Placement::at(anchor),
            margin_x: 10.0,
            margin_y: 20.0,
            margin_unit: SizeUnit::Pixels,
            logo_size_unit: SizeUnit::Pixels,
            logo_width: 100,
            ..Default::default()
        }
    }

    #[test]
    fn logo_positions_respect_margins() {
        // logo 200×100 source, requested 100 px wide -> 100×50
        let s = logo_spec(Anchor::BottomRight);
        let r = s.plan_logo(1000.0, 800.0, 200, 100);
        assert_eq!((r.w, r.h), (100.0, 50.0));
        assert_eq!((r.x, r.y), (1000.0 - 10.0 - 100.0, 800.0 - 20.0 - 50.0));
        let r = logo_spec(Anchor::TopLeft).plan_logo(1000.0, 800.0, 200, 100);
        assert_eq!((r.x, r.y), (10.0, 20.0));
        let r = logo_spec(Anchor::Center).plan_logo(1000.0, 800.0, 200, 100);
        assert_eq!((r.x, r.y), (450.0, 375.0));
        let r = logo_spec(Anchor::TopCenter).plan_logo(1000.0, 800.0, 200, 100);
        assert_eq!((r.x, r.y), (450.0, 20.0));
        let r = logo_spec(Anchor::BottomCenter).plan_logo(1000.0, 800.0, 200, 100);
        assert_eq!((r.x, r.y), (450.0, 730.0));
    }

    #[test]
    fn percent_sizing_scales_with_image() {
        let s = WatermarkSpec {
            logo_size_unit: SizeUnit::PercentOfWidth,
            logo_percent: 25.0,
            ..logo_spec(Anchor::TopLeft)
        };
        assert_eq!(s.logo_size(2000.0, 1000.0, 400, 200), (500.0, 250.0));
        assert_eq!(s.logo_size(800.0, 600.0, 400, 200), (200.0, 100.0));
    }

    #[test]
    fn logo_never_exceeds_image() {
        let s = WatermarkSpec {
            logo_width: 5000,
            ..logo_spec(Anchor::Center)
        };
        let (w, h) = s.logo_size(1000.0, 300.0, 100, 100);
        assert!(w <= 1000.0 && h <= 300.0);
        assert!((w - h).abs() < 1e-9);
    }

    #[test]
    fn opacity_is_applied() {
        let mut img = RgbaImage::from_pixel(100, 100, Rgba([0, 0, 0, 255]));
        let logo = RgbaImage::from_pixel(10, 10, Rgba([255, 255, 255, 255]));
        let s = WatermarkSpec {
            opacity: 0.5,
            logo_width: 10,
            margin_x: 0.0,
            margin_y: 0.0,
            ..logo_spec(Anchor::TopLeft)
        };
        apply_logo(&mut img, 100.0, 100.0, &s, &logo);
        let p = img.get_pixel(5, 5).0;
        assert!((126..=129).contains(&p[0]), "{p:?}");
        assert_eq!(img.get_pixel(50, 50).0, [0, 0, 0, 255]);
    }

    #[test]
    fn transparent_logo_regions_stay_transparent() {
        let mut img = RgbaImage::from_pixel(50, 50, Rgba([10, 20, 30, 255]));
        let mut logo = RgbaImage::from_pixel(20, 20, Rgba([255, 0, 0, 0]));
        logo.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        let s = WatermarkSpec {
            opacity: 1.0,
            logo_width: 20,
            margin_x: 0.0,
            margin_y: 0.0,
            ..logo_spec(Anchor::TopLeft)
        };
        apply_logo(&mut img, 50.0, 50.0, &s, &logo);
        assert_eq!(img.get_pixel(10, 10).0, [10, 20, 30, 255]);
    }

    #[test]
    fn text_renders_inside_planned_rect() {
        let s = WatermarkSpec {
            kind: WatermarkKind::Text,
            text: "© MacKit\nline two".into(),
            font_size: 40.0,
            font_size_unit: SizeUnit::Pixels,
            color: Color::rgb(255, 0, 0),
            opacity: 1.0,
            placement: Placement::at(Anchor::BottomLeft),
            margin_x: 15.0,
            margin_y: 15.0,
            margin_unit: SizeUnit::Pixels,
            ..Default::default()
        };
        s.validate().unwrap();
        let r = s.plan_text(800.0, 600.0);
        assert!(r.h >= 75.0, "two lines of 40px text: {r:?}");
        assert_eq!(r.x, 15.0);
        assert!((r.y + r.h - 585.0).abs() < 1e-6);
        let mut img = RgbaImage::from_pixel(800, 600, Rgba([255, 255, 255, 255]));
        apply_text(&mut img, 800.0, 600.0, &s);
        let mut red_inside = 0;
        for (x, y, p) in img.enumerate_pixels() {
            let changed = p.0 != [255, 255, 255, 255];
            let inside = (x as f64) >= r.x - 1.0
                && (x as f64) <= r.x + r.w + 1.0
                && (y as f64) >= r.y - 1.0
                && (y as f64) <= r.y + r.h + 1.0;
            assert!(
                !changed || inside,
                "pixel outside planned rect changed at {x},{y}"
            );
            if changed {
                red_inside += 1;
            }
        }
        assert!(red_inside > 500);
    }

    #[test]
    fn validation() {
        assert!(WatermarkSpec::default().validate().is_err()); // no logo
        let s = WatermarkSpec {
            kind: WatermarkKind::Text,
            text: "  ".into(),
            ..Default::default()
        };
        assert!(s.validate().is_err());
        let s = WatermarkSpec {
            logo_path: Some("a.png".into()),
            opacity: 1.5,
            ..Default::default()
        };
        assert!(s.validate().is_err());
    }
}

/// Where a watermark lands, plus the area it can be dragged within. Used by the
/// UI for drag-to-position: custom X/Y = (rect.x - area.x) / (area.w - rect.w).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkLayout {
    pub rect: MarkRect,
    pub area: MarkRect,
}
