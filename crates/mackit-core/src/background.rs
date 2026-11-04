//! Background removal and replacement.
//!
//! 1. **Mask** — Apple Vision finds the subject(s) ([`crate::segment`]); clicked points
//!    choose which subjects to keep; the edge is refined at full resolution with a
//!    fast guided filter (hair, fur); brush strokes add or erase; then grow/shrink,
//!    feather and invert.
//! 2. **Background** — transparent, a solid colour, black & white (colour splash),
//!    or a DSLR-style lens blur: the blur is computed from background pixels only
//!    (mask-normalised, so the subject never "bleeds" into it), in linear light with
//!    optional highlight boost so bright points bloom into round bokeh discs.
//!
//! All sizes are relative to the image's shorter side, so a preview and the
//! full-resolution export produce the same look.

use crate::color::Color;
use crate::error::{EngineError, Result};
use crate::segment::{subject_mask, SubjectMode};
use image::RgbaImage;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum BgMode {
    /// Remove the background (PNG/WebP keep the transparency).
    #[default]
    Transparent,
    /// Replace the background with a solid colour.
    Color,
    /// Lens blur — a shallow depth-of-field "DSLR" look.
    Blur,
    /// Black & white background, colour subject.
    Grayscale,
}

/// A brush stroke in normalised image coordinates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MaskStroke {
    /// true = add to the subject, false = erase from it.
    pub keep: bool,
    /// Brush radius as a fraction of the image's shorter side.
    pub radius: f64,
    pub points: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BackgroundSpec {
    /// Detect the subject automatically. Off = start from an empty mask and paint it.
    pub detect: bool,
    pub subject: SubjectMode,
    /// Clicked points choosing which detected subjects to keep (empty = all).
    pub picks: Vec<[f64; 2]>,
    pub strokes: Vec<MaskStroke>,
    /// Keep the background and remove the subject instead.
    pub invert: bool,
    /// Edge-aware refinement at full resolution (hair, fur, fine detail).
    pub refine: bool,
    /// Logo / graphic mode: how different from the background a colour must be to
    /// count as subject, in % (ignores JPEG noise and faint shadows).
    pub tolerance: f64,
    /// Grow (+) or shrink (−) the subject; units of 1/1000 of the shorter side.
    pub edge: f64,
    /// Soften the subject edge; units of 1/1000 of the shorter side.
    pub feather: f64,
    pub mode: BgMode,
    pub color: Color,
    /// Blur strength 0–100.
    pub blur: f64,
    /// Round lens bokeh (true) or a smooth Gaussian blur (false).
    pub lens: bool,
    /// Bokeh highlight boost 0–100.
    pub highlights: f64,
}

impl Default for BackgroundSpec {
    fn default() -> Self {
        BackgroundSpec {
            detect: true,
            subject: SubjectMode::Auto,
            picks: Vec::new(),
            strokes: Vec::new(),
            invert: false,
            refine: true,
            tolerance: 6.0,
            edge: 0.0,
            feather: 0.0,
            mode: BgMode::Transparent,
            color: Color::WHITE,
            blur: 50.0,
            lens: true,
            highlights: 30.0,
        }
    }
}

fn check(name: &str, v: f64, lo: f64, hi: f64) -> Result<()> {
    if v.is_finite() && (lo..=hi).contains(&v) {
        Ok(())
    } else {
        Err(EngineError::InvalidInput(format!(
            "{name} must be between {lo} and {hi}"
        )))
    }
}

impl BackgroundSpec {
    pub fn validate(&self) -> Result<()> {
        check("edge", self.edge, -50.0, 50.0)?;
        check("feather", self.feather, 0.0, 100.0)?;
        check("blur", self.blur, 0.0, 100.0)?;
        check("highlights", self.highlights, 0.0, 100.0)?;
        check("tolerance", self.tolerance, 0.0, 60.0)?;
        if self.picks.len() > 64 || self.strokes.len() > 2000 {
            return Err(EngineError::InvalidInput("too many selections".into()));
        }
        let finite = |p: &[f64; 2]| p[0].is_finite() && p[1].is_finite();
        if !self.picks.iter().all(finite) {
            return Err(EngineError::InvalidInput("invalid subject point".into()));
        }
        for s in &self.strokes {
            check("brush size", s.radius, 0.0, 1.0)?;
            if s.points.len() > 20_000 || !s.points.iter().all(finite) {
                return Err(EngineError::InvalidInput("invalid brush stroke".into()));
            }
        }
        Ok(())
    }
}

