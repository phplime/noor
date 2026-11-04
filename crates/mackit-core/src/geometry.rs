//! Pure geometry: no pixels are touched here. Every transform first computes a
//! plan in full-resolution ("logical") pixel coordinates; the same plan drives
//! both the export and the scaled-down preview, so the preview cannot drift
//! from what is written to disk.

use crate::color::Color;
use crate::error::{EngineError, Result};
use serde::{Deserialize, Serialize};

/// Safety limits applied to every decode and every planned output.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Limits {
    /// Maximum width or height of any input or output image, in pixels.
    pub max_dimension: u32,
    /// Maximum number of pixels (width × height) of any input or output, in megapixels.
    pub max_megapixels: u32,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_dimension: 30_000,
            max_megapixels: 150,
        }
    }
}

impl Limits {
    pub fn max_pixels(&self) -> u64 {
        self.max_megapixels as u64 * 1_000_000
    }

    pub fn check(&self, w: u32, h: u32, what: &str) -> Result<()> {
        if w == 0 || h == 0 {
            return Err(EngineError::InvalidInput(format!(
                "{what} dimensions must be at least 1×1 px"
            )));
        }
        if w > self.max_dimension || h > self.max_dimension {
            return Err(EngineError::TooLarge(format!(
                "{what} size {w}×{h} exceeds the maximum of {} px per side (change it in Settings → Limits)",
                self.max_dimension
            )));
        }
        if (w as u64) * (h as u64) > self.max_pixels() {
            return Err(EngineError::TooLarge(format!(
                "{what} size {w}×{h} exceeds the {} megapixel limit (change it in Settings → Limits)",
                self.max_megapixels
            )));
        }
        Ok(())
    }
}

/// Where something sits inside a larger area.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Anchor {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    Center,
    CenterRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
    Custom,
}

/// Placement of an element inside a container. For `Custom`, `x`/`y` are the
/// fraction (0.0‒1.0) of the free space to the left/top of the element, so the
/// element always stays fully inside its container regardless of image size.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Placement {
    pub anchor: Anchor,
    pub x: f64,
    pub y: f64,
}

impl Default for Placement {
    fn default() -> Self {
        Placement {
            anchor: Anchor::Center,
            x: 0.5,
            y: 0.5,
        }
    }
}

impl Placement {
    pub fn at(anchor: Anchor) -> Self {
        Placement {
            anchor,
            ..Default::default()
        }
    }

    /// Horizontal/vertical fractions in 0..=1.
    pub fn fractions(&self) -> (f64, f64) {
        use Anchor::*;
        match self.anchor {
            TopLeft => (0.0, 0.0),
            TopCenter => (0.5, 0.0),
            TopRight => (1.0, 0.0),
            CenterLeft => (0.0, 0.5),
            Center => (0.5, 0.5),
            CenterRight => (1.0, 0.5),
            BottomLeft => (0.0, 1.0),
            BottomCenter => (0.5, 1.0),
            BottomRight => (1.0, 1.0),
            Custom => (clamp01(self.x), clamp01(self.y)),
        }
    }

    /// Position (top-left) of an element of `inner` size inside `outer`.
    /// Both sizes are in the same units. The result may be negative only if the
    /// element is larger than the container (callers guard against that where it matters).
    pub fn position(&self, outer_w: f64, outer_h: f64, inner_w: f64, inner_h: f64) -> (f64, f64) {
        let (fx, fy) = self.fractions();
        ((outer_w - inner_w) * fx, (outer_h - inner_h) * fy)
    }
}

