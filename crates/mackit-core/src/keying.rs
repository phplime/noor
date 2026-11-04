//! Background keying for logos, graphics, screenshots and product shots on a
//! plain background — the cases where photo-trained subject detection (Vision)
//! keeps only the "main object" and drops text or small parts.
//!
//! * The background colour is the median of the image border.
//! * Alpha comes from "colour-to-alpha" un-mixing against that colour, normalised
//!   by the strongest alpha nearby, so solid shapes of any colour become fully
//!   opaque while anti-aliased edges keep exactly their partial coverage.
//! * Edge colours are decontaminated (the background tint is removed), so no
//!   dark or light fringe remains when the result goes on another background.
//! * Clicked points keep only the shapes near them; nearby shapes (the letters of
//!   one word) are grouped together.

use crate::background::morph;
use image::RgbaImage;
use std::collections::VecDeque;

/// Median colour of a 2-pixel border ring.
pub fn border_color(img: &RgbaImage) -> [u8; 3] {
    let border = border_pixels(img);
    let mut out = [0u8; 3];
    for (k, o) in out.iter_mut().enumerate() {
        let mut v: Vec<u8> = border.iter().map(|p| p[k]).collect();
        v.sort_unstable();
        *o = v[v.len() / 2];
    }
    out
}

fn border_pixels(img: &RgbaImage) -> Vec<[u8; 3]> {
    let (w, h) = img.dimensions();
    let ring = 2.min(w).min(h);
    let mut px = Vec::with_capacity(((w + h) * 2 * ring) as usize);
    for y in 0..h {
        for x in 0..w {
            if x < ring || y < ring || x >= w - ring || y >= h - ring {
                let p = img.get_pixel(x, y).0;
                px.push([p[0], p[1], p[2]]);
            }
        }
    }
    px
}

/// The background colour, if the border is (almost) one flat colour.
pub fn uniform_background(img: &RgbaImage) -> Option<[u8; 3]> {
    let (w, h) = img.dimensions();
    if w < 8 || h < 8 {
        return None;
    }
    // A transparent border is already "removed"; key on it only if it's opaque.
    let bg = border_color(img);
    let border = border_pixels(img);
    let close = border
        .iter()
        .filter(|p| (0..3).all(|k| (p[k] as i32 - bg[k] as i32).abs() <= 18))
        .count();
    (close as f64 / border.len() as f64 >= 0.9).then_some(bg)
}

/// Per-channel "colour-to-alpha", split by direction: how much `p` is explained
/// by mixing the background with a *lighter* colour, and with a *darker* one.
/// The headroom is floored so that on very dark (or very light) backgrounds a
/// few levels of noise can't read as opacity.
fn unmix(p: [u8; 4], bg: [u8; 3]) -> (f32, f32) {
    const MIN_HEADROOM: f32 = 64.0;
    let (mut light, mut dark) = (0f32, 0f32);
    for k in 0..3 {
        let (v, b) = (p[k] as f32, bg[k] as f32);
        if v > b {
            light = light.max((v - b) / (255.0 - b).max(MIN_HEADROOM));
        } else {
            dark = dark.max((b - v) / b.max(MIN_HEADROOM));
        }
    }
    let a = p[3] as f32 / 255.0;
    (light.min(1.0) * a, dark.min(1.0) * a)
}

fn unmix_alpha(p: [u8; 4], bg: [u8; 3]) -> f32 {
    let (l, d) = unmix(p, bg);
    l.max(d)
}

/// Noise level of the background: 99th percentile of the border's un-mixed alpha.
fn border_noise(img: &RgbaImage, bg: [u8; 3]) -> f32 {
    let mut v: Vec<f32> = border_pixels(img)
        .into_iter()
        .map(|p| unmix_alpha([p[0], p[1], p[2], 255], bg))
        .collect();
    v.sort_by(|a, b| a.total_cmp(b));
    v[(v.len() * 99 / 100).min(v.len() - 1)]
}

/// Result of keying.
pub struct Keyed {
    /// Output alpha (1 = keep).
    pub alpha: Vec<f32>,
    /// Estimated true mix of subject and background colour per pixel, used to
    /// remove the background tint from edges (not snapped like `alpha`).
    pub mix: Vec<f32>,
}

/// Alpha mask (1 = keep) separating everything that differs from `bg`.
/// `tolerance` (0–1) ignores small differences such as JPEG noise; it is raised
/// automatically to the measured noise of the background.
pub fn key_mask(img: &RgbaImage, bg: [u8; 3], tolerance: f32) -> Vec<f32> {
    key(img, bg, tolerance).alpha
}

