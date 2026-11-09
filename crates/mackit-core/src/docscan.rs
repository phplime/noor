//! Document / ID-card helpers for Studio › ID / Passport Copy:
//! find the card's four corners in a photo, straighten it (perspective correction) and
//! make it clearer (auto levels + light sharpening).
//!
//! Corners are always normalised (0..1 of the photo's width/height) and ordered
//! top-left, top-right, bottom-right, bottom-left.

use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

pub type Quad = [Pt; 4];

/// Corners a little inside the photo's edges: the starting point when nothing is found.
pub fn default_quad() -> Quad {
    let m = 0.06;
    [Pt { x: m, y: m }, Pt { x: 1.0 - m, y: m }, Pt { x: 1.0 - m, y: 1.0 - m }, Pt { x: m, y: 1.0 - m }]
}

/// Put any four points in TL, TR, BR, BL order.
pub fn order_quad(p: [Pt; 4]) -> Quad {
    let by = |f: &dyn Fn(&Pt) -> f64, max: bool| {
        let mut best = p[0];
        for q in &p[1..] {
            if (f(q) > f(&best)) == max {
                best = *q;
            }
        }
        best
    };
    let tl = by(&|q| q.x + q.y, false);
    let br = by(&|q| q.x + q.y, true);
    let tr = by(&|q| q.x - q.y, true);
    let bl = by(&|q| q.y - q.x, true);
    [tl, tr, br, bl]
}

/// Find a card/document that stands out from its background. Works best on a plain,
/// contrasting surface. `None` when nothing convincing is found.
pub fn detect_quad(img: &RgbaImage) -> Option<Quad> {
    let (w0, h0) = img.dimensions();
    if w0 < 16 || h0 < 16 {
        return None;
    }
    // Work small: fast and less noisy.
    let scale = 360.0 / w0.max(h0) as f64;
    let (w, h) = (((w0 as f64 * scale).round() as u32).max(8), ((h0 as f64 * scale).round() as u32).max(8));
    let small = image::imageops::resize(img, w, h, image::imageops::FilterType::Triangle);

    // Background colour = the photo's border; the card = pixels clearly different from it.
    let mut border: Vec<[f64; 3]> = Vec::new();
    for x in 0..w {
        for y in [0, h - 1] {
            let p = small.get_pixel(x, y);
            border.push([p[0] as f64, p[1] as f64, p[2] as f64]);
        }
    }
    for y in 0..h {
        for x in [0, w - 1] {
            let p = small.get_pixel(x, y);
            border.push([p[0] as f64, p[1] as f64, p[2] as f64]);
        }
    }
    let n = border.len() as f64;
    let bg = [0, 1, 2].map(|c| border.iter().map(|p| p[c]).sum::<f64>() / n);
    let dist = |p: &Rgba<u8>| ((p[0] as f64 - bg[0]).powi(2) + (p[1] as f64 - bg[1]).powi(2) + (p[2] as f64 - bg[2]).powi(2)).sqrt();

    // Colour distance from the background.
    let mut score = vec![0f64; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            score[(y * w + x) as usize] = dist(small.get_pixel(x, y));
        }
    }
    let thr = otsu(&score);
    if thr < 18.0 {
        return None; // card and background look the same
    }
    let mask: Vec<bool> = score.iter().map(|&s| s > thr).collect();

    // Largest connected blob.
    let mut label = vec![0u32; mask.len()];
    let mut best: (u32, usize) = (0, 0);
    let mut next = 1u32;
    let mut stack = Vec::new();
    for i in 0..mask.len() {
        if !mask[i] || label[i] != 0 {
            continue;
        }
        let mut size = 0usize;
        label[i] = next;
        stack.push(i);
        while let Some(j) = stack.pop() {
            size += 1;
            let (x, y) = ((j as u32) % w, (j as u32) / w);
            let mut push = |nx: i64, ny: i64| {
                if nx >= 0 && ny >= 0 && (nx as u32) < w && (ny as u32) < h {
                    let k = (ny as u32 * w + nx as u32) as usize;
                    if mask[k] && label[k] == 0 {
                        label[k] = next;
                        stack.push(k);
                    }
                }
            };
            push(x as i64 + 1, y as i64);
            push(x as i64 - 1, y as i64);
            push(x as i64, y as i64 + 1);
            push(x as i64, y as i64 - 1);
        }
        if size > best.1 {
            best = (next, size);
        }
        next += 1;
    }
    let area = (w * h) as usize;
    if best.1 < area / 12 || best.1 > area * 97 / 100 {
        return None; // too small to be the card, or the whole photo
    }

    // Corners = the blob's extreme points along the diagonals.
    let mut pts = [(f64::MAX, Pt { x: 0.0, y: 0.0 }), (f64::MIN, Pt { x: 0.0, y: 0.0 }), (f64::MIN, Pt { x: 0.0, y: 0.0 }), (f64::MIN, Pt { x: 0.0, y: 0.0 })];
    for (i, &l) in label.iter().enumerate() {
        if l != best.0 {
            continue;
        }
        let (x, y) = ((i as u32 % w) as f64 + 0.5, (i as u32 / w) as f64 + 0.5);
        let p = Pt { x: x / w as f64, y: y / h as f64 };
        if x + y < pts[0].0 {
            pts[0] = (x + y, p);
        }
        if x - y > pts[1].0 {
            pts[1] = (x - y, p);
        }
        if x + y > pts[2].0 {
            pts[2] = (x + y, p);
        }
        if y - x > pts[3].0 {
            pts[3] = (y - x, p);
        }
    }
    let q = [pts[0].1, pts[1].1, pts[2].1, pts[3].1];
    // Sanity: a real quad covers a good part of the blob.
    let qa = quad_area(&q) * area as f64;
    if qa < best.1 as f64 * 0.7 {
        return None;
    }
    Some(q)
}

