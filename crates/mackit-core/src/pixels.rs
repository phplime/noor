//! Low-level pixel helpers: high-quality resampling and alpha compositing.

use crate::geometry::Filter;
use fast_image_resize as fr;
use image::RgbaImage;

/// Resample an RGBA image to exactly `w`×`h`. Alpha is handled with
/// premultiplication (fast_image_resize does this for U8x4), so transparent
/// edges do not pick up dark fringes.
pub fn resample(src: &RgbaImage, w: u32, h: u32, filter: Filter) -> RgbaImage {
    let w = w.max(1);
    let h = h.max(1);
    if src.width() == w && src.height() == h {
        return src.clone();
    }
    let alg = match filter {
        Filter::Nearest => fr::ResizeAlg::Nearest,
        Filter::Bilinear => fr::ResizeAlg::Convolution(fr::FilterType::Bilinear),
        Filter::CatmullRom => fr::ResizeAlg::Convolution(fr::FilterType::CatmullRom),
        Filter::Lanczos3 => fr::ResizeAlg::Convolution(fr::FilterType::Lanczos3),
    };
    let mut dst = RgbaImage::new(w, h);
    let mut resizer = fr::Resizer::new();
    let opts = fr::ResizeOptions::new().resize_alg(alg);
    if resizer.resize(src, &mut dst, &opts).is_err() {
        // Fall back to the image crate if fast_image_resize rejects the input for any reason.
        let f = match filter {
            Filter::Nearest => image::imageops::FilterType::Nearest,
            Filter::Bilinear => image::imageops::FilterType::Triangle,
            Filter::CatmullRom => image::imageops::FilterType::CatmullRom,
            Filter::Lanczos3 => image::imageops::FilterType::Lanczos3,
        };
        return image::imageops::resize(src, w, h, f);
    }
    dst
}

/// Composite `src` over `dst` with its top-left corner at (`x`, `y`) (may be
/// negative or overflow; out-of-bounds parts are skipped) multiplied by `opacity`.
/// Uses the Porter-Duff "over" operator on straight alpha.
pub fn blend_over(dst: &mut RgbaImage, src: &RgbaImage, x: i64, y: i64, opacity: f32) {
    let opacity = opacity.clamp(0.0, 1.0);
    if opacity <= 0.0 {
        return;
    }
    let (dw, dh) = (dst.width() as i64, dst.height() as i64);
    let x0 = x.max(0);
    let y0 = y.max(0);
    let x1 = (x + src.width() as i64).min(dw);
    let y1 = (y + src.height() as i64).min(dh);
    if x0 >= x1 || y0 >= y1 {
        return;
    }
    let op = (opacity * 255.0).round() as u32;
    for ty in y0..y1 {
        let sy = (ty - y) as u32;
        for tx in x0..x1 {
            let sx = (tx - x) as u32;
            let s = src.get_pixel(sx, sy).0;
            let d = dst.get_pixel_mut(tx as u32, ty as u32);
            blend_pixel(&mut d.0, s, op);
        }
    }
}

/// Blend one straight-alpha source pixel over a destination pixel.
/// `op` is an extra opacity in 0..=255.
#[inline]
pub fn blend_pixel(d: &mut [u8; 4], s: [u8; 4], op: u32) {
    let sa = (s[3] as u32 * op + 127) / 255; // 0..=255
    if sa == 0 {
        return;
    }
    if sa == 255 {
        *d = [s[0], s[1], s[2], 255];
        return;
    }
    let da = d[3] as u32;
    if da == 255 {
        let inv = 255 - sa;
        for i in 0..3 {
            d[i] = ((s[i] as u32 * sa + d[i] as u32 * inv + 127) / 255) as u8;
        }
        return;
    }
    // General case with translucent destination.
    let sa_f = sa as f32 / 255.0;
    let da_f = da as f32 / 255.0;
    let out_a = sa_f + da_f * (1.0 - sa_f);
    if out_a <= 0.0 {
        *d = [0, 0, 0, 0];
        return;
    }
    for i in 0..3 {
        let c = (s[i] as f32 * sa_f + d[i] as f32 * da_f * (1.0 - sa_f)) / out_a;
        d[i] = c.round().clamp(0.0, 255.0) as u8;
    }
    d[3] = (out_a * 255.0).round() as u8;
}