/// Run the whole effect in place.
pub fn apply(img: &mut RgbaImage, spec: &BackgroundSpec) -> Result<()> {
    spec.validate()?;
    let (mask, keyed) = build_mask_keyed(img, spec)?;
    if let Some((bg, mix)) = keyed {
        crate::keying::decontaminate(img, &mix, bg);
    }
    composite(img, &mask, spec);
    Ok(())
}

// ---------------------------------------------------------------------------
// Mask

/// Subject mask at the image's resolution (1 = subject).
pub fn build_mask(img: &RgbaImage, spec: &BackgroundSpec) -> Result<Vec<f32>> {
    Ok(build_mask_keyed(img, spec)?.0)
}

/// Which detector a spec uses for this image: `Some(bg)` = colour keying against
/// `bg` (logo / graphic), `None` = Vision.
pub fn keying_color(img: &RgbaImage, spec: &BackgroundSpec) -> Option<[u8; 3]> {
    match spec.subject {
        SubjectMode::Graphic => Some(crate::keying::border_color(img)),
        SubjectMode::Auto => crate::keying::uniform_background(img),
        _ => None,
    }
}

/// Keyed background colour and per-pixel mix (for edge decontamination).
type KeyInfo = Option<([u8; 3], Vec<f32>)>;

/// The mask plus, when colour keying was used, the background colour (for edge
/// decontamination).
fn build_mask_keyed(img: &RgbaImage, spec: &BackgroundSpec) -> Result<(Vec<f32>, KeyInfo)> {
    let (w, h) = img.dimensions();
    let (wu, hu) = (w as usize, h as usize);
    let short = w.min(h) as f64;
    let key_bg = if spec.detect {
        keying_color(img, spec)
    } else {
        None
    };
    let mut keyed: KeyInfo = None;
    let mut m = if let Some(bg) = key_bg {
        let k = crate::keying::key(img, bg, (spec.tolerance / 100.0) as f32);
        let mut m = k.alpha;
        let group = ((short * 0.02).round() as usize).max(1);
        crate::keying::keep_picked(&mut m, wu, hu, &spec.picks, group);
        keyed = Some((bg, k.mix));
        m
    } else if spec.detect {
        let mode = match spec.subject {
            SubjectMode::Auto | SubjectMode::Graphic => SubjectMode::Subjects,
            m => m,
        };
        let sm = subject_mask(img, mode, &spec.picks)?;
        let mut up = upscale_bilinear(&sm.alpha, sm.width as usize, sm.height as usize, wu, hu);
        if spec.refine {
            up = guided_refine(img, &up);
        }
        up
    } else {
        vec![0.0; wu * hu]
    };
    for s in &spec.strokes {
        paint_stroke(&mut m, wu, hu, s, short);
    }
    let edge_px = spec.edge / 1000.0 * short;
    if edge_px.abs() >= 0.5 {
        morph(
            &mut m,
            wu,
            hu,
            edge_px.abs().round() as usize,
            edge_px > 0.0,
        );
    }
    let feather_px = spec.feather / 1000.0 * short;
    if feather_px >= 0.3 {
        gaussian(&mut m, wu, hu, 1, feather_px as f32);
    }
    if spec.invert {
        m.iter_mut().for_each(|v| *v = 1.0 - *v);
    }
    Ok((m, keyed))
}

fn upscale_bilinear(src: &[f32], sw: usize, sh: usize, w: usize, h: usize) -> Vec<f32> {
    if sw == w && sh == h {
        return src.to_vec();
    }
    let mut out = vec![0f32; w * h];
    let (kx, ky) = (sw as f32 / w as f32, sh as f32 / h as f32);
    out.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        let fy = ((y as f32 + 0.5) * ky - 0.5).clamp(0.0, (sh - 1) as f32);
        let y0 = fy as usize;
        let y1 = (y0 + 1).min(sh - 1);
        let ty = fy - y0 as f32;
        for (x, o) in row.iter_mut().enumerate() {
            let fx = ((x as f32 + 0.5) * kx - 0.5).clamp(0.0, (sw - 1) as f32);
            let x0 = fx as usize;
            let x1 = (x0 + 1).min(sw - 1);
            let tx = fx - x0 as f32;
            let a = src[y0 * sw + x0] * (1.0 - tx) + src[y0 * sw + x1] * tx;
            let b = src[y1 * sw + x0] * (1.0 - tx) + src[y1 * sw + x1] * tx;
            *o = a * (1.0 - ty) + b * ty;
        }
    });
    out
}

