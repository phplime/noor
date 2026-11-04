//! Subject segmentation through Apple's Vision framework (macOS and iOS).
//!
//! Vision runs on a copy of the image capped at [`SEGMENT_MAX_SIDE`] pixels; the
//! resulting soft mask is cached (keyed by image content, mode and picks) so preview
//! updates that only change the background effect don't re-run detection.

use crate::error::{EngineError, Result};
use crate::geometry::Filter;
use crate::pixels::resample;
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Long side of the image given to Vision. Its masks are lower resolution than this
/// anyway; edges are refined at full resolution afterwards.
pub const SEGMENT_MAX_SIDE: u32 = 1536;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "camelCase")]
pub enum SubjectMode {
    /// Plain background → [`SubjectMode::Graphic`], otherwise [`SubjectMode::Subjects`].
    #[default]
    Auto,
    /// Any salient subjects in a photo: people, pets, products, objects… (macOS 14+)
    Subjects,
    /// People only, with accurate hair (macOS 12+).
    People,
    /// Logos, graphics, text, screenshots on a plain background (colour keying,
    /// see [`crate::keying`]); keeps every shape, not just the "main" one.
    Graphic,
}

/// Soft subject mask at segmentation resolution.
#[derive(Debug, Clone)]
pub struct SubjectMask {
    pub width: u32,
    pub height: u32,
    /// Row-major alpha, 1 = subject.
    pub alpha: Vec<f32>,
    /// Number of separate subjects Vision found.
    pub subjects: u32,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod ffi {
    extern "C" {
        pub fn mk_vision_segment(
            rgba: *const u8,
            width: i32,
            height: i32,
            mode: i32,
            picks: *const f32,
            npicks: i32,
            out: *mut f32,
            out_count: *mut i32,
        ) -> i32;
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn run_vision(img: &RgbaImage, mode: SubjectMode, picks: &[[f64; 2]]) -> Result<SubjectMask> {
    let (w, h) = img.dimensions();
    let mut alpha = vec![0f32; (w as usize) * (h as usize)];
    let flat: Vec<f32> = picks
        .iter()
        .flat_map(|p| [p[0].clamp(0.0, 1.0) as f32, p[1].clamp(0.0, 1.0) as f32])
        .collect();
    let mut count: i32 = 0;
    // SAFETY: all buffers are valid for the sizes passed; the Swift side only reads
    // `rgba`/`picks` and writes exactly w×h floats to `out` and one i32 to `count`.
    let status = unsafe {
        ffi::mk_vision_segment(
            img.as_raw().as_ptr(),
            w as i32,
            h as i32,
            match mode {
                SubjectMode::People => 1,
                _ => 0,
            },
            if flat.is_empty() {
                std::ptr::null()
            } else {
                flat.as_ptr()
            },
            (flat.len() / 2) as i32,
            alpha.as_mut_ptr(),
            &mut count,
        )
    };
    match status {
        0 => Ok(SubjectMask {
            width: w,
            height: h,
            alpha,
            subjects: count.max(0) as u32,
        }),
        -2 => Err(EngineError::Segmentation(format!(
            "Photo subject detection needs {}. Choose “People” or “Logo & graphics” instead, or paint the subject with the brush.",
            if cfg!(target_os = "ios") { "iOS 17 or later" } else { "macOS 14 (Sonoma) or later" }
        ))),
        -3 => Err(EngineError::Segmentation(format!(
            "People detection needs {}.",
            if cfg!(target_os = "ios") { "iOS 15 or later" } else { "macOS 12 (Monterey) or later" }
        ))),
        code => Err(EngineError::Segmentation(format!(
            "Subject detection failed (Vision error {code})."
        ))),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn run_vision(_img: &RgbaImage, _mode: SubjectMode, _picks: &[[f64; 2]]) -> Result<SubjectMask> {
    Err(EngineError::Segmentation(
        "Photo subject detection is only available on macOS and iOS. Use “Logo & graphics” or the brush.".into(),
    ))
}

type CacheKey = (u64, SubjectMode, Vec<[u64; 2]>);
static CACHE: Mutex<Vec<(CacheKey, SubjectMask)>> = Mutex::new(Vec::new());
const CACHE_ENTRIES: usize = 4;

/// Cheap content fingerprint: dimensions plus a strided sample of pixels.
pub fn fingerprint(img: &RgbaImage) -> u64 {
    let raw = img.as_raw();
    let mut h: u64 = 0xcbf2_9ce4_8422_2325 ^ ((img.width() as u64) << 32 | img.height() as u64);
    let step = (raw.len() / 65_536).max(1);
    let mut i = 0;
    while i < raw.len() {
        h ^= raw[i] as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
        i += step;
    }
    h
}

/// Detect the subject(s) of `img`. `picks` are normalised points choosing which
/// subjects to keep (empty = all). Results are cached.
pub fn subject_mask(img: &RgbaImage, mode: SubjectMode, picks: &[[f64; 2]]) -> Result<SubjectMask> {
    let key: CacheKey = (
        fingerprint(img),
        mode,
        picks
            .iter()
            .map(|p| [p[0].to_bits(), p[1].to_bits()])
            .collect(),
    );
    if let Some((_, m)) = CACHE.lock().unwrap().iter().find(|(k, _)| *k == key) {
        return Ok(m.clone());
    }
    let (w, h) = img.dimensions();
    let k = (SEGMENT_MAX_SIDE as f64 / w.max(h) as f64).min(1.0);
    let small;
    let input = if k < 1.0 {
        small = resample(
            img,
            ((w as f64 * k).round() as u32).max(1),
            ((h as f64 * k).round() as u32).max(1),
            Filter::Bilinear,
        );
        &small
    } else {
        img
    };
    let mask = run_vision(input, mode, picks)?;
    let mut cache = CACHE.lock().unwrap();
    cache.retain(|(k, _)| *k != key);
    cache.insert(0, (key, mask.clone()));
    cache.truncate(CACHE_ENTRIES);
    Ok(mask)
}
