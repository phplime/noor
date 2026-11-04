//! Photo adjustments: orientation (rotate / flip), light, color, tone curves,
//! detail and vignette. All operations keep the alpha channel untouched and
//! never change content outside of what the user dials in.
//!
//! Slider values use a -100..=100 scale (sharpness and vignette 0..=100), where
//! 0 always means "no change"; a default `AdjustSpec` is an exact identity.

use crate::error::{EngineError, Result};
use image::RgbaImage;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

/// Rotation (clockwise) and mirroring. Rotating by 90/270 swaps width and height,
/// e.g. to turn a landscape photo into portrait.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TransformSpec {
    /// 0, 90, 180 or 270 degrees clockwise.
    pub rotate: u16,
    pub flip_h: bool,
    pub flip_v: bool,
}

impl TransformSpec {
    pub fn validate(&self) -> Result<()> {
        if ![0, 90, 180, 270].contains(&self.rotate) {
            return Err(EngineError::InvalidInput(
                "rotation must be 0, 90, 180 or 270 degrees".into(),
            ));
        }
        Ok(())
    }

    pub fn output_size(&self, w: u32, h: u32) -> (u32, u32) {
        if self.rotate == 90 || self.rotate == 270 {
            (h, w)
        } else {
            (w, h)
        }
    }

    pub fn apply(&self, img: &RgbaImage) -> RgbaImage {
        use image::imageops;
        let mut out = match self.rotate {
            90 => imageops::rotate90(img),
            180 => imageops::rotate180(img),
            270 => imageops::rotate270(img),
            _ => img.clone(),
        };
        if self.flip_h {
            imageops::flip_horizontal_in_place(&mut out);
        }
        if self.flip_v {
            imageops::flip_vertical_in_place(&mut out);
        }
        out
    }
}