fn quad_area(q: &Quad) -> f64 {
    let mut s = 0.0;
    for i in 0..4 {
        let (a, b) = (q[i], q[(i + 1) % 4]);
        s += a.x * b.y - b.x * a.y;
    }
    s.abs() / 2.0
}

/// Otsu threshold for values 0..~442.
fn otsu(v: &[f64]) -> f64 {
    let bins = 256usize;
    let max = v.iter().cloned().fold(1.0, f64::max);
    let mut hist = vec![0f64; bins];
    for &x in v {
        hist[((x / max) * (bins - 1) as f64) as usize] += 1.0;
    }
    let total = v.len() as f64;
    let sum: f64 = hist.iter().enumerate().map(|(i, c)| i as f64 * c).sum();
    let (mut wb, mut sb, mut best, mut thr) = (0.0, 0.0, 0.0, 0usize);
    for (i, &c) in hist.iter().enumerate() {
        wb += c;
        if wb == 0.0 {
            continue;
        }
        let wf = total - wb;
        if wf == 0.0 {
            break;
        }
        sb += i as f64 * c;
        let mb = sb / wb;
        let mf = (sum - sb) / wf;
        let between = wb * wf * (mb - mf).powi(2);
        if between > best {
            best = between;
            thr = i;
        }
    }
    thr as f64 / (bins - 1) as f64 * max
}

/// Straighten the area inside `q` into an `out_w` × `out_h` rectangle.
pub fn warp(img: &RgbaImage, q: &Quad, out_w: u32, out_h: u32) -> RgbaImage {
    let (sw, sh) = (img.width() as f64, img.height() as f64);
    let src = q.map(|p| (p.x * sw, p.y * sh));
    let dst = [(0.0, 0.0), (out_w as f64, 0.0), (out_w as f64, out_h as f64), (0.0, out_h as f64)];
    // Map output → source.
    let hm = homography(&dst, &src);
    let mut out = RgbaImage::new(out_w, out_h);
    for y in 0..out_h {
        for x in 0..out_w {
            let (fx, fy) = (x as f64 + 0.5, y as f64 + 0.5);
            let d = hm[6] * fx + hm[7] * fy + 1.0;
            let u = (hm[0] * fx + hm[1] * fy + hm[2]) / d - 0.5;
            let v = (hm[3] * fx + hm[4] * fy + hm[5]) / d - 0.5;
            out.put_pixel(x, y, bilinear(img, u, v));
        }
    }
    out
}