/// Bilinear lookup into a small `sw`×`sh` grid of `c` channels, for output pixel
/// (x, y) of a `w`×`h` image. Lets large images use small buffers without
/// materialising a full-size upscaled copy.
struct Sampler<'a> {
    src: &'a [f32],
    sw: usize,
    sh: usize,
    c: usize,
    kx: f32,
    ky: f32,
}

impl<'a> Sampler<'a> {
    fn new(src: &'a [f32], sw: usize, sh: usize, c: usize, w: usize, h: usize) -> Self {
        Sampler {
            src,
            sw,
            sh,
            c,
            kx: sw as f32 / w as f32,
            ky: sh as f32 / h as f32,
        }
    }

    /// Row setup (y0, y1, ty) for output row `y`.
    fn row(&self, y: usize) -> (usize, usize, f32) {
        let fy = ((y as f32 + 0.5) * self.ky - 0.5).clamp(0.0, (self.sh - 1) as f32);
        let y0 = fy as usize;
        (y0, (y0 + 1).min(self.sh - 1), fy - y0 as f32)
    }

    fn get(&self, row: (usize, usize, f32), x: usize, k: usize) -> f32 {
        let fx = ((x as f32 + 0.5) * self.kx - 0.5).clamp(0.0, (self.sw - 1) as f32);
        let x0 = fx as usize;
        let x1 = (x0 + 1).min(self.sw - 1);
        let tx = fx - x0 as f32;
        let (y0, y1, ty) = row;
        let at = |xx: usize, yy: usize| self.src[(yy * self.sw + xx) * self.c + k];
        let a = at(x0, y0) * (1.0 - tx) + at(x1, y0) * tx;
        let b = at(x0, y1) * (1.0 - tx) + at(x1, y1) * tx;
        a * (1.0 - ty) + b * ty
    }
}

/// Area-average downsample of `c` interleaved channels.
fn downsample(src: &[f32], w: usize, h: usize, c: usize, dw: usize, dh: usize) -> Vec<f32> {
    let mut sum = vec![0f32; dw * dh * c];
    let mut cnt = vec![0u32; dw * dh];
    for y in 0..h {
        let dy = (y * dh / h).min(dh - 1);
        for x in 0..w {
            let dx = (x * dw / w).min(dw - 1);
            let di = dy * dw + dx;
            cnt[di] += 1;
            for k in 0..c {
                sum[di * c + k] += src[(y * w + x) * c + k];
            }
        }
    }
    for (i, n) in cnt.iter().enumerate() {
        let n = (*n).max(1) as f32;
        for k in 0..c {
            sum[i * c + k] /= n;
        }
    }
    sum
}

/// Mean filter of radius `r` (separable running sums, edge-normalised).
fn box_filter(src: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let mut tmp = vec![0f32; w * h];
    tmp.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        let s = &src[y * w..(y + 1) * w];
        let mut acc = 0f64;
        let mut prefix = Vec::with_capacity(w + 1);
        prefix.push(0f64);
        for v in s {
            acc += *v as f64;
            prefix.push(acc);
        }
        for (x, o) in row.iter_mut().enumerate() {
            let a = x.saturating_sub(r);
            let b = (x + r + 1).min(w);
            *o = ((prefix[b] - prefix[a]) / (b - a) as f64) as f32;
        }
    });
    let mut out = vec![0f32; w * h];
    // Vertical pass, column blocks in parallel via transposed prefix per column.
    let cols: Vec<Vec<f32>> = (0..w)
        .into_par_iter()
        .map(|x| {
            let mut prefix = Vec::with_capacity(h + 1);
            let mut acc = 0f64;
            prefix.push(0f64);
            for y in 0..h {
                acc += tmp[y * w + x] as f64;
                prefix.push(acc);
            }
            (0..h)
                .map(|y| {
                    let a = y.saturating_sub(r);
                    let b = (y + r + 1).min(h);
                    ((prefix[b] - prefix[a]) / (b - a) as f64) as f32
                })
                .collect()
        })
        .collect();
    for (x, col) in cols.iter().enumerate() {
        for (y, v) in col.iter().enumerate() {
            out[y * w + x] = *v;
        }
    }
    out
}