/// A tone curve as control points (input, output) in 0..=1. Fewer than two
/// points, or exactly the diagonal, means "no change".
pub type CurvePoints = Vec<[f64; 2]>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Curves {
    /// Applied to all three channels.
    pub rgb: CurvePoints,
    pub red: CurvePoints,
    pub green: CurvePoints,
    pub blue: CurvePoints,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AdjustSpec {
    /// Per-image automatic levels (stretches the tonal range, no color cast).
    pub auto_enhance: bool,
    // Light
    pub exposure: f64,
    pub brightness: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
    // Color
    pub temperature: f64,
    pub tint: f64,
    pub saturation: f64,
    pub vibrance: f64,
    // Detail & effects
    pub sharpness: f64,
    pub vignette: f64,
    pub curves: Curves,
}

fn check(name: &str, v: f64, lo: f64, hi: f64) -> Result<()> {
    if v.is_finite() && v >= lo && v <= hi {
        Ok(())
    } else {
        Err(EngineError::InvalidInput(format!(
            "{name} must be between {lo} and {hi}"
        )))
    }
}

impl AdjustSpec {
    pub fn validate(&self) -> Result<()> {
        for (n, v) in [
            ("exposure", self.exposure),
            ("brightness", self.brightness),
            ("contrast", self.contrast),
            ("highlights", self.highlights),
            ("shadows", self.shadows),
            ("temperature", self.temperature),
            ("tint", self.tint),
            ("saturation", self.saturation),
            ("vibrance", self.vibrance),
        ] {
            check(n, v, -100.0, 100.0)?;
        }
        check("sharpness", self.sharpness, 0.0, 100.0)?;
        check("vignette", self.vignette, 0.0, 100.0)?;
        for c in [
            &self.curves.rgb,
            &self.curves.red,
            &self.curves.green,
            &self.curves.blue,
        ] {
            if c.len() > 32 {
                return Err(EngineError::InvalidInput(
                    "a curve can have at most 32 points".into(),
                ));
            }
            if c.iter()
                .flatten()
                .any(|v| !v.is_finite() || *v < 0.0 || *v > 1.0)
            {
                return Err(EngineError::InvalidInput(
                    "curve points must be between 0 and 1".into(),
                ));
            }
        }
        Ok(())
    }

    pub fn is_identity(&self) -> bool {
        let curves_identity = [
            &self.curves.rgb,
            &self.curves.red,
            &self.curves.green,
            &self.curves.blue,
        ]
        .iter()
        .all(|c| curve_is_identity(c));
        !self.auto_enhance
            && [
                self.exposure,
                self.brightness,
                self.contrast,
                self.highlights,
                self.shadows,
                self.temperature,
                self.tint,
                self.saturation,
                self.vibrance,
                self.sharpness,
                self.vignette,
            ]
            .iter()
            .all(|v| *v == 0.0)
            && curves_identity
    }

    /// Apply in place. `scale` is buffer px per logical px (for previews), used to
    /// keep the sharpening radius visually identical to the export.
    #[allow(clippy::needless_range_loop)]
    pub fn apply(&self, img: &mut RgbaImage, scale: f64) {
        if self.is_identity() {
            return;
        }
        let levels = if self.auto_enhance {
            auto_levels(img)
        } else {
            (0.0, 1.0)
        };
        let tone = ToneParams::new(self, levels);
        let (w, h) = img.dimensions();
        let row = w as usize * 4;
        img.as_mut()
            .par_chunks_mut(row)
            .enumerate()
            .for_each(|(y, line)| {
                for x in 0..w as usize {
                    let p = &mut line[x * 4..x * 4 + 4];
                    let mut c = [
                        p[0] as f32 / 255.0,
                        p[1] as f32 / 255.0,
                        p[2] as f32 / 255.0,
                    ];
                    tone.apply(&mut c, x as f32, y as f32, w as f32, h as f32);
                    for i in 0..3 {
                        p[i] = (c[i].clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
                    }
                }
            });
        if self.sharpness > 0.0 {
            sharpen(img, self.sharpness / 100.0, scale);
        }
    }
}

fn curve_is_identity(c: &CurvePoints) -> bool {
    c.len() < 2
        || c.iter().all(|p| (p[0] - p[1]).abs() < 1e-6)
            && c.first().is_some_and(|p| p[0] <= 1e-6)
            && c.last().is_some_and(|p| p[0] >= 1.0 - 1e-6)
}

const LUT_SIZE: usize = 1024;

/// Monotone cubic (Fritsch–Carlson) interpolation through the control points,
/// sampled into a lookup table. Monotone curves never overshoot, so they can't
/// create banding or inverted tones between points.
pub fn curve_lut(points: &CurvePoints) -> Option<Vec<f32>> {
    if curve_is_identity(points) {
        return None;
    }
    let mut pts: Vec<[f64; 2]> = points.clone();
    pts.sort_by(|a, b| a[0].total_cmp(&b[0]));
    pts.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-9);
    // Extend flat to the edges when the user did not place end points.
    if pts[0][0] > 0.0 {
        let y = pts[0][1];
        pts.insert(0, [0.0, y]);
    }
    if pts[pts.len() - 1][0] < 1.0 {
        let y = pts[pts.len() - 1][1];
        pts.push([1.0, y]);
    }
    let n = pts.len();
    let xs: Vec<f64> = pts.iter().map(|p| p[0]).collect();
    let ys: Vec<f64> = pts.iter().map(|p| p[1]).collect();
    let mut d = vec![0.0; n - 1];
    for i in 0..n - 1 {
        d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    }
    let mut m = vec![0.0; n];
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for i in 1..n - 1 {
        m[i] = if d[i - 1] * d[i] <= 0.0 {
            0.0
        } else {
            (d[i - 1] + d[i]) / 2.0
        };
    }
    for i in 0..n - 1 {
        if d[i] == 0.0 {
            m[i] = 0.0;
            m[i + 1] = 0.0;
        } else {
            let a = m[i] / d[i];
            let b = m[i + 1] / d[i];
            let s = a * a + b * b;
            if s > 9.0 {
                let t = 3.0 / s.sqrt();
                m[i] = t * a * d[i];
                m[i + 1] = t * b * d[i];
            }
        }
    }
    let mut lut = Vec::with_capacity(LUT_SIZE);
    let mut seg = 0;
    for k in 0..LUT_SIZE {
        let x = k as f64 / (LUT_SIZE - 1) as f64;
        while seg < n - 2 && x > xs[seg + 1] {
            seg += 1;
        }
        let h = xs[seg + 1] - xs[seg];
        let t = ((x - xs[seg]) / h).clamp(0.0, 1.0);
        let (t2, t3) = (t * t, t * t * t);
        let y = (2.0 * t3 - 3.0 * t2 + 1.0) * ys[seg]
            + (t3 - 2.0 * t2 + t) * h * m[seg]
            + (-2.0 * t3 + 3.0 * t2) * ys[seg + 1]
            + (t3 - t2) * h * m[seg + 1];
        lut.push(y.clamp(0.0, 1.0) as f32);
    }
    Some(lut)
}

#[inline]
fn lut_lookup(lut: &[f32], v: f32) -> f32 {
    let f = v.clamp(0.0, 1.0) * (LUT_SIZE - 1) as f32;
    let i = f as usize;
    if i >= LUT_SIZE - 1 {
        return lut[LUT_SIZE - 1];
    }
    let t = f - i as f32;
    lut[i] * (1.0 - t) + lut[i + 1] * t
}

#[inline]
fn luma(c: &[f32; 3]) -> f32 {
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

struct ToneParams {
    lo: f32,
    span: f32,
    exposure: f32,
    gamma: f32,
    contrast: f32,
    shadows: f32,
    highlights: f32,
    gains: [f32; 3],
    saturation: f32,
    vibrance: f32,
    vignette: f32,
    rgb: Option<Vec<f32>>,
    chan: [Option<Vec<f32>>; 3],
}

impl ToneParams {
    fn new(s: &AdjustSpec, levels: (f32, f32)) -> Self {
        let f = |v: f64| (v / 100.0) as f32;
        let t = f(s.temperature);
        let tn = f(s.tint);
        let c = f(s.contrast);
        ToneParams {
            lo: levels.0,
            span: (levels.1 - levels.0).max(1e-3),
            // ±1.5 stops
            exposure: 2f32.powf(f(s.exposure) * 1.5),
            // brightness lifts/lowers mid-tones (gamma), keeping black and white points
            gamma: 2f32.powf(-f(s.brightness)),
            contrast: if c >= 0.0 {
                1.0 + c * 1.2
            } else {
                1.0 + c * 0.85
            },
            shadows: f(s.shadows) * 0.4,
            highlights: f(s.highlights) * 0.4,
            gains: [1.0 + t * 0.18, 1.0 - tn * 0.12, 1.0 - t * 0.18],
            saturation: 1.0 + f(s.saturation),
            vibrance: f(s.vibrance),
            vignette: f(s.vignette),
            rgb: curve_lut(&s.curves.rgb),
            chan: [
                curve_lut(&s.curves.red),
                curve_lut(&s.curves.green),
                curve_lut(&s.curves.blue),
            ],
        }
    }

    #[inline]
    #[allow(clippy::needless_range_loop)]
    fn apply(&self, c: &mut [f32; 3], x: f32, y: f32, w: f32, h: f32) {
        for v in c.iter_mut() {
            // levels (auto enhance) and exposure
            *v = ((*v - self.lo) / self.span).max(0.0) * self.exposure;
            // brightness (mid-tone gamma)
            if self.gamma != 1.0 {
                *v = v.max(0.0).powf(self.gamma);
            }
            // contrast around mid-grey
            *v = (*v - 0.5) * self.contrast + 0.5;
        }
        // shadows / highlights on luminance, preserving hue
        if self.shadows != 0.0 || self.highlights != 0.0 {
            let l = luma(c).clamp(0.0, 1.0);
            let ws = (1.0 - l) * (1.0 - l);
            let wh = l * l;
            let delta = self.shadows * ws * (1.0 - l) + self.highlights * wh * l.max(0.0);
            for v in c.iter_mut() {
                *v += delta;
            }
        }
        // white balance
        for i in 0..3 {
            c[i] *= self.gains[i];
        }
        // saturation & vibrance
        if self.saturation != 1.0 || self.vibrance != 0.0 {
            let l = luma(c);
            let mx = c[0].max(c[1]).max(c[2]);
            let mn = c[0].min(c[1]).min(c[2]);
            let sat = (mx - mn).clamp(0.0, 1.0);
            let k = self.saturation * (1.0 + self.vibrance * (1.0 - sat));
            for v in c.iter_mut() {
                *v = l + (*v - l) * k.max(0.0);
            }
        }
        // tone curves
        if let Some(lut) = &self.rgb {
            for v in c.iter_mut() {
                *v = lut_lookup(lut, *v);
            }
        }
        for i in 0..3 {
            if let Some(lut) = &self.chan[i] {
                c[i] = lut_lookup(lut, c[i]);
            }
        }
        // vignette: darken towards the corners
        if self.vignette > 0.0 {
            let dx = (x + 0.5) / w - 0.5;
            let dy = (y + 0.5) / h - 0.5;
            let d = ((dx * dx + dy * dy) / 0.5).sqrt(); // 0 centre .. 1 corner
            let t = ((d - 0.35) / 0.65).clamp(0.0, 1.0);
            let k = 1.0 - self.vignette * 0.75 * t * t * (3.0 - 2.0 * t);
            for v in c.iter_mut() {
                *v *= k;
            }
        }
    }
}

/// Black/white points from luminance percentiles (0.5% / 99.5%). The stretch is
/// limited so already-good photos are barely touched.
pub fn auto_levels(img: &RgbaImage) -> (f32, f32) {
    let mut hist = [0u64; 256];
    let mut total = 0u64;
    for p in img.pixels() {
        if p.0[3] == 0 {
            continue;
        }
        let l = luma(&[p.0[0] as f32, p.0[1] as f32, p.0[2] as f32])
            .round()
            .clamp(0.0, 255.0) as usize;
        hist[l] += 1;
        total += 1;
    }
    if total == 0 {
        return (0.0, 1.0);
    }
    let pick = |frac: f64| {
        let target = (total as f64 * frac) as u64;
        let mut acc = 0;
        for (i, n) in hist.iter().enumerate() {
            acc += n;
            if acc > target {
                return i as f32 / 255.0;
            }
        }
        1.0
    };
    let mut lo = pick(0.005);
    let mut hi = pick(0.995);
    // Never stretch more than 1.6x or clip more than a little.
    lo = lo.min(0.2);
    hi = hi.max(0.8);
    if hi - lo < 1.0 / 1.6 {
        let mid = (hi + lo) / 2.0;
        lo = (mid - 0.3125).max(0.0);
        hi = (mid + 0.3125).min(1.0);
    }
    (lo, hi)
}

/// Unsharp mask on RGB; radius scaled with the preview so it looks the same as the export.
fn sharpen(img: &mut RgbaImage, amount: f64, scale: f64) {
    let sigma = (1.2 * scale).max(0.4) as f32;
    let blurred = image::imageops::blur(img, sigma);
    let amt = (amount * 1.6) as f32;
    for (p, b) in img.pixels_mut().zip(blurred.pixels()) {
        for i in 0..3 {
            let v = p.0[i] as f32 + amt * (p.0[i] as f32 - b.0[i] as f32);
            p.0[i] = v.round().clamp(0.0, 255.0) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn gradient() -> RgbaImage {
        RgbaImage::from_fn(64, 32, |x, y| {
            Rgba([
                (x * 4) as u8,
                (y * 8) as u8,
                ((x + y) * 2) as u8,
                if x < 4 { 0 } else { 255 },
            ])
        })
    }

    fn mean(img: &RgbaImage) -> f64 {
        img.pixels()
            .map(|p| (p.0[0] as f64 + p.0[1] as f64 + p.0[2] as f64) / 3.0)
            .sum::<f64>()
            / (img.width() * img.height()) as f64
    }

    fn stddev(img: &RgbaImage) -> f64 {
        let m = mean(img);
        (img.pixels()
            .map(|p| {
                let v = (p.0[0] as f64 + p.0[1] as f64 + p.0[2] as f64) / 3.0;
                (v - m) * (v - m)
            })
            .sum::<f64>()
            / (img.width() * img.height()) as f64)
            .sqrt()
    }

    #[test]
    fn default_is_exact_identity() {
        let src = gradient();
        let mut out = src.clone();
        AdjustSpec::default().apply(&mut out, 1.0);
        assert_eq!(out, src);
        let identity_curve = AdjustSpec {
            curves: Curves {
                rgb: vec![[0.0, 0.0], [0.5, 0.5], [1.0, 1.0]],
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(identity_curve.is_identity());
    }

    #[test]
    fn sliders_move_in_the_right_direction() {
        let src = RgbaImage::from_fn(32, 32, |x, y| {
            Rgba([(x * 6 + 20) as u8, (y * 6 + 20) as u8, 128, 255])
        });
        let run = |s: AdjustSpec| {
            let mut i = src.clone();
            s.apply(&mut i, 1.0);
            i
        };
        assert!(
            mean(&run(AdjustSpec {
                brightness: 50.0,
                ..Default::default()
            })) > mean(&src) + 5.0
        );
        assert!(
            mean(&run(AdjustSpec {
                brightness: -50.0,
                ..Default::default()
            })) < mean(&src) - 5.0
        );
        assert!(
            mean(&run(AdjustSpec {
                exposure: 40.0,
                ..Default::default()
            })) > mean(&src)
        );
        assert!(
            stddev(&run(AdjustSpec {
                contrast: 60.0,
                ..Default::default()
            })) > stddev(&src) * 1.2
        );
        assert!(
            stddev(&run(AdjustSpec {
                contrast: -60.0,
                ..Default::default()
            })) < stddev(&src) * 0.8
        );
        let warm = run(AdjustSpec {
            temperature: 60.0,
            ..Default::default()
        });
        let p = warm.get_pixel(16, 16).0;
        let o = src.get_pixel(16, 16).0;
        assert!(p[0] > o[0] && p[2] < o[2]);
        let gray = run(AdjustSpec {
            saturation: -100.0,
            ..Default::default()
        });
        for px in gray.pixels() {
            let [r, g, b, _] = px.0;
            assert!((r as i32 - g as i32).abs() <= 1 && (g as i32 - b as i32).abs() <= 1);
        }
    }

    #[test]
    fn alpha_is_never_touched() {
        let src = gradient();
        let mut out = src.clone();
        AdjustSpec {
            brightness: 80.0,
            contrast: 50.0,
            saturation: 40.0,
            sharpness: 80.0,
            vignette: 60.0,
            auto_enhance: true,
            ..Default::default()
        }
        .apply(&mut out, 1.0);
        for (a, b) in out.pixels().zip(src.pixels()) {
            assert_eq!(a.0[3], b.0[3]);
        }
    }

    #[test]
    fn curves_are_monotone_and_hit_points() {
        let s_curve = vec![[0.0, 0.0], [0.25, 0.15], [0.75, 0.85], [1.0, 1.0]];
        let lut = curve_lut(&s_curve).unwrap();
        for w in lut.windows(2) {
            assert!(w[1] >= w[0] - 1e-6, "monotone");
        }
        assert!((lut_lookup(&lut, 0.25) - 0.15).abs() < 0.01);
        assert!((lut_lookup(&lut, 0.75) - 0.85).abs() < 0.01);
        assert!((lut_lookup(&lut, 0.5) - 0.5).abs() < 0.02);
        // fade: lifted black point
        let fade = curve_lut(&vec![[0.0, 0.1], [1.0, 1.0]]).unwrap();
        assert!((fade[0] - 0.1).abs() < 1e-6);
        assert!(curve_lut(&vec![]).is_none());
    }

    #[test]
    fn channel_curve_affects_only_that_channel() {
        let src = RgbaImage::from_pixel(4, 4, Rgba([100, 100, 100, 255]));
        let mut out = src.clone();
        AdjustSpec {
            curves: Curves {
                red: vec![[0.0, 0.0], [0.4, 0.6], [1.0, 1.0]],
                ..Default::default()
            },
            ..Default::default()
        }
        .apply(&mut out, 1.0);
        let p = out.get_pixel(0, 0).0;
        assert!(p[0] > 120);
        assert_eq!((p[1], p[2]), (100, 100));
    }

    #[test]
    fn auto_enhance_stretches_flat_images() {
        let src = RgbaImage::from_fn(64, 64, |x, _| {
            let v = 90 + (x as u8) % 60;
            Rgba([v, v, v, 255])
        });
        let mut out = src.clone();
        AdjustSpec {
            auto_enhance: true,
            ..Default::default()
        }
        .apply(&mut out, 1.0);
        assert!(stddev(&out) > stddev(&src) * 1.3);
    }

    #[test]
    fn vignette_darkens_corners_not_centre() {
        let src = RgbaImage::from_pixel(101, 101, Rgba([200, 200, 200, 255]));
        let mut out = src.clone();
        AdjustSpec {
            vignette: 100.0,
            ..Default::default()
        }
        .apply(&mut out, 1.0);
        assert_eq!(out.get_pixel(50, 50).0[0], 200);
        assert!(out.get_pixel(0, 0).0[0] < 120);
    }

    #[test]
    fn rotation_and_flip() {
        let src = RgbaImage::from_fn(4, 2, |x, y| Rgba([x as u8, y as u8, 0, 255]));
        let t = TransformSpec {
            rotate: 90,
            ..Default::default()
        };
        let out = t.apply(&src);
        assert_eq!(out.dimensions(), (2, 4));
        assert_eq!(t.output_size(4, 2), (2, 4));
        // clockwise: top-left of output is bottom-left of input
        assert_eq!(out.get_pixel(0, 0).0[..2], [0, 1]);
        let f = TransformSpec {
            flip_h: true,
            ..Default::default()
        }
        .apply(&src);
        assert_eq!(f.get_pixel(0, 0).0[0], 3);
        assert!(TransformSpec {
            rotate: 45,
            ..Default::default()
        }
        .validate()
        .is_err());
    }

    #[test]
    fn validation() {
        assert!(AdjustSpec {
            brightness: 101.0,
            ..Default::default()
        }
        .validate()
        .is_err());
        assert!(AdjustSpec {
            sharpness: -1.0,
            ..Default::default()
        }
        .validate()
        .is_err());
        assert!(AdjustSpec {
            curves: Curves {
                rgb: vec![[0.0, 2.0]],
                ..Default::default()
            },
            ..Default::default()
        }
        .validate()
        .is_err());
        assert!(AdjustSpec::default().validate().is_ok());
    }
}