fn bilinear(img: &RgbaImage, u: f64, v: f64) -> Rgba<u8> {
    let (w, h) = (img.width() as i64, img.height() as i64);
    let x0 = u.floor() as i64;
    let y0 = v.floor() as i64;
    let (ax, ay) = (u - x0 as f64, v - y0 as f64);
    let px = |x: i64, y: i64| img.get_pixel(x.clamp(0, w - 1) as u32, y.clamp(0, h - 1) as u32);
    let (a, b, c, d) = (px(x0, y0), px(x0 + 1, y0), px(x0, y0 + 1), px(x0 + 1, y0 + 1));
    let mut o = [0u8; 4];
    for i in 0..4 {
        let top = a[i] as f64 * (1.0 - ax) + b[i] as f64 * ax;
        let bot = c[i] as f64 * (1.0 - ax) + d[i] as f64 * ax;
        o[i] = (top * (1.0 - ay) + bot * ay).round().clamp(0.0, 255.0) as u8;
    }
    Rgba(o)
}

/// 3×3 homography (h33 = 1) taking `from[i]` to `to[i]`.
fn homography(from: &[(f64, f64); 4], to: &[(f64, f64); 4]) -> [f64; 8] {
    let mut a = [[0f64; 9]; 8];
    for i in 0..4 {
        let (x, y) = from[i];
        let (u, v) = to[i];
        a[2 * i] = [x, y, 1.0, 0.0, 0.0, 0.0, -u * x, -u * y, u];
        a[2 * i + 1] = [0.0, 0.0, 0.0, x, y, 1.0, -v * x, -v * y, v];
    }
    // Gaussian elimination with partial pivoting.
    for c in 0..8 {
        let p = (c..8).max_by(|&i, &j| a[i][c].abs().total_cmp(&a[j][c].abs())).unwrap_or(c);
        a.swap(c, p);
        let d = if a[c][c].abs() < 1e-12 { 1e-12 } else { a[c][c] };
        for k in c..9 {
            a[c][k] /= d;
        }
        for r in 0..8 {
            if r != c {
                let f = a[r][c];
                for k in c..9 {
                    a[r][k] -= f * a[c][k];
                }
            }
        }
    }
    let mut h = [0f64; 8];
    for i in 0..8 {
        h[i] = a[i][8];
    }
    h
}

/// Output size for a straightened card: keeps the document's real shape when `aspect`
/// (width / height) is given, otherwise the shape measured from the corners.
pub fn output_size(img_w: u32, img_h: u32, q: &Quad, aspect: Option<f64>) -> (u32, u32) {
    let (w, h) = (img_w as f64, img_h as f64);
    let d = |a: Pt, b: Pt| (((a.x - b.x) * w).powi(2) + ((a.y - b.y) * h).powi(2)).sqrt();
    let top = d(q[0], q[1]);
    let bottom = d(q[3], q[2]);
    let left = d(q[0], q[3]);
    let right = d(q[1], q[2]);
    let mw = top.max(bottom);
    let mh = left.max(right);
    let measured = mw / mh.max(1.0);
    let mut ar = aspect.unwrap_or(measured);
    // A card photographed upright (portrait): keep it portrait.
    if aspect.is_some() && measured < 1.0 && ar > 1.0 {
        ar = 1.0 / ar;
    }
    // Long side up to 2000 px (≈ 600 dpi for an ID card), never upscaled beyond 1.5×.
    let long = mw.max(mh).min(2000.0).max(600.0).min(mw.max(mh) * 1.5);
    if ar >= 1.0 {
        (long.round() as u32, (long / ar).round().max(1.0) as u32)
    } else {
        ((long * ar).round().max(1.0) as u32, long.round() as u32)
    }
}