pub fn key(img: &RgbaImage, bg: [u8; 3], tolerance: f32) -> Keyed {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let tol = tolerance.max(border_noise(img, bg) * 1.5).clamp(0.0, 0.9);
    let over = |v: f32| ((v - tol) / (1.0 - tol)).max(0.0);
    let (raw_l, raw_d): (Vec<f32>, Vec<f32>) = img
        .pixels()
        .map(|p| {
            let (l, d) = unmix(p.0, bg);
            (over(l), over(d))
        })
        .unzip();
    // How solid the area around each pixel is, separately for shapes lighter and
    // darker than the background. Averaging first (3×3) means an isolated noisy
    // pixel can't vouch for itself; then take the strongest value within a few
    // pixels. A solid mid-grey shape on black un-mixes to ~0.5, but it is clearly
    // fully opaque, so alpha is normalised by this reference.
    let r = ((w.min(h) as f32 / 400.0).round() as usize).clamp(2, 12);
    let reference = |raw: &[f32]| {
        let mut v = box3(raw, w, h);
        morph(&mut v, w, h, r, true);
        v
    };
    let (ref_l, ref_d) = (reference(&raw_l), reference(&raw_d));
    let mut mix = vec![0f32; w * h];
    let mut alpha = vec![0f32; w * h];
    for i in 0..w * h {
        // An edge pixel of a light shape must itself be lighter than the
        // background (and vice versa). Compression "ringing" that goes the other
        // way next to a shape is ignored.
        let (raw, rf) = if ref_l[i] >= ref_d[i] {
            (raw_l[i], ref_l[i])
        } else {
            (raw_d[i], ref_d[i])
        };
        mix[i] = (raw / rf.max(1e-3)).min(1.0);
        // Fade out regions that are only faintly different (noise, haze).
        let solid = ((rf - 0.08) / 0.12).clamp(0.0, 1.0);
        // Slight variation inside a solid shape (off-white text, gradients,
        // compression) must not leave it 95 % opaque: snap the top end to 1.
        alpha[i] = (mix[i] / 0.9).min(1.0) * solid;
    }
    Keyed { alpha, mix }
}

/// 3×3 mean.
fn box3(src: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut out = vec![0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let (mut s, mut n) = (0f32, 0f32);
            for yy in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                for xx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                    s += src[yy * w + xx];
                    n += 1.0;
                }
            }
            out[y * w + x] = s / n;
        }
    }
    out
}