/// Copy `src` into `dst` at (x, y) without blending (used when the destination is a
/// freshly created transparent canvas and the source should be placed verbatim).
pub fn copy_into(dst: &mut RgbaImage, src: &RgbaImage, x: u32, y: u32) {
    image::imageops::replace(dst, src, x as i64, y as i64);
}

/// Flatten transparency onto an opaque background color, returning RGB.
pub fn flatten(img: &RgbaImage, bg: [u8; 3]) -> image::RgbImage {
    let mut out = image::RgbImage::new(img.width(), img.height());
    for (o, p) in out.pixels_mut().zip(img.pixels()) {
        let a = p.0[3] as u32;
        let inv = 255 - a;
        o.0 = [
            ((p.0[0] as u32 * a + bg[0] as u32 * inv + 127) / 255) as u8,
            ((p.0[1] as u32 * a + bg[1] as u32 * inv + 127) / 255) as u8,
            ((p.0[2] as u32 * a + bg[2] as u32 * inv + 127) / 255) as u8,
        ];
    }
    out
}

pub fn is_opaque(img: &RgbaImage) -> bool {
    img.pixels().all(|p| p.0[3] == 255)
}

pub fn to_rgb(img: &RgbaImage) -> image::RgbImage {
    let mut out = image::RgbImage::new(img.width(), img.height());
    for (o, p) in out.pixels_mut().zip(img.pixels()) {
        o.0 = [p.0[0], p.0[1], p.0[2]];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn blend_over_opaque_and_half() {
        let mut d = [100, 100, 100, 255];
        blend_pixel(&mut d, [200, 0, 0, 255], 255);
        assert_eq!(d, [200, 0, 0, 255]);
        let mut d = [0, 0, 0, 255];
        blend_pixel(&mut d, [255, 255, 255, 255], 128);
        assert_eq!(d, [128, 128, 128, 255]);
        // transparent destination keeps source color and takes its alpha
        let mut d = [0, 0, 0, 0];
        blend_pixel(&mut d, [10, 20, 30, 100], 255);
        assert_eq!(d, [10, 20, 30, 100]);
        // zero opacity is a no-op
        let mut d = [1, 2, 3, 4];
        blend_pixel(&mut d, [255, 255, 255, 255], 0);
        assert_eq!(d, [1, 2, 3, 4]);
    }

    #[test]
    fn blend_clips_out_of_bounds() {
        let mut dst = RgbaImage::from_pixel(4, 4, Rgba([0, 0, 0, 255]));
        let src = RgbaImage::from_pixel(3, 3, Rgba([255, 0, 0, 255]));
        blend_over(&mut dst, &src, -2, 3, 1.0);
        assert_eq!(dst.get_pixel(0, 3).0, [255, 0, 0, 255]);
        assert_eq!(dst.get_pixel(1, 3).0, [0, 0, 0, 255]);
        assert_eq!(dst.get_pixel(0, 2).0, [0, 0, 0, 255]);
    }

    #[test]
    fn resample_exact_size_and_alpha_safe() {
        let mut src = RgbaImage::from_pixel(100, 50, Rgba([0, 0, 0, 0]));
        for y in 0..50 {
            for x in 50..100 {
                src.put_pixel(x, y, Rgba([255, 255, 255, 255]));
            }
        }
        let out = resample(&src, 37, 13, Filter::Lanczos3);
        assert_eq!(out.dimensions(), (37, 13));
        // A pixel well inside the opaque white half stays white (no dark fringe from
        // un-premultiplied black transparent pixels).
        let p = out.get_pixel(33, 6).0;
        assert!(p[0] > 245 && p[3] > 245, "{p:?}");
    }

    #[test]
    fn flatten_uses_background() {
        let img = RgbaImage::from_pixel(1, 1, Rgba([0, 0, 0, 0]));
        assert_eq!(flatten(&img, [10, 20, 30]).get_pixel(0, 0).0, [10, 20, 30]);
    }
}