/// Cut off dark strips left along the edges of a straightened card (table, shadow or the
/// laminate's edge when the corners sat a little outside the card). Looks at each side and
/// steps inward while that row/column is clearly darker than the card itself — at most 7%
/// per side — then scales the rest back to the same size.
pub fn trim_dark_edges(img: &RgbaImage) -> RgbaImage {
    let (w, h) = img.dimensions();
    if w < 40 || h < 40 {
        return img.clone();
    }
    let luma = |x: u32, y: u32| {
        let p = img.get_pixel(x, y);
        0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64
    };
    // Typical brightness of the card: median of a central patch.
    let mut centre: Vec<f64> = Vec::new();
    let (sx, sy) = ((w / 40).max(1), (h / 40).max(1));
    for y in (h / 4..h * 3 / 4).step_by(sy as usize) {
        for x in (w / 4..w * 3 / 4).step_by(sx as usize) {
            centre.push(luma(x, y));
        }
    }
    centre.sort_by(|a, b| a.total_cmp(b));
    let card = centre[centre.len() / 2];
    // A line counts as "edge junk" when most of it is much darker than the card.
    let dark = card * 0.72;
    let row_dark = |y: u32| {
        let n = (w * 8 / 10).max(1);
        let d = (w / 10..w / 10 + n).filter(|&x| luma(x, y) < dark).count();
        d as f64 / n as f64 > 0.5
    };
    let col_dark = |x: u32| {
        let n = (h * 8 / 10).max(1);
        let d = (h / 10..h / 10 + n).filter(|&y| luma(x, y) < dark).count();
        d as f64 / n as f64 > 0.5
    };
    let (mx, my) = (w * 7 / 100, h * 7 / 100);
    let mut top = 0;
    while top < my && row_dark(top) {
        top += 1;
    }
    let mut bottom = 0;
    while bottom < my && row_dark(h - 1 - bottom) {
        bottom += 1;
    }
    let mut left = 0;
    while left < mx && col_dark(left) {
        left += 1;
    }
    let mut right = 0;
    while right < mx && col_dark(w - 1 - right) {
        right += 1;
    }
    if top + bottom + left + right == 0 {
        return img.clone();
    }
    // One extra pixel for the soft (anti-aliased) edge.
    let pad = |v: u32, m: u32| if v > 0 { (v + 2).min(m) } else { 0 };
    let (top, bottom, left, right) = (pad(top, my), pad(bottom, my), pad(left, mx), pad(right, mx));
    let cropped = image::imageops::crop_imm(img, left, top, w - left - right, h - top - bottom).to_image();
    image::imageops::resize(&cropped, w, h, image::imageops::FilterType::Lanczos3)
}

/// Pull the corners a little toward the middle (`f` = fraction of the card's size) so no
/// sliver of the table survives along the edges.
pub fn inset_quad(q: &Quad, f: f64) -> Quad {
    let cx = q.iter().map(|p| p.x).sum::<f64>() / 4.0;
    let cy = q.iter().map(|p| p.y).sum::<f64>() / 4.0;
    q.map(|p| Pt { x: p.x + (cx - p.x) * f * 2.0, y: p.y + (cy - p.y) * f * 2.0 })
}

/// Make a scanned card clearer but natural:
/// 1. white balance — the card's paper (its brightest 2%) becomes neutral white, removing the
///    yellow/blue cast of room light;
/// 2. levels — the darkest 0.5% becomes black, so faded text gets its contrast back;
/// 3. a light sharpen for crisp print.
/// Colours keep their saturation: no extra contrast curve is applied.
pub fn enhance(img: &mut RgbaImage) {
    let n = (img.width() * img.height()) as usize;
    if n == 0 {
        return;
    }
    let mut hist = [[0u32; 256]; 4]; // r, g, b, luma
    for p in img.pixels() {
        let l = (0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64) as usize;
        hist[0][p[0] as usize] += 1;
        hist[1][p[1] as usize] += 1;
        hist[2][p[2] as usize] += 1;
        hist[3][l.min(255)] += 1;
    }
    let pct = |h: &[u32; 256], frac: f64| {
        let target = (n as f64 * frac) as u32;
        let mut acc = 0;
        for (i, &c) in h.iter().enumerate() {
            acc += c;
            if acc >= target {
                return i as f64;
            }
        }
        255.0
    };
    let white = [pct(&hist[0], 0.98), pct(&hist[1], 0.98), pct(&hist[2], 0.98)];
    let black = pct(&hist[3], 0.005).min(60.0);
    // Don't "correct" a card that is genuinely coloured all over (white point far too dark).
    if white.iter().any(|&w| w < 110.0) {
        sharpen(img, 0.35);
        return;
    }
    let lut: Vec<[u8; 256]> = (0..3)
        .map(|c| {
            let wp = white[c].max(black + 30.0);
            let mut t = [0u8; 256];
            for (v, slot) in t.iter_mut().enumerate() {
                let x = ((v as f64 - black) / (wp - black)).clamp(0.0, 1.0);
                *slot = (x * 255.0).round() as u8;
            }
            t
        })
        .collect();
    for p in img.pixels_mut() {
        for c in 0..3 {
            p[c] = lut[c][p[c] as usize];
        }
    }
    sharpen(img, 0.35);
}