/// Fast guided filter (He & Sun): sharpens a low-resolution mask along the real
/// edges of the full-resolution image.
pub fn guided_refine(img: &RgbaImage, p: &[f32]) -> Vec<f32> {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let guide: Vec<f32> = img
        .pixels()
        .map(|px| (0.299 * px[0] as f32 + 0.587 * px[1] as f32 + 0.114 * px[2] as f32) / 255.0)
        .collect();
    // Coefficients are computed at ≤ 1024 px and applied at full resolution.
    let s = (w.max(h) as f32 / 1024.0).max(1.0);
    let (lw, lh) = (
        ((w as f32 / s).round() as usize).max(1),
        ((h as f32 / s).round() as usize).max(1),
    );
    let il = downsample(&guide, w, h, 1, lw, lh);
    let pl = downsample(p, w, h, 1, lw, lh);
    let r = ((lw.min(lh) as f32 * 0.008).round() as usize).max(1);
    let eps = 2e-3f32;
    let mean_i = box_filter(&il, lw, lh, r);
    let mean_p = box_filter(&pl, lw, lh, r);
    let ii: Vec<f32> = il.iter().map(|v| v * v).collect();
    let ip: Vec<f32> = il.iter().zip(&pl).map(|(a, b)| a * b).collect();
    let corr_i = box_filter(&ii, lw, lh, r);
    let corr_ip = box_filter(&ip, lw, lh, r);
    let mut a = vec![0f32; lw * lh];
    let mut b = vec![0f32; lw * lh];
    for i in 0..lw * lh {
        let var = corr_i[i] - mean_i[i] * mean_i[i];
        let cov = corr_ip[i] - mean_i[i] * mean_p[i];
        a[i] = cov / (var + eps);
        b[i] = mean_p[i] - a[i] * mean_i[i];
    }
    let ma = box_filter(&a, lw, lh, r);
    let mb = box_filter(&b, lw, lh, r);
    let (sa, sb) = (
        Sampler::new(&ma, lw, lh, 1, w, h),
        Sampler::new(&mb, lw, lh, 1, w, h),
    );
    let mut q = vec![0f32; w * h];
    q.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        let rs = sa.row(y);
        for (x, o) in row.iter_mut().enumerate() {
            *o = (sa.get(rs, x, 0) * guide[y * w + x] + sb.get(rs, x, 0)).clamp(0.0, 1.0);
        }
    });
    q
}