fn clamp01(v: f64) -> f64 {
    if v.is_finite() {
        v.clamp(0.0, 1.0)
    } else {
        0.5
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResizeMode {
    /// Scale the whole image proportionally to fit inside W×H and pad the rest.
    Fit,
    /// Change the canvas to W×H and place the image on it (optionally scaled down). Never crops.
    Canvas,
    /// Resize to exactly W×H, ignoring the aspect ratio.
    Stretch,
    /// Scale the whole image by a percentage.
    Percent,
    /// Scale the whole image proportionally to fit inside W×H with no padding;
    /// the output takes the scaled image's own size (e.g. "max 1600×1600").
    Within,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Filter {
    Nearest,
    Bilinear,
    CatmullRom,
    #[default]
    Lanczos3,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Background {
    pub color: Color,
    pub transparent: bool,
}

impl Default for Background {
    fn default() -> Self {
        Background {
            color: Color::WHITE,
            transparent: false,
        }
    }
}

impl Background {
    pub fn fill(&self) -> [u8; 4] {
        if self.transparent {
            [0, 0, 0, 0]
        } else {
            let c = self.color;
            [c.r, c.g, c.b, 255]
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ResizeSpec {
    pub mode: ResizeMode,
    pub width: u32,
    pub height: u32,
    /// Used by `Percent` mode (e.g. 50.0 = half size).
    pub percent: f64,
    /// Canvas mode: when the image is larger than the canvas, scale it down
    /// proportionally instead of refusing. Never scales up.
    pub scale_image: bool,
    /// Fit mode: allow enlarging images smaller than the target.
    pub allow_upscale: bool,
    pub placement: Placement,
    pub background: Background,
    pub filter: Filter,
}

impl Default for ResizeSpec {
    fn default() -> Self {
        ResizeSpec {
            mode: ResizeMode::Fit,
            width: 1200,
            height: 628,
            percent: 100.0,
            scale_image: false,
            allow_upscale: true,
            placement: Placement::default(),
            background: Background::default(),
            filter: Filter::default(),
        }
    }
}

/// Result of planning a resize: the output canvas and where the (whole) image lands on it.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasPlan {
    pub canvas_w: u32,
    pub canvas_h: u32,
    pub image_x: u32,
    pub image_y: u32,
    pub image_w: u32,
    pub image_h: u32,
    /// True if any part of the canvas is not covered by the image.
    pub has_padding: bool,
    /// True if the aspect ratio of the image changes (Stretch mode only).
    pub distorted: bool,
}

pub const MAX_PERCENT: f64 = 1000.0;

/// Plan a resize. The returned plan always contains the complete source image:
/// `image_w`/`image_h` describe the entire source scaled, never a sub-region.
pub fn plan_resize(
    src_w: u32,
    src_h: u32,
    spec: &ResizeSpec,
    limits: &Limits,
) -> Result<CanvasPlan> {
    if src_w == 0 || src_h == 0 {
        return Err(EngineError::InvalidInput(
            "source image has no pixels".into(),
        ));
    }
    let (sw, sh) = (src_w as f64, src_h as f64);

    let (cw, ch, iw, ih) = match spec.mode {
        ResizeMode::Percent => {
            let p = spec.percent;
            if !(p.is_finite() && p > 0.0 && p <= MAX_PERCENT) {
                return Err(EngineError::InvalidInput(format!(
                    "scale percentage must be greater than 0 and at most {MAX_PERCENT}"
                )));
            }
            let w = round_dim(sw * p / 100.0);
            let h = round_dim(sh * p / 100.0);
            (w, h, w, h)
        }
        mode => {
            let (tw, th) = (spec.width, spec.height);
            if tw == 0 || th == 0 {
                return Err(EngineError::InvalidInput(
                    "width and height must be positive whole numbers".into(),
                ));
            }
            match mode {
                ResizeMode::Stretch => (tw, th, tw, th),
                ResizeMode::Fit => {
                    let mut s = (tw as f64 / sw).min(th as f64 / sh);
                    if !spec.allow_upscale {
                        s = s.min(1.0);
                    }
                    let iw = round_dim(sw * s).min(tw);
                    let ih = round_dim(sh * s).min(th);
                    (tw, th, iw, ih)
                }
                ResizeMode::Within => {
                    let mut s = (tw as f64 / sw).min(th as f64 / sh);
                    if !spec.allow_upscale {
                        s = s.min(1.0);
                    }
                    let iw = round_dim(sw * s).min(tw.max(src_w));
                    let ih = round_dim(sh * s).min(th.max(src_h));
                    (iw, ih, iw, ih)
                }
                ResizeMode::Canvas => {
                    if !spec.scale_image {
                        if src_w > tw || src_h > th {
                            return Err(EngineError::DoesNotFit {
                                src_w,
                                src_h,
                                canvas_w: tw,
                                canvas_h: th,
                            });
                        }
                        (tw, th, src_w, src_h)
                    } else {
                        let s = (tw as f64 / sw).min(th as f64 / sh).min(1.0);
                        let iw = round_dim(sw * s).min(tw);
                        let ih = round_dim(sh * s).min(th);
                        (tw, th, iw, ih)
                    }
                }
                ResizeMode::Percent => unreachable!(),
            }
        }
    };

    limits.check(cw, ch, "Output")?;

    let (x, y) = spec
        .placement
        .position(cw as f64, ch as f64, iw as f64, ih as f64);
    // The image is never larger than the canvas here, so x/y are within 0..=free.
    let x = (x.round().max(0.0) as u32).min(cw - iw);
    let y = (y.round().max(0.0) as u32).min(ch - ih);

    let distorted = spec.mode == ResizeMode::Stretch && {
        let src_ratio = sw / sh;
        let out_ratio = cw as f64 / ch as f64;
        // Ignore differences caused purely by rounding to whole pixels.
        let tolerance = (1.0 / cw as f64 + 1.0 / ch as f64) * src_ratio.max(out_ratio);
        (src_ratio - out_ratio).abs() > tolerance
    };

    Ok(CanvasPlan {
        canvas_w: cw,
        canvas_h: ch,
        image_x: x,
        image_y: y,
        image_w: iw,
        image_h: ih,
        has_padding: iw < cw || ih < ch,
        distorted,
    })
}

fn round_dim(v: f64) -> u32 {
    let r = v.round();
    if r < 1.0 {
        1
    } else if r > u32::MAX as f64 {
        u32::MAX
    } else {
        r as u32
    }
}

/// Explicit crop rectangle in source pixel coordinates.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CropSpec {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl CropSpec {
    pub fn validate(&self, src_w: u32, src_h: u32) -> Result<()> {
        if self.width == 0 || self.height == 0 {
            return Err(EngineError::InvalidInput(
                "crop area must be at least 1×1 px".into(),
            ));
        }
        let fits_x = self.x.checked_add(self.width).is_some_and(|r| r <= src_w);
        let fits_y = self.y.checked_add(self.height).is_some_and(|b| b <= src_h);
        if !fits_x || !fits_y {
            return Err(EngineError::InvalidInput(format!(
                "crop area {}×{} at ({}, {}) is outside the {src_w}×{src_h} image",
                self.width, self.height, self.x, self.y
            )));
        }
        Ok(())
    }
}

/// Parse an aspect ratio such as "16:9", "590:300" or "1.91:1".
pub fn parse_ratio(s: &str) -> Option<(f64, f64)> {
    let (a, b) = s.split_once([':', 'x', '×', '/'])?;
    let a: f64 = a.trim().parse().ok()?;
    let b: f64 = b.trim().parse().ok()?;
    (a.is_finite() && b.is_finite() && a > 0.0 && b > 0.0).then_some((a, b))
}

/// Largest rectangle of the given aspect ratio that fits inside `w`×`h`, centred.
pub fn max_crop_for_ratio(w: u32, h: u32, ratio_w: f64, ratio_h: f64) -> CropSpec {
    let r = ratio_w / ratio_h;
    let (cw, ch) = if (w as f64) / (h as f64) > r {
        let ch = h;
        let cw = round_dim(h as f64 * r).min(w);
        (cw, ch)
    } else {
        let cw = w;
        let ch = round_dim(w as f64 / r).min(h);
        (cw, ch)
    };
    CropSpec {
        x: (w - cw) / 2,
        y: (h - ch) / 2,
        width: cw,
        height: ch,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(mode: ResizeMode, w: u32, h: u32) -> ResizeSpec {
        ResizeSpec {
            mode,
            width: w,
            height: h,
            ..Default::default()
        }
    }

    #[test]
    fn fit_landscape_into_590x300_keeps_whole_image() {
        let p = plan_resize(
            1200,
            800,
            &spec(ResizeMode::Fit, 590, 300),
            &Limits::default(),
        )
        .unwrap();
        assert_eq!((p.canvas_w, p.canvas_h), (590, 300));
        // limiting side is height: 300/800 = 0.375 -> 450×300
        assert_eq!((p.image_w, p.image_h), (450, 300));
        assert_eq!((p.image_x, p.image_y), (70, 0));
        assert!(p.has_padding);
        assert!(!p.distorted);
    }

    #[test]
    fn fit_into_square_thumbnail_letterboxes() {
        let p = plan_resize(
            1200,
            800,
            &spec(ResizeMode::Fit, 80, 80),
            &Limits::default(),
        )
        .unwrap();
        assert_eq!((p.canvas_w, p.canvas_h), (80, 80));
        assert_eq!((p.image_w, p.image_h), (80, 53));
        // centred vertically: (80 - 53) / 2 = 13.5 -> 14
        assert_eq!(p.image_x, 0);
        assert!(p.image_y == 13 || p.image_y == 14);
    }

    #[test]
    fn fit_respects_no_upscale() {
        let mut s = spec(ResizeMode::Fit, 1000, 1000);
        s.allow_upscale = false;
        let p = plan_resize(200, 100, &s, &Limits::default()).unwrap();
        assert_eq!((p.image_w, p.image_h), (200, 100));
        assert_eq!((p.image_x, p.image_y), (400, 450));
    }

    #[test]
    fn canvas_preserves_original_scale() {
        let p = plan_resize(
            800,
            600,
            &spec(ResizeMode::Canvas, 1200, 1000),
            &Limits::default(),
        )
        .unwrap();
        assert_eq!((p.canvas_w, p.canvas_h), (1200, 1000));
        assert_eq!((p.image_w, p.image_h), (800, 600));
        assert_eq!((p.image_x, p.image_y), (200, 200));
    }

    #[test]
    fn canvas_alignment_edges() {
        let mut s = spec(ResizeMode::Canvas, 1200, 1000);
        s.placement = Placement::at(Anchor::BottomRight);
        let p = plan_resize(800, 600, &s, &Limits::default()).unwrap();
        assert_eq!((p.image_x, p.image_y), (400, 400));
        s.placement = Placement::at(Anchor::TopLeft);
        let p = plan_resize(800, 600, &s, &Limits::default()).unwrap();
        assert_eq!((p.image_x, p.image_y), (0, 0));
        s.placement = Placement {
            anchor: Anchor::Custom,
            x: 0.25,
            y: 1.0,
        };
        let p = plan_resize(800, 600, &s, &Limits::default()).unwrap();
        assert_eq!((p.image_x, p.image_y), (100, 400));
        // out-of-range custom values are clamped, never pushing the image off-canvas
        s.placement = Placement {
            anchor: Anchor::Custom,
            x: 7.0,
            y: -3.0,
        };
        let p = plan_resize(800, 600, &s, &Limits::default()).unwrap();
        assert_eq!((p.image_x, p.image_y), (400, 0));
    }

    #[test]
    fn canvas_smaller_than_image_refuses_instead_of_cropping() {
        let err = plan_resize(
            1200,
            800,
            &spec(ResizeMode::Canvas, 590, 300),
            &Limits::default(),
        )
        .unwrap_err();
        match err {
            EngineError::DoesNotFit {
                src_w,
                src_h,
                canvas_w,
                canvas_h,
            } => {
                assert_eq!((src_w, src_h, canvas_w, canvas_h), (1200, 800, 590, 300));
            }
            e => panic!("unexpected {e:?}"),
        }
    }

    #[test]
    fn canvas_with_scaling_shrinks_but_never_enlarges() {
        let mut s = spec(ResizeMode::Canvas, 590, 300);
        s.scale_image = true;
        let p = plan_resize(1200, 800, &s, &Limits::default()).unwrap();
        assert_eq!((p.image_w, p.image_h), (450, 300));
        let mut s = spec(ResizeMode::Canvas, 2000, 2000);
        s.scale_image = true;
        let p = plan_resize(1200, 800, &s, &Limits::default()).unwrap();
        assert_eq!((p.image_w, p.image_h), (1200, 800));
    }

    #[test]
    fn stretch_is_exact_and_flags_distortion() {
        let p = plan_resize(
            1200,
            800,
            &spec(ResizeMode::Stretch, 590, 300),
            &Limits::default(),
        )
        .unwrap();
        assert_eq!(
            (p.canvas_w, p.canvas_h, p.image_w, p.image_h),
            (590, 300, 590, 300)
        );
        assert!(p.distorted);
        assert!(!p.has_padding);
        let p = plan_resize(
            1200,
            800,
            &spec(ResizeMode::Stretch, 600, 400),
            &Limits::default(),
        )
        .unwrap();
        assert!(!p.distorted);
        // rounding alone does not count as distortion
        let p = plan_resize(
            1000,
            333,
            &spec(ResizeMode::Stretch, 500, 167),
            &Limits::default(),
        )
        .unwrap();
        assert!(!p.distorted);
    }

    #[test]
    fn percent_scaling() {
        let mut s = spec(ResizeMode::Percent, 0, 0);
        for (pct, w, h) in [
            (25.0, 300, 200),
            (50.0, 600, 400),
            (75.0, 900, 600),
            (150.0, 1800, 1200),
            (200.0, 2400, 1600),
        ] {
            s.percent = pct;
            let p = plan_resize(1200, 800, &s, &Limits::default()).unwrap();
            assert_eq!((p.canvas_w, p.canvas_h), (w, h));
            assert_eq!((p.image_w, p.image_h), (w, h));
        }
        s.percent = 0.0;
        assert!(plan_resize(1200, 800, &s, &Limits::default()).is_err());
        s.percent = 0.01;
        let p = plan_resize(10, 10, &s, &Limits::default()).unwrap();
        assert_eq!((p.canvas_w, p.canvas_h), (1, 1));
    }

    #[test]
    fn within_scales_without_padding() {
        let mut s = spec(ResizeMode::Within, 1600, 1600);
        let p = plan_resize(4000, 3000, &s, &Limits::default()).unwrap();
        assert_eq!(
            (p.canvas_w, p.canvas_h, p.image_w, p.image_h),
            (1600, 1200, 1600, 1200)
        );
        assert!(!p.has_padding);
        s.allow_upscale = false;
        let p = plan_resize(800, 600, &s, &Limits::default()).unwrap();
        assert_eq!((p.canvas_w, p.canvas_h), (800, 600));
        s.allow_upscale = true;
        let p = plan_resize(800, 600, &s, &Limits::default()).unwrap();
        assert_eq!((p.canvas_w, p.canvas_h), (1600, 1200));
    }

    #[test]
    fn limits_are_enforced() {
        let limits = Limits {
            max_dimension: 1000,
            max_megapixels: 1,
        };
        assert!(matches!(
            plan_resize(10, 10, &spec(ResizeMode::Stretch, 1001, 10), &limits),
            Err(EngineError::TooLarge(_))
        ));
        assert!(plan_resize(10, 10, &spec(ResizeMode::Stretch, 1000, 1000), &limits).is_ok());
        let limits = Limits {
            max_dimension: 5000,
            max_megapixels: 1,
        };
        assert!(plan_resize(10, 10, &spec(ResizeMode::Stretch, 2000, 1000), &limits).is_err());
        assert!(plan_resize(10, 10, &spec(ResizeMode::Fit, 0, 10), &limits).is_err());
    }

    #[test]
    fn non_crop_modes_always_contain_the_whole_image() {
        // Exhaustive-ish sweep: for every mode, the planned image rect is the entire
        // source scaled (positive size) and lies completely inside the canvas.
        let sizes = [
            (1, 1),
            (1200, 800),
            (800, 1200),
            (37, 3001),
            (5000, 7),
            (640, 640),
        ];
        let targets = [
            (1, 1),
            (80, 80),
            (590, 300),
            (300, 590),
            (1920, 1080),
            (7, 4000),
        ];
        for &(sw, sh) in &sizes {
            for &(tw, th) in &targets {
                for mode in [
                    ResizeMode::Fit,
                    ResizeMode::Canvas,
                    ResizeMode::Stretch,
                    ResizeMode::Percent,
                    ResizeMode::Within,
                ] {
                    for scale_image in [false, true] {
                        let mut s = spec(mode, tw, th);
                        s.scale_image = scale_image;
                        s.percent = 37.0;
                        match plan_resize(sw, sh, &s, &Limits::default()) {
                            Ok(p) => {
                                assert!(p.image_w >= 1 && p.image_h >= 1);
                                assert!(
                                    p.image_x + p.image_w <= p.canvas_w,
                                    "{mode:?} {sw}x{sh}->{tw}x{th}"
                                );
                                assert!(p.image_y + p.image_h <= p.canvas_h);
                                if matches!(
                                    mode,
                                    ResizeMode::Fit | ResizeMode::Canvas | ResizeMode::Within
                                ) {
                                    // aspect ratio preserved within one pixel of rounding
                                    let expected_h = p.image_w as f64 * sh as f64 / sw as f64;
                                    let expected_w = p.image_h as f64 * sw as f64 / sh as f64;
                                    assert!(
                                        (expected_h - p.image_h as f64).abs() <= 1.0
                                            || (expected_w - p.image_w as f64).abs() <= 1.0,
                                        "{mode:?} {sw}x{sh}->{tw}x{th} gave {}x{}",
                                        p.image_w,
                                        p.image_h
                                    );
                                }
                            }
                            Err(EngineError::DoesNotFit { .. }) => {
                                assert_eq!(mode, ResizeMode::Canvas);
                                assert!(!scale_image);
                            }
                            Err(e) => panic!("{e}"),
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn crop_validation() {
        assert!(CropSpec {
            x: 0,
            y: 0,
            width: 10,
            height: 10
        }
        .validate(10, 10)
        .is_ok());
        assert!(CropSpec {
            x: 1,
            y: 0,
            width: 10,
            height: 10
        }
        .validate(10, 10)
        .is_err());
        assert!(CropSpec {
            x: 0,
            y: 0,
            width: 0,
            height: 10
        }
        .validate(10, 10)
        .is_err());
        assert!(CropSpec {
            x: u32::MAX,
            y: 0,
            width: 2,
            height: 1
        }
        .validate(10, 10)
        .is_err());
    }

    #[test]
    fn ratio_parsing_and_max_crop() {
        assert_eq!(parse_ratio("590:300"), Some((590.0, 300.0)));
        assert_eq!(parse_ratio("1920x1080"), Some((1920.0, 1080.0)));
        assert_eq!(parse_ratio("1.91 : 1"), Some((1.91, 1.0)));
        assert_eq!(parse_ratio("0:1"), None);
        assert_eq!(parse_ratio("-1:1"), None);
        assert_eq!(parse_ratio("abc"), None);

        let c = max_crop_for_ratio(1200, 800, 1.0, 1.0);
        assert_eq!(
            c,
            CropSpec {
                x: 200,
                y: 0,
                width: 800,
                height: 800
            }
        );
        let c = max_crop_for_ratio(1200, 800, 590.0, 300.0);
        assert_eq!((c.width, c.height), (1200, 610));
        assert_eq!(c.y, 95);
        let c = max_crop_for_ratio(1200, 800, 9.0, 16.0);
        assert_eq!((c.width, c.height), (450, 800));
    }
}