/// Unsharp mask with a 3×3 box blur.
fn sharpen(img: &mut RgbaImage, amount: f64) {
    let (w, h) = img.dimensions();
    if w < 3 || h < 3 {
        return;
    }
    let src = img.clone();
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let mut sum = [0f64; 3];
            for dy in 0..3 {
                for dx in 0..3 {
                    let p = src.get_pixel(x + dx - 1, y + dy - 1);
                    for c in 0..3 {
                        sum[c] += p[c] as f64;
                    }
                }
            }
            let o = src.get_pixel(x, y);
            let px = img.get_pixel_mut(x, y);
            for c in 0..3 {
                let blur = sum[c] / 9.0;
                px[c] = (o[c] as f64 + amount * (o[c] as f64 - blur)).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card_photo() -> (RgbaImage, Quad) {
        // Dark table, light tilted card.
        let (w, h) = (800u32, 600u32);
        let q = [Pt { x: 0.20, y: 0.22 }, Pt { x: 0.78, y: 0.16 }, Pt { x: 0.82, y: 0.70 }, Pt { x: 0.16, y: 0.76 }];
        let inside = |x: f64, y: f64| {
            let mut s: i32 = 0;
            for i in 0..4 {
                let (a, b) = (q[i], q[(i + 1) % 4]);
                let c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
                s += if c >= 0.0 { 1 } else { -1 };
            }
            s.abs() == 4
        };
        let img = RgbaImage::from_fn(w, h, |x, y| {
            if inside(x as f64 / w as f64, y as f64 / h as f64) {
                Rgba([235, 232, 220, 255])
            } else {
                Rgba([40, 45, 50, 255])
            }
        });
        (img, q)
    }

    #[test]
    fn finds_a_tilted_card() {
        let (img, want) = card_photo();
        let got = detect_quad(&img).expect("card found");
        for i in 0..4 {
            assert!((got[i].x - want[i].x).abs() < 0.02 && (got[i].y - want[i].y).abs() < 0.02, "corner {i}: {:?} vs {:?}", got[i], want[i]);
        }
    }

    #[test]
    fn nothing_on_a_plain_photo() {
        let img = RgbaImage::from_pixel(400, 300, Rgba([120, 120, 120, 255]));
        assert!(detect_quad(&img).is_none());
    }

    #[test]
    fn warp_fills_with_the_card() {
        let (img, q) = card_photo();
        let out = warp(&img, &q, 428, 270);
        // Every pixel well inside the output comes from the card, not the table.
        for (x, y) in [(10, 10), (418, 10), (418, 260), (10, 260), (214, 135)] {
            assert!(out.get_pixel(x, y)[0] > 200, "pixel {x},{y} = {:?}", out.get_pixel(x, y));
        }
    }

    #[test]
    fn size_keeps_the_card_shape() {
        let (img, q) = card_photo();
        let (w, h) = output_size(img.width(), img.height(), &q, Some(85.6 / 54.0));
        assert!(((w as f64 / h as f64) - 85.6 / 54.0).abs() < 0.01);
    }

    #[test]
    fn trims_dark_strips() {
        // Light card with a dark band on the left (6%) and top (4%).
        let (w, h) = (500u32, 315u32);
        let img = RgbaImage::from_fn(w, h, |x, y| if x < 30 || y < 12 { Rgba([30, 30, 30, 255]) } else { Rgba([230, 228, 220, 255]) });
        let out = trim_dark_edges(&img);
        assert_eq!(out.dimensions(), (w, h));
        for (x, y) in [(0, h / 2), (w / 2, 0), (2, 2)] {
            assert!(out.get_pixel(x, y)[0] > 180, "pixel {x},{y} still dark: {:?}", out.get_pixel(x, y));
        }
    }

    #[test]
    fn keeps_a_clean_card() {
        let img = RgbaImage::from_pixel(400, 250, Rgba([220, 220, 220, 255]));
        assert_eq!(trim_dark_edges(&img), img);
    }

    #[test]
    fn order_from_any_order() {
        let q = order_quad([Pt { x: 0.9, y: 0.9 }, Pt { x: 0.1, y: 0.1 }, Pt { x: 0.1, y: 0.9 }, Pt { x: 0.9, y: 0.1 }]);
        assert_eq!(q[0], Pt { x: 0.1, y: 0.1 });
        assert_eq!(q[1], Pt { x: 0.9, y: 0.1 });
        assert_eq!(q[2], Pt { x: 0.9, y: 0.9 });
        assert_eq!(q[3], Pt { x: 0.1, y: 0.9 });
    }
}