fn paint_stroke(m: &mut [f32], w: usize, h: usize, s: &MaskStroke, short: f64) {
    let r = (s.radius * short).max(0.5);
    let pts: Vec<(f64, f64)> = s
        .points
        .iter()
        .map(|p| (p[0] * w as f64, p[1] * h as f64))
        .collect();
    if pts.is_empty() {
        return;
    }
    let segs: Vec<((f64, f64), (f64, f64))> = if pts.len() == 1 {
        vec![(pts[0], pts[0])]
    } else {
        pts.windows(2).map(|p| (p[0], p[1])).collect()
    };
    for (a, b) in segs {
        let x0 = ((a.0.min(b.0) - r - 1.0).floor().max(0.0)) as usize;
        let y0 = ((a.1.min(b.1) - r - 1.0).floor().max(0.0)) as usize;
        let x1 = ((a.0.max(b.0) + r + 1.0).ceil() as usize).min(w);
        let y1 = ((a.1.max(b.1) + r + 1.0).ceil() as usize).min(h);
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let len2 = dx * dx + dy * dy;
        for y in y0..y1 {
            for x in x0..x1 {
                let (px, py) = (x as f64 + 0.5, y as f64 + 0.5);
                let t = if len2 > 0.0 {
                    (((px - a.0) * dx + (py - a.1) * dy) / len2).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let (cx, cy) = (a.0 + t * dx, a.1 + t * dy);
                let d = ((px - cx).powi(2) + (py - cy).powi(2)).sqrt();
                let cov = (r - d + 0.5).clamp(0.0, 1.0) as f32;
                if cov > 0.0 {
                    let v = &mut m[y * w + x];
                    *v = if s.keep { v.max(cov) } else { v.min(1.0 - cov) };
                }
            }
        }
    }
}

/// Grow (dilate) or shrink (erode) by `r` pixels (square structuring element).
pub(crate) fn morph(m: &mut [f32], w: usize, h: usize, r: usize, grow: bool) {
    let pick = |a: f32, b: f32| if grow { a.max(b) } else { a.min(b) };
    let mut tmp = vec![0f32; w * h];
    tmp.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        for (x, o) in row.iter_mut().enumerate() {
            let a = x.saturating_sub(r);
            let b = (x + r).min(w - 1);
            let mut v = m[y * w + a];
            for xi in a + 1..=b {
                v = pick(v, m[y * w + xi]);
            }
            *o = v;
        }
    });
    m.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        let a = y.saturating_sub(r);
        let b = (y + r).min(h - 1);
        row.copy_from_slice(&tmp[a * w..(a + 1) * w]);
        for yi in a + 1..=b {
            let src = &tmp[yi * w..(yi + 1) * w];
            for (o, v) in row.iter_mut().zip(src) {
                *o = pick(*o, *v);
            }
        }
    });
}