/// Remove the background tint from partially covered edge pixels, given each
/// pixel's subject/background `mix`.
pub fn decontaminate(img: &mut RgbaImage, mix: &[f32], bg: [u8; 3]) {
    for (i, p) in img.pixels_mut().enumerate() {
        let a = mix[i];
        if a > 0.02 && a < 0.98 {
            for (c, b) in p.0.iter_mut().zip(bg) {
                let b = b as f32;
                *c = (b + (*c as f32 - b) / a).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

/// Keep only the shapes near the clicked points. Shapes closer than `group_px`
/// to each other (letters of a word, parts of an icon) count as one.
pub fn keep_picked(mask: &mut [f32], w: usize, h: usize, picks: &[[f64; 2]], group_px: usize) {
    if picks.is_empty() {
        return;
    }
    let mut solid: Vec<f32> = mask
        .iter()
        .map(|a| if *a > 0.25 { 1.0 } else { 0.0 })
        .collect();
    morph(&mut solid, w, h, group_px.max(1), true);

    // Label connected groups (4-connected flood fill).
    let mut label = vec![0u32; w * h];
    let mut next = 0u32;
    let mut queue = VecDeque::new();
    for start in 0..w * h {
        if solid[start] < 0.5 || label[start] != 0 {
            continue;
        }
        next += 1;
        label[start] = next;
        queue.push_back(start);
        while let Some(i) = queue.pop_front() {
            let (x, y) = (i % w, i / w);
            let mut visit = |j: usize| {
                if solid[j] >= 0.5 && label[j] == 0 {
                    label[j] = next;
                    queue.push_back(j);
                }
            };
            if x > 0 {
                visit(i - 1);
            }
            if x + 1 < w {
                visit(i + 1);
            }
            if y > 0 {
                visit(i - w);
            }
            if y + 1 < h {
                visit(i + w);
            }
        }
    }

    // Groups under (or nearest to) each click.
    let search = (w.min(h) / 20).max(4) as i64;
    let mut keep = std::collections::HashSet::new();
    for p in picks {
        let px = ((p[0] * w as f64) as i64).clamp(0, w as i64 - 1);
        let py = ((p[1] * h as f64) as i64).clamp(0, h as i64 - 1);
        let mut best: Option<(i64, u32)> = None;
        for y in (py - search).max(0)..=(py + search).min(h as i64 - 1) {
            for x in (px - search).max(0)..=(px + search).min(w as i64 - 1) {
                let l = label[y as usize * w + x as usize];
                if l != 0 {
                    let d = (x - px).pow(2) + (y - py).pow(2);
                    if best.is_none_or(|(bd, _)| d < bd) {
                        best = Some((d, l));
                    }
                }
            }
        }
        if let Some((_, l)) = best {
            keep.insert(l);
        }
    }
    for (i, a) in mask.iter_mut().enumerate() {
        if !keep.contains(&label[i]) {
            *a = 0.0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    const NAVY: [u8; 3] = [20, 26, 46];

    /// Navy background, white "text" bar with an anti-aliased edge column, a
    /// mid-grey square "icon" and a blue square, with a navy hole inside.
    fn logo() -> RgbaImage {
        RgbaImage::from_fn(300, 120, |x, y| {
            let navy = Rgba([NAVY[0], NAVY[1], NAVY[2], 255]);
            if (20..60).contains(&x) && (30..90).contains(&y) {
                return Rgba([120, 120, 120, 255]); // grey icon
            }
            if (80..120).contains(&x) && (30..90).contains(&y) {
                if (92..108).contains(&x) && (50..70).contains(&y) {
                    return navy; // hole, like the inside of an "o"
                }
                return Rgba([40, 160, 250, 255]);
            }
            if (180..280).contains(&x) && (50..70).contains(&y) {
                if x == 180 {
                    // 50 % anti-aliased white over navy
                    return Rgba([137, 140, 150, 255]);
                }
                return Rgba([255, 255, 255, 255]);
            }
            navy
        })
    }

    #[test]
    fn detects_plain_backgrounds() {
        assert_eq!(uniform_background(&logo()), Some(NAVY));
        let noisy = RgbaImage::from_fn(100, 100, |x, y| {
            Rgba([(x * 2) as u8, (y * 2) as u8, 0, 255])
        });
        assert_eq!(uniform_background(&noisy), None);
    }

    #[test]
    fn keeps_every_shape_including_text_and_holes() {
        let img = logo();
        let m = key_mask(&img, NAVY, 0.05);
        let at = |x: usize, y: usize| m[y * 300 + x];
        assert_eq!(at(5, 5), 0.0, "background");
        assert!(
            at(40, 60) > 0.98,
            "mid-grey icon is fully opaque: {}",
            at(40, 60)
        );
        assert!(at(85, 40) > 0.98, "blue shape");
        assert_eq!(at(100, 60), 0.0, "hole inside a shape is background");
        assert!(at(230, 60) > 0.98, "text");
        let edge = at(180, 60);
        assert!(
            (0.4..0.6).contains(&edge),
            "anti-aliased edge keeps partial alpha: {edge}"
        );
    }

    #[test]
    fn noise_on_a_dark_background_is_not_kept() {
        // ±3 levels of noise on navy, plus a single brighter speck.
        let mut img = logo();
        for (i, p) in img.pixels_mut().enumerate() {
            if p.0[..3] == NAVY {
                let d = (i * 7919 % 7) as i32 - 3;
                for k in 0..3 {
                    p.0[k] = (p.0[k] as i32 + d).clamp(0, 255) as u8;
                }
            }
        }
        img.put_pixel(
            150,
            10,
            Rgba([NAVY[0] + 25, NAVY[1] + 25, NAVY[2] + 25, 255]),
        );
        let m = key_mask(&img, NAVY, 0.05);
        let stray = (0..300 * 120)
            .filter(|i| {
                let (x, y) = (i % 300, i / 300);
                let in_shape =
                    ((20..60).contains(&x) || (80..120).contains(&x) || (180..280).contains(&x))
                        && (30..90).contains(&y);
                !in_shape && m[*i] > 0.05
            })
            .count();
        assert_eq!(stray, 0, "background noise and specks are removed");
        assert!(m[60 * 300 + 230] > 0.98 && m[60 * 300 + 40] > 0.98);
    }

    #[test]
    fn compression_ringing_next_to_light_text_is_ignored() {
        let mut img = logo();
        // Darker-than-background pixels hugging the white text, as JPEG produces.
        for x in 182..278 {
            img.put_pixel(x, 49, Rgba([NAVY[0] - 4, NAVY[1] - 6, NAVY[2] - 9, 255]));
        }
        let m = key_mask(&img, NAVY, 0.05);
        assert!(
            (182..278).all(|x| m[49 * 300 + x] < 0.02),
            "ringing removed"
        );
        assert!(m[55 * 300 + 230] > 0.98);
    }

    #[test]
    fn decontaminates_edges() {
        let mut img = logo();
        let k = key(&img, NAVY, 0.05);
        decontaminate(&mut img, &k.mix, NAVY);
        let p = img.get_pixel(180, 60).0;
        assert!(
            p[0] > 240 && p[1] > 240 && p[2] > 240,
            "edge pixel is white again: {p:?}"
        );
    }

    #[test]
    fn picking_keeps_only_the_clicked_group() {
        let img = logo();
        let mut m = key_mask(&img, NAVY, 0.05);
        keep_picked(&mut m, 300, 120, &[[230.0 / 300.0, 60.0 / 120.0]], 6);
        assert!(m[60 * 300 + 230] > 0.9, "text kept");
        assert_eq!(m[60 * 300 + 40], 0.0, "icon dropped");
        // Clicking the background between the icons picks the nearest shape.
        let mut m = key_mask(&img, NAVY, 0.05);
        keep_picked(&mut m, 300, 120, &[[70.0 / 300.0, 60.0 / 120.0]], 6);
        assert!(m[60 * 300 + 40] > 0.9 || m[40 * 300 + 85] > 0.9);
    }
}