/// In-place Gaussian blur of `c` interleaved channels (three box passes).
fn gaussian(buf: &mut [f32], w: usize, h: usize, c: usize, sigma: f32) {
    if sigma < 0.3 {
        return;
    }
    // Box radius for 3 passes approximating the Gaussian.
    let r = (((12.0 * sigma * sigma / 3.0 + 1.0).sqrt() - 1.0) / 2.0)
        .round()
        .max(1.0) as usize;
    for _ in 0..3 {
        for k in 0..c {
            let chan: Vec<f32> = (0..w * h).map(|i| buf[i * c + k]).collect();
            let out = box_filter(&chan, w, h, r);
            for i in 0..w * h {
                buf[i * c + k] = out[i];
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Background

fn srgb_to_linear_lut() -> [f32; 256] {
    let mut t = [0f32; 256];
    for (i, v) in t.iter_mut().enumerate() {
        let c = i as f32 / 255.0;
        *v = if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        };
    }
    t
}

fn linear_to_srgb(v: f32) -> u8 {
    let v = v.clamp(0.0, 1.0);
    let c = if v <= 0.003_130_8 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    };
    (c * 255.0).round() as u8
}

/// Blur radius in pixels for a strength 0–100 (up to 4% of the shorter side).
pub fn blur_radius(w: u32, h: u32, strength: f64) -> f64 {
    strength.clamp(0.0, 100.0) / 100.0 * 0.04 * w.min(h) as f64
}

/// Background-only lens blur in linear RGB, returned at a reduced size
/// (`sw`×`sh`, 3 floats per pixel) — the caller samples it bilinearly.
fn lens_blur(img: &RgbaImage, mask: &[f32], spec: &BackgroundSpec) -> (Vec<f32>, usize, usize) {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let lut = srgb_to_linear_lut();
    let radius = blur_radius(img.width(), img.height(), spec.blur) as f32;
    let hl = (spec.highlights / 100.0) as f32 * if spec.lens { 1.0 } else { 0.5 };

    // Work at a reduced size where the radius is ≤ 10 px: the result is smooth, so
    // upscaling it afterwards is invisible, and big radii stay fast.
    let f = (10.0 / radius.max(0.001)).min(1.0);
    let (sw, sh) = (
        ((w as f32 * f).ceil() as usize).max(1),
        ((h as f32 * f).ceil() as usize).max(1),
    );
    let r = (radius * f).max(0.5);

    // 7 channels per small pixel: background-weighted RGB, background weight,
    // full-image RGB. Each small row is accumulated from its source rows in parallel.
    let mut small = vec![0f32; sw * sh * 7];
    small
        .par_chunks_mut(sw * 7)
        .enumerate()
        .for_each(|(dy, out)| {
            let y_start = (dy * h).div_ceil(sh);
            let y_end = ((dy + 1) * h).div_ceil(sh).min(h);
            let mut count = vec![0u32; sw];
            for y in y_start..y_end {
                for x in 0..w {
                    let dx = (x * sw / w).min(sw - 1);
                    let p = img.get_pixel(x as u32, y as u32).0;
                    let mut c = [lut[p[0] as usize], lut[p[1] as usize], lut[p[2] as usize]];
                    let lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
                    if hl > 0.0 && lum > 0.6 {
                        let t = ((lum - 0.6) / 0.4).min(1.0);
                        let boost = 1.0 + hl * 6.0 * t * t;
                        c.iter_mut().for_each(|v| *v *= boost);
                    }
                    let wt = 1.0 - mask[y * w + x];
                    let o = &mut out[dx * 7..dx * 7 + 7];
                    o[0] += c[0] * wt;
                    o[1] += c[1] * wt;
                    o[2] += c[2] * wt;
                    o[3] += wt;
                    o[4] += c[0];
                    o[5] += c[1];
                    o[6] += c[2];
                    count[dx] += 1;
                }
            }
            for (dx, n) in count.iter().enumerate() {
                let n = (*n).max(1) as f32;
                out[dx * 7..dx * 7 + 7].iter_mut().for_each(|v| *v /= n);
            }
        });

    if spec.lens {
        small = disc_blur(&small, sw, sh, 7, r);
    } else {
        gaussian(&mut small, sw, sh, 7, r / 2.0);
    }

    // Normalise: average of background pixels only; fall back to the full image
    // deep inside large subjects where no background is nearby.
    let mut bg = vec![0f32; sw * sh * 3];
    for i in 0..sw * sh {
        let s = &small[i * 7..i * 7 + 7];
        let wt = s[3];
        let mix = (wt / 0.05).min(1.0);
        for k in 0..3 {
            let v = if wt > 1e-4 { s[k] / wt } else { 0.0 };
            bg[i * 3 + k] = v * mix + s[4 + k] * (1.0 - mix);
        }
    }
    (bg, sw, sh)
}

/// Disc (aperture-shaped) convolution with an anti-aliased rim.
fn disc_blur(src: &[f32], w: usize, h: usize, c: usize, r: f32) -> Vec<f32> {
    let ri = r.ceil() as i32;
    let mut taps = Vec::new();
    for dy in -ri..=ri {
        for dx in -ri..=ri {
            let d = ((dx * dx + dy * dy) as f32).sqrt();
            let wt = (r - d + 0.5).clamp(0.0, 1.0);
            if wt > 0.0 {
                taps.push((dx, dy, wt));
            }
        }
    }
    let mut out = vec![0f32; w * h * c];
    out.par_chunks_mut(w * c).enumerate().for_each(|(y, row)| {
        for x in 0..w {
            let mut acc = [0f32; 8];
            let mut norm = 0f32;
            for &(dx, dy, wt) in &taps {
                let sx = x as i32 + dx;
                let sy = y as i32 + dy;
                if sx < 0 || sy < 0 || sx >= w as i32 || sy >= h as i32 {
                    continue;
                }
                let i = (sy as usize * w + sx as usize) * c;
                for k in 0..c {
                    acc[k] += src[i + k] * wt;
                }
                norm += wt;
            }
            let o = &mut row[x * c..x * c + c];
            for k in 0..c {
                o[k] = acc[k] / norm.max(1e-6);
            }
        }
    });
    out
}

/// Blend the subject over the chosen background.
pub fn composite(img: &mut RgbaImage, mask: &[f32], spec: &BackgroundSpec) {
    let w = img.width() as usize;
    match spec.mode {
        BgMode::Transparent => {
            for (i, p) in img.pixels_mut().enumerate() {
                p.0[3] = (p.0[3] as f32 * mask[i]).round() as u8;
            }
        }
        BgMode::Color => {
            let c = spec.color;
            for (i, p) in img.pixels_mut().enumerate() {
                let m = mask[i];
                for (k, bc) in [c.r, c.g, c.b].into_iter().enumerate() {
                    p.0[k] = (p.0[k] as f32 * m + bc as f32 * (1.0 - m)).round() as u8;
                }
                p.0[3] = (p.0[3] as f32 * m + c.a as f32 * (1.0 - m)).round() as u8;
            }
        }
        BgMode::Grayscale => {
            for (i, p) in img.pixels_mut().enumerate() {
                let m = mask[i];
                let l = 0.299 * p.0[0] as f32 + 0.587 * p.0[1] as f32 + 0.114 * p.0[2] as f32;
                for k in 0..3 {
                    p.0[k] = (p.0[k] as f32 * m + l * (1.0 - m)).round() as u8;
                }
            }
        }
        BgMode::Blur => {
            if blur_radius(img.width(), img.height(), spec.blur) < 0.5 {
                return;
            }
            let h = img.height() as usize;
            let (bg, sw, sh) = lens_blur(img, mask, spec);
            let sampler = Sampler::new(&bg, sw, sh, 3, w, h);
            let lut = srgb_to_linear_lut();
            img.par_chunks_mut(4 * w).enumerate().for_each(|(y, row)| {
                let rs = sampler.row(y);
                for x in 0..w {
                    let m = mask[y * w + x];
                    if m >= 1.0 {
                        continue;
                    }
                    let p = &mut row[x * 4..x * 4 + 4];
                    for k in 0..3 {
                        let lin = lut[p[k] as usize] * m + sampler.get(rs, x, k) * (1.0 - m);
                        p[k] = linear_to_srgb(lin);
                    }
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    /// Noisy checkerboard background with a solid red square in the middle.
    fn scene() -> RgbaImage {
        RgbaImage::from_fn(200, 160, |x, y| {
            if (60..140).contains(&x) && (40..120).contains(&y) {
                Rgba([220, 30, 30, 255])
            } else if ((x / 4) + (y / 4)) % 2 == 0 {
                Rgba([250, 250, 250, 255])
            } else {
                Rgba([10, 10, 10, 255])
            }
        })
    }

    /// Paint the red square as the subject with a brush (no Vision needed).
    fn brushed(mode: BgMode) -> BackgroundSpec {
        let pts: Vec<[f64; 2]> = (40..=120)
            .step_by(4)
            .flat_map(|y| {
                [
                    [60.0 / 200.0, y as f64 / 160.0],
                    [140.0 / 200.0, y as f64 / 160.0],
                ]
            })
            .collect();
        BackgroundSpec {
            detect: false,
            strokes: vec![MaskStroke {
                keep: true,
                radius: 4.0 / 160.0,
                points: pts,
            }],
            mode,
            ..Default::default()
        }
    }

    #[test]
    fn brush_only_mask_and_transparent() {
        let mut img = scene();
        apply(&mut img, &brushed(BgMode::Transparent)).unwrap();
        assert_eq!(img.get_pixel(100, 80).0[3], 255, "subject kept");
        assert_eq!(img.get_pixel(10, 10).0[3], 0, "background removed");
    }

    #[test]
    fn color_grayscale_and_invert() {
        let mut img = scene();
        let spec = BackgroundSpec {
            color: Color::rgb(0, 0, 255),
            ..brushed(BgMode::Color)
        };
        apply(&mut img, &spec).unwrap();
        assert_eq!(img.get_pixel(100, 80).0, [220, 30, 30, 255]);
        assert_eq!(img.get_pixel(5, 5).0, [0, 0, 255, 255]);

        let mut img = scene();
        apply(
            &mut img,
            &BackgroundSpec {
                invert: true,
                ..brushed(BgMode::Transparent)
            },
        )
        .unwrap();
        assert_eq!(img.get_pixel(100, 80).0[3], 0);
        assert_eq!(img.get_pixel(5, 5).0[3], 255);

        let mut img = RgbaImage::from_pixel(50, 50, Rgba([200, 50, 50, 255]));
        apply(
            &mut img,
            &BackgroundSpec {
                detect: false,
                mode: BgMode::Grayscale,
                ..Default::default()
            },
        )
        .unwrap();
        let p = img.get_pixel(25, 25).0;
        assert!(p[0] == p[1] && p[1] == p[2]);
    }

    #[test]
    fn lens_blur_smooths_background_without_touching_subject() {
        for lens in [true, false] {
            let mut img = scene();
            let spec = BackgroundSpec {
                blur: 100.0,
                lens,
                highlights: 0.0,
                ..brushed(BgMode::Blur)
            };
            apply(&mut img, &spec).unwrap();
            // Checkerboard averages to mid grey.
            let p = img.get_pixel(20, 20).0;
            assert!(
                (100..=220).contains(&p[0]),
                "background blurred (lens={lens}): {p:?}"
            );
            let q = img.get_pixel(30, 21).0;
            assert!(
                (p[0] as i32 - q[0] as i32).abs() < 40,
                "smooth: {p:?} {q:?}"
            );
            // No red bleeding into the background next to the subject.
            let edge = img.get_pixel(52, 80).0;
            assert!(
                (edge[0] as i32 - edge[1] as i32).abs() < 30,
                "no halo: {edge:?}"
            );
            assert_eq!(
                img.get_pixel(100, 80).0,
                [220, 30, 30, 255],
                "subject untouched"
            );
        }
    }

    #[test]
    fn grow_shrink_and_feather() {
        let base = brushed(BgMode::Transparent);
        let grown = build_mask(
            &scene(),
            &BackgroundSpec {
                edge: 30.0,
                ..base.clone()
            },
        )
        .unwrap();
        let shrunk = build_mask(
            &scene(),
            &BackgroundSpec {
                edge: -30.0,
                ..base.clone()
            },
        )
        .unwrap();
        // The brush edge is at x≈56; 30/1000 × 160 ≈ 5 px of growth/shrinkage.
        let plain = build_mask(&scene(), &base).unwrap();
        assert!(plain[80 * 200 + 59] > 0.9 && plain[80 * 200 + 52] < 0.1);
        assert!(grown[80 * 200 + 52] > 0.9, "grown outward");
        assert!(shrunk[80 * 200 + 59] < 0.1, "shrunk inward");
        let soft = build_mask(
            &scene(),
            &BackgroundSpec {
                feather: 40.0,
                ..base
            },
        )
        .unwrap();
        let v = soft[80 * 200 + 56];
        assert!(v > 0.1 && v < 0.9, "feathered edge: {v}");
    }

    #[test]
    fn guided_refine_snaps_to_real_edges() {
        let img = scene();
        // Blocky low-res-looking mask, offset 3 px from the true edge.
        let (w, h) = (200usize, 160usize);
        let p: Vec<f32> = (0..w * h)
            .map(|i| {
                let (x, y) = (i % w, i / w);
                if (63..137).contains(&x) && (43..117).contains(&y) {
                    1.0
                } else {
                    0.0
                }
            })
            .collect();
        let q = guided_refine(&img, &p);
        assert!(q[80 * w + 100] > 0.9);
        assert!(q[10 * w + 10] < 0.1);
    }

    #[test]
    fn auto_mode_keys_logos_on_plain_backgrounds_everywhere() {
        // Navy logo canvas: icon + "text", like a typical brand image.
        let mut img = RgbaImage::from_fn(240, 80, |x, y| {
            if (10..50).contains(&x) && (20..60).contains(&y) {
                Rgba([60, 120, 250, 255])
            } else if (80..230).contains(&x) && (30..50).contains(&y) {
                Rgba([250, 250, 250, 255])
            } else {
                Rgba([20, 26, 46, 255])
            }
        });
        apply(&mut img, &BackgroundSpec::default()).unwrap();
        assert_eq!(img.get_pixel(2, 2).0[3], 0, "background removed");
        assert_eq!(img.get_pixel(30, 40).0[3], 255, "icon kept");
        assert_eq!(img.get_pixel(150, 40).0[3], 255, "text kept");
    }

    #[test]
    fn detection_reports_unsupported_off_macos_and_validates() {
        let mut img = scene();
        let r = apply(&mut img, &BackgroundSpec::default());
        if cfg!(not(target_os = "macos")) {
            assert!(matches!(r, Err(EngineError::Segmentation(_))));
        }
        let bad = BackgroundSpec {
            blur: 500.0,
            ..Default::default()
        };
        assert!(bad.validate().is_err());
    }
}
